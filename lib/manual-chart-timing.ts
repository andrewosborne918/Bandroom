import type {Song} from './types';
import type {ScoreRow} from './chart-follow';
import {automaticScore} from './chart-follow.ts';
import {displaySection,normalizeChordChart} from './song-charts.ts';

export function stampChartTime(song:Song,row:ScoreRow,view:string,instrument:string,position:number):Song{
  if(!Number.isFinite(position)||position<0||position>=song.duration)throw Error('Choose a position inside the song before marking timing.');
  if(!song.sections[row.section])throw Error('This section changed. Reopen timing mode.');
  const at=Math.min(song.duration-.001,Math.round(position*1000)/1000);
  const sections=song.sections.map((original,index)=>{
    if(index!==row.section)return original;
    const displayed=displaySection(song,original)!;
    const section={...displayed,manual:true,chords:normalizeChordChart(displayed.chords)};
    if(row.heading)return {...section,start:at};
    if(view==='tabs'){
      if(row.block!==undefined&&(!Number.isInteger(row.block)||row.block<0||row.block>=500))throw Error('A section supports up to 500 timed tab blocks. Split this tab into more sections.');
      const cues=[...(section.tabCues||[])];
      const found=cues.findIndex(c=>c.instrument===instrument&&(row.cueId?c.id===row.cueId:c.block===row.block));
      const cue={id:found>=0?cues[found].id:crypto.randomUUID(),instrument,text:row.text,at,block:row.block};
      if(found>=0)cues[found]=cue;else {if(cues.length>=500)throw Error('This section already has 500 tab marks. Split it into more sections.');cues.push(cue)}
      return {...section,tabCues:cues};
    }
    const cueView=view==='lyrics'?'lyrics' as const:'chords' as const;
    if(!Number.isInteger(row.line)||row.line<0||row.line>=4000)throw Error('Split this chart into shorter sections before marking more lines.');
    if((section.lineCues||[]).length>=2000&&!section.lineCues?.some(c=>c.line===row.line&&c.view===cueView))throw Error('This section already has 2000 line marks. Split it into more sections.');
    return {...section,lineCues:[...(section.lineCues||[]).filter(c=>c.line!==row.line||c.view!==cueView),{line:row.line,at,view:cueView}]};
  });
  return {...song,sections};
}

export function chartTimingProblems(song:Song):string[]{
  const problems:string[]=[];let previous=-1;
  for(const section of song.sections){
    if(section.start!==undefined){if(section.start<previous)problems.push(section.name+' starts before the previous section.');previous=section.start;}
  }
  for(const view of ['chords','lyrics','tabs']){
    const instruments=view==='tabs'?[...new Set(song.sections.flatMap(s=>[...Object.keys(s.tabs),...(s.tabCues||[]).map(c=>c.instrument)]))]:['Guitar'];
    for(const instrument of instruments){
      let last=-1;
      const rows=automaticScore(song,view,instrument),headings=rows.filter(row=>row.heading);
      for(const row of rows){
        if(row.heading||!row.manual||row.at===undefined)continue;
        const sectionStart=headings.find(h=>h.section===row.section)?.at??0;
        const sectionEnd=headings.find(h=>h.section===row.section)?.end??song.duration;
        if(row.at<sectionStart||row.at>=sectionEnd)problems.push(song.sections[row.section].name+' has a mark outside its section. Adjust the section start or retap that part.');
        if(row.at<last){problems.push((view==='tabs'?instrument+' tab':view==='lyrics'?'Lyric':'Chord')+' marks run backwards. Retap the earlier/later part or undo the last mark.');break;}
        last=row.at;
      }
    }
  }
  return [...new Set(problems)];
}
