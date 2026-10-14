import {sectionStart} from './timeline.ts';
import type {Song} from './types';
import {displaySection,lyricsOnly,normalizeChordChart} from './song-charts.ts';
export type FollowRow={text:string;line:number;at?:number;end?:number;estimated?:boolean};
const normal=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
function allFollowRows(song:Song,view='chords'):FollowRow[][]{
 const reference=song.chart?.timedLyrics.length?song.chart.timedLyrics:song.analysis?.lyrics||[];let cursor=0;const results:FollowRow[][]=[];
 for(let index=0;index<song.sections.length;index++){
 const section=displaySection(song,song.sections[index])!;const text=view==='lyrics'?(section.lyrics||lyricsOnly(section.chords)):normalizeChordChart(section.chords||section.lyrics);const lines=text.split('\n').filter(line=>line.trim());const rows:FollowRow[]=lines.map((text,line)=>({text,line}));
 for(const row of rows){const lyric=lyricsOnly(row.text);if(!lyric||row.text.startsWith('{'))continue;const target=normal(lyric);if(target.length<4)continue;let match=-1;
 for(let i=cursor;i<reference.length;i++){const candidate=normal(reference[i].text);if(candidate===target||candidate.includes(target)||target.includes(candidate)&&candidate.length>=8){match=i;break}}
 if(match>=0){row.at=reference[match].start;row.end=reference[match].end;row.estimated=!song.chart?.timedLyrics.length;cursor=match+1;}
 }
 const firstContent=rows.find(r=>!r.text.startsWith('{'));if(firstContent&&!lyricsOnly(firstContent.text)&&section.start!==undefined){firstContent.at=section.start;firstContent.end=reference.find(l=>l.start>section.start!)?.start??song.duration;}
 for(const cue of section.lineCues||[]){const row=rows[cue.line];if(row){row.at=cue.at;row.estimated=false;row.end=undefined}}
 for(let i=0;i<rows.length;i++){if(rows[i].at!==undefined&&!rows[i].end){const next=rows.slice(i+1).find(r=>r.at!==undefined&&r.at!>rows[i].at!);rows[i].end=next?.at??song.duration}}
 results.push(rows);
 }
 return results;
}
export function followRows(song:Song,sectionIndex:number,view='chords'):FollowRow[]{return allFollowRows(song,view)[sectionIndex]||[];}
export function activeFollowRow(rows:FollowRow[],position:number){let index=-1;for(let i=0;i<rows.length;i++){const row=rows[i];if(row.at!==undefined&&row.at<=position&&position<(row.end??Infinity)&&(index<0||row.at>=rows[index].at!))index=i}return index;}
export function withFollowSectionStarts(song:Song):Song{
 if(!song.chart?.timedLyrics.length&&!song.sections.some(s=>s.lineCues?.length))return song;
 const rows=allFollowRows(song);const sections=song.sections.map((s,i)=>{if(s.start!==undefined||i===0)return {...s};const first=rows[i].find(r=>r.at!==undefined);return first?{...s,start:first.at}:{...s}});
 let previous=sections[0]?.start??song.beatOffset;
 for(let i=1;i<sections.length;i++){if(sections[i].start===undefined){const next=sections.slice(i+1).find(s=>s.start!==undefined);const expected=previous+sections[i-1].bars*song.beats*60/song.bpm;sections[i].start=next&&next.start!>previous?Math.min(expected,previous+(next.start!-previous)/(sections.slice(i).findIndex(s=>s.start!==undefined)+1)):expected;}previous=sections[i].start!;}
 return {...song,sections};
}

export type ScoreRow=FollowRow&{key:string;section:number;heading?:boolean;tab?:boolean};
export function automaticScore(song:Song,view:string,instrument:string):ScoreRow[]{
 const timed=withFollowSectionStarts(song),rowsBySection=allFollowRows(song,view),result:ScoreRow[]=[],seenTabs=new Set<string>();
 for(let index=0;index<song.sections.length;index++){
 const section=song.sections[index],start=Math.max(0,Math.min(song.duration,sectionStart(timed,index))),end=Math.max(start,Math.min(song.duration,index+1<song.sections.length?sectionStart(timed,index+1):song.duration));
 result.push({key:section.id+'-heading',section:index,heading:true,text:section.name,line:-1,at:start,end,estimated:section.start===undefined});
 let rows:FollowRow[];
 if(view==='tabs'){const cues=(section.tabCues||[]).filter(c=>c.instrument===instrument&&!seenTabs.has(c.id)).sort((a,b)=>a.at-b.at);cues.forEach(c=>seenTabs.add(c.id));rows=cues.length?cues.map((c,i)=>({text:c.text,line:i,at:c.at,end:cues[i+1]?.at??end})):section.tabs[instrument]?section.tabs[instrument].split(/\n\s*\n/).filter(t=>t.trim()).map((text,line)=>({text,line})):[];
 }else rows=rowsBySection[index].filter(r=>!r.text.startsWith('{')&&(view!=='lyrics'||!!lyricsOnly(r.text)));
 // Keep matched/manual anchors; interpolate the remaining rows within section bounds.
 for(let i=0;i<rows.length;i++){if(rows[i].at!==undefined)continue;let prev=i-1;while(prev>=0&&rows[prev].at===undefined)prev--;let next=i+1;while(next<rows.length&&rows[next].at===undefined)next++;const low=prev>=0?rows[prev].at!:start,high=next<rows.length?rows[next].at!:end;const first=prev+1,slots=next-first+(prev>=0?1:0),step=Math.max(0,high-low)/Math.max(1,slots);for(let k=i;k<next;k++){rows[k].at=Math.min(song.duration,low+step*(k-first+(prev>=0?1:0)));rows[k].estimated=true;}i=next-1;}
 for(let i=0;i<rows.length;i++){rows[i].end=Math.min(song.duration,rows[i+1]?.at??Math.max(rows[i].at!+.1,end));result.push({...rows[i],key:section.id+'-'+view+'-'+i,section:index,tab:view==='tabs'});}
 }
 return result;
}
