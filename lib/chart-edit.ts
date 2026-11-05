import type {Song,Section} from './types';
import {displaySection,lyricsOnly,normalizeChordChart} from './song-charts.ts';

const NOTES=['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
const FLAT_TO_SHARP:Record<string,string>={'Db':'C#','D#':'Eb','Gb':'F#','G#':'Ab','A#':'Bb'};

export function normalizeNoteName(note:string):string{
 return FLAT_TO_SHARP[note]||note;
}

export function diatonicChordsForKey(key:string):string[]{
 const raw=(key||'C').trim();
 const minor=raw.endsWith('m');
 const rootName=normalizeNoteName(minor?raw.slice(0,-1):raw);
 const root=NOTES.indexOf(rootName);
 if(root<0)return ['C','Dm','Em','F','G','Am','G7','Fmaj7'];
 const intervals=minor?[0,2,3,5,7,8,10]:[0,2,4,5,7,9,11];
 const qualities=minor?['m','dim','','m','m','','']:['','m','m','','','m','dim'];
 const base=intervals.map((step,i)=>NOTES[(root+step)%12]+qualities[i]);
 const extras=minor
  ?[NOTES[(root+7)%12],NOTES[(root+7)%12]+'7',NOTES[root]+'7',NOTES[(root+3)%12]+'maj7']
  :[NOTES[(root+7)%12]+'7',NOTES[(root+9)%12]+'7',NOTES[root]+'sus4',NOTES[(root+7)%12]+'sus4'];
 return [...new Set([...base,...extras])];
}

export function chordQualitiesFor(chord:string):string[]{
 const match=chord.trim().match(/^([A-G](?:#|b)?)/);
 const root=match?match[1]:'C';
 return [root,root+'m',root+'7',root+'m7',root+'maj7',root+'sus4',root+'dim'];
}

export function replaceChordOccurrence(line:string,occurrenceIndex:number,nextChord:string|null):string{
 let seen=0;
 const replaced=line.replace(/\[([^\]]+)\]/g,(full)=>{
  if(seen++!==occurrenceIndex)return full;
  const clean=(nextChord||'').trim().replace(/^\[|\]$/g,'');
  return clean?'['+clean+']':'';
 });
 return replaced.replace(/[ \t]{2,}/g,' ').trim();
}

export function nudgeChordOccurrence(line:string,occurrenceIndex:number,direction:-1|1):string{
 const matches=[...line.matchAll(/\[([^\]]+)\]/g)];
 const target=matches[occurrenceIndex];
 if(!target||target.index===undefined)return line;
 const chordToken=target[0];
 const without=line.slice(0,target.index)+line.slice(target.index+chordToken.length);
 const words=[...without.matchAll(/\S+/g)];
 if(!words.length)return line;
 let currentWord=words.findIndex(w=>w.index!>=target.index!);
 if(currentWord<0)currentWord=words.length-1;
 const nextWord=Math.max(0,Math.min(words.length-1,currentWord+direction));
 const insertAt=words[nextWord].index!;
 return without.slice(0,insertAt)+chordToken+without.slice(insertAt);
}

export function replaceAllChordsInText(text:string,oldChord:string,newChord:string|null):string{
 const escaped=oldChord.trim().replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const clean=(newChord||'').trim().replace(/^\[|\]$/g,'');
 return text.replace(new RegExp('\\['+escaped+'\\]','g'),clean?'['+clean+']':'').replace(/[ \t]{2,}/g,' ');
}

export function updateSectionLine(song:Song,sectionIndex:number,lineIndex:number,view:string,instrument:string,nextLineText:string):Song{
 const current=song.sections[sectionIndex];
 if(!current)return song;
 const resolved=displaySection(song,current)!;
 if(view==='tabs'){
  const blocks=(resolved.tabs[instrument]||'').split(/\n\s*\n/).filter(t=>t.trim());
  if(nextLineText.trim())blocks[lineIndex]=nextLineText;
  else blocks.splice(lineIndex,1);
  const nextTabs={...resolved.tabs,[instrument]:blocks.join('\n\n')};
  const nextCues=(resolved.tabCues||[]).map(c=>c.instrument===instrument&&c.block===lineIndex?{...c,text:nextLineText}:c);
  const nextSection:Section={...resolved,manual:true,tabs:nextTabs,tabCues:nextCues};
  return {...song,sections:song.sections.map((s,i)=>i===sectionIndex?nextSection:s)};
 }
 const sourceText=view==='lyrics'?(resolved.lyrics||lyricsOnly(resolved.chords)):normalizeChordChart(resolved.chords||resolved.lyrics);
 const lines=sourceText.split('\n').filter(l=>l.trim());
 if(nextLineText.trim())lines[lineIndex]=nextLineText.trim();
 else lines.splice(lineIndex,1);
 const joined=lines.join('\n');
 const nextSection:Section=view==='lyrics'
  ?{...resolved,manual:true,lyrics:joined}
  :{...resolved,manual:true,chords:joined,lyrics:lyricsOnly(joined)||resolved.lyrics};
 return {...song,sections:song.sections.map((s,i)=>i===sectionIndex?nextSection:s)};
}

export function replaceChordInSong(song:Song,sectionIndex:number,lineIndex:number,occurrenceIndex:number,nextChord:string|null,scope:'one'|'section'|'song'='one',oldChord=''):Song{
 if(scope==='one'){
  const current=song.sections[sectionIndex];
  if(!current)return song;
  const resolved=displaySection(song,current)!;
  const lines=normalizeChordChart(resolved.chords||resolved.lyrics).split('\n').filter(l=>l.trim());
  if(lineIndex<0||lineIndex>=lines.length)return song;
  lines[lineIndex]=replaceChordOccurrence(lines[lineIndex],occurrenceIndex,nextChord);
  const joined=lines.join('\n');
  const nextSection:Section={...resolved,manual:true,chords:joined,lyrics:lyricsOnly(joined)||resolved.lyrics};
  return {...song,sections:song.sections.map((s,i)=>i===sectionIndex?nextSection:s)};
 }
 if(!oldChord)return song;
 const sections=song.sections.map((s,i)=>{
  if(scope==='section'&&i!==sectionIndex)return s;
  const resolved=displaySection(song,s)!;
  const updatedChords=replaceAllChordsInText(normalizeChordChart(resolved.chords||resolved.lyrics),oldChord,nextChord);
  return {...resolved,manual:true,chords:updatedChords,lyrics:lyricsOnly(updatedChords)||resolved.lyrics};
 });
 const nextChart=scope==='song'&&song.chart?.chordpro?{...song.chart,chordpro:replaceAllChordsInText(song.chart.chordpro,oldChord,nextChord)}:song.chart;
 return {...song,chart:nextChart,sections};
}

export function splitSectionAtLine(song:Song,sectionIndex:number,lineIndex:number,newSectionName?:string,startAt?:number):Song{
 const current=song.sections[sectionIndex];
 if(!current||lineIndex<=0)return song;
 const resolved=displaySection(song,current)!;
 const chordLines=normalizeChordChart(resolved.chords||resolved.lyrics).split('\n').filter(l=>l.trim());
 if(lineIndex>=chordLines.length)return song;
 const firstChords=chordLines.slice(0,lineIndex).join('\n');
 const secondChords=chordLines.slice(lineIndex).join('\n');
 const ratio=lineIndex/chordLines.length;
 const firstBars=Math.max(1,Math.round(resolved.bars*ratio));
 const secondBars=Math.max(1,resolved.bars-firstBars);
 const firstSection:Section={
  ...resolved,
  manual:true,
  bars:firstBars,
  chords:firstChords,
  lyrics:lyricsOnly(firstChords),
  lineCues:(resolved.lineCues||[]).filter(c=>c.line<lineIndex),
 };
 const secondSection:Section={
  id:crypto.randomUUID(),
  name:newSectionName||('Section '+(song.sections.length+1)),
  bars:secondBars,
  manual:true,
  start:startAt,
  chords:secondChords,
  lyrics:lyricsOnly(secondChords),
  tabs:{...resolved.tabs},
  tabCues:resolved.tabCues,
  lineCues:(resolved.lineCues||[]).filter(c=>c.line>=lineIndex).map(c=>({...c,line:c.line-lineIndex})),
 };
 const nextSections=[...song.sections.slice(0,sectionIndex),firstSection,secondSection,...song.sections.slice(sectionIndex+1)];
 return {...song,sections:nextSections};
}

export function autoSplitAnalyzedSections(song:Song):Song{
 if(song.sections.length!==1)return song;
 const first=displaySection(song,song.sections[0])!;
 const lines=normalizeChordChart(first.chords||first.lyrics).split('\n').filter(l=>l.trim());
 if(lines.length<4)return song;
 const timed=song.chart?.timedLyrics.length?song.chart.timedLyrics:song.analysis?.lyrics||[];
 const barSeconds=(song.beats||4)*60/Math.max(30,song.bpm||120);
 const groups:{name:string;start?:number;lines:string[]}[]=[];
 const firstVocalStart=timed[0]?.start??0;
 const introChords=(song.analysis?.chords||[]).filter(c=>c.chord!=='N'&&c.time<firstVocalStart-1);
 if(firstVocalStart>=Math.max(8,barSeconds*2)&&introChords.length){
  const deduped=introChords.filter((c,i)=>i===0||c.chord!==introChords[i-1].chord);
  groups.push({name:'Intro',start:0,lines:[deduped.slice(0,8).map(c=>'['+c.chord+']').join(' ')]});
 }
 let currentLines:string[]=[];
 let currentStart:number|undefined=timed[0]?.start;
 let verseCount=0;
 for(let i=0;i<lines.length;i++){
  currentLines.push(lines[i]);
  const tCur=timed[i],tNext=timed[i+1];
  const gap=tCur&&tNext?tNext.start-tCur.end:0;
  const shouldBreak=(gap>=Math.max(4.5,barSeconds*1.5)&&currentLines.length>=2)||currentLines.length>=6||i===lines.length-1;
  if(shouldBreak){
   verseCount++;
   groups.push({name:'Section '+verseCount,start:currentStart,lines:currentLines});
   currentLines=[];
   currentStart=tNext?.start;
  }
 }
 if(groups.length<2)return song;
 const sections:Section[]=groups.map((g,idx)=>{
  const nextStart=groups[idx+1]?.start??song.duration;
  const dur=Math.max(barSeconds,(nextStart-(g.start??0)));
  const chords=g.lines.join('\n');
  return {
   id:idx===0?first.id:first.id+'-sec-'+idx,
   name:g.name,
   bars:Math.max(1,Math.round(dur/barSeconds)),
   start:g.start!==undefined?Number(g.start.toFixed(2)):undefined,
   manual:true,
   chords,
   lyrics:lyricsOnly(chords),
   tabs:idx===0?{...first.tabs}:{},
   tabCues:idx===0?first.tabCues:[],
  };
 });
 return {...song,sections};
}
