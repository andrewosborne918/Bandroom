import {beatAt,beatMap} from './analysis.ts';
import type { Song, Transport } from './types';
function atBeat(song:Song,index:number){const map=beatMap(song);return map?.[index]!==undefined?map[index]+song.beatOffset-map[0]:song.beatOffset+index*60/song.bpm;}
export function sectionAt(song:Song,seconds:number){let index=0;for(let i=0;i<song.sections.length;i++)if(sectionStart(song,i)<=seconds)index=i;const start=sectionStart(song,index);return {index,start,bar:Math.max(1,Math.floor((beatAt(song,seconds).index-beatAt(song,start).index)/song.beats)+1)};}
export const sectionStart=(song:Song,index:number)=>song.sections[index]?.start??atBeat(song,song.sections.slice(0,index).reduce((n,s)=>n+s.bars,0)*song.beats);
export const formatTime=(seconds:number)=>{const s=Math.floor(Math.max(0,seconds));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};
export const transpose=(value:string,steps:number)=>{const notes=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];const flat:Record<string,string>={Db:'C#',Eb:'D#',Gb:'F#',Ab:'G#',Bb:'A#'};return value.replace(/\[([^\]]+)\]/g,(_,chord:string)=>'['+chord.replace(/(^|\/)([A-G](?:#|b)?)/g,(_m,p:string,n:string)=>p+notes[(notes.indexOf(flat[n]||n)+steps+120)%12])+']');};
export function clickStopPosition(song:Song){
 const setting=song.info?.clickStop;
 if(!setting)return Infinity;
 if(setting.mode==='count-in')return 0;
 if(setting.mode==='seconds')return setting.value;
 const index=setting.value*song.beats;
 const map=beatMap(song);
 if(map?.length&&index>=map.length){
  const last=map.at(-1)!+song.beatOffset-map[0];
  return last+(index-map.length+1)*localBeatInterval(song,last);
 }
 return atBeat(song,index);
}

export function localBeatInterval(song:Song,offset:number){
 const fallback=60/Math.max(25,song.bpm||120);
 const map=beatMap(song);
 if(!map||map.length<2)return fallback;
 const shift=song.beatOffset-map[0];
 let i=map.findIndex(b=>b+shift>=offset);
 if(i<0)i=map.length-1;
 // Match the tempo entering playback, including starts just after a tempo change.
 const start=i<map.length-1?i:Math.max(0,map.length-5);
 const end=Math.min(map.length-2,start+3);
 const diffs:number[]=[];
 for(let k=start;k<=end;k++){const d=map[k+1]-map[k];if(d>.1&&d<3)diffs.push(d)}
 if(!diffs.length)return fallback;
 diffs.sort((a,b)=>a-b);
 const mid=diffs.length>>1;
 return diffs.length%2?diffs[mid]:(diffs[mid-1]+diffs[mid])/2;
}
export function countInSeconds(song:Song,offset:number){return song.countIn*song.beats*localBeatInterval(song,offset);}
export function countInPlan(song:Song,t:Pick<Transport,'startAt'|'offset'|'countIn'|'rate'>){
 const countBeats=Math.max(0,Math.round(song.countIn*song.beats));
 if(t.countIn<=0||countBeats<=0)return {countBeats:0,firstCountIndex:0,intervalMs:0,countStartMs:t.startAt,anchorMs:t.startAt,leadInBeats:[] as {at:number;index:number}[]};
 const rate=t.rate||1,intervalMs=t.countIn*1000/countBeats,intervalSec=intervalMs/1000*rate;
 const map=beatMap(song);
 let firstBeat:number|undefined,firstBeatIndex=0;
 if(map?.length){
  const shift=song.beatOffset-map[0];
  const idx=map.findIndex(b=>b+shift>=t.offset);
  if(idx>=0){firstBeat=map[idx]+shift;firstBeatIndex=idx}
 }else{
  const step=60/Math.max(25,song.bpm||120),lower=Math.max(0,Math.floor((t.offset-song.beatOffset)/step));
  const k=song.beatOffset+lower*step<t.offset?lower+1:lower;
  firstBeat=song.beatOffset+k*step;firstBeatIndex=k;
 }
 const leadSec=firstBeat!==undefined?Math.max(0,firstBeat-t.offset):0;
 const extraBeats=intervalSec>0?Math.min(120,Math.floor(leadSec/intervalSec)):0;
 const phaseSec=Math.max(0,leadSec-extraBeats*intervalSec);
 const anchorMs=t.startAt+phaseSec/rate*1000,countStartMs=anchorMs-t.countIn*1000;
 const leadInBeats:{at:number;index:number}[]=[];
 for(let k=0;k<extraBeats;k++)leadInBeats.push({at:anchorMs+k*intervalMs,index:firstBeatIndex-(extraBeats-k)});
 return {countBeats,firstCountIndex:firstBeatIndex-extraBeats-countBeats,intervalMs,countStartMs,anchorMs,leadInBeats};
}
export function activeTabCue(section:import('./types').Section|undefined,instrument:string,position:number){return section?.tabCues?.filter(c=>c.instrument===instrument&&c.at<=position).at(-1);}
