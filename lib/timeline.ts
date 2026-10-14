import {beatAt,beatMap} from './analysis.ts';
import type { Song } from './types';
function atBeat(song:Song,index:number){const map=beatMap(song);return map?.[index]!==undefined?map[index]+song.beatOffset-map[0]:song.beatOffset+index*60/song.bpm;}
export function sectionAt(song:Song,seconds:number){let index=0;for(let i=0;i<song.sections.length;i++)if(sectionStart(song,i)<=seconds)index=i;const start=sectionStart(song,index);return {index,start,bar:Math.max(1,Math.floor((beatAt(song,seconds).index-beatAt(song,start).index)/song.beats)+1)};}
export const sectionStart=(song:Song,index:number)=>song.sections[index]?.start??atBeat(song,song.sections.slice(0,index).reduce((n,s)=>n+s.bars,0)*song.beats);
export const formatTime=(seconds:number)=>{const s=Math.floor(Math.max(0,seconds));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};
export const transpose=(value:string,steps:number)=>{const notes=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];const flat:Record<string,string>={Db:'C#',Eb:'D#',Gb:'F#',Ab:'G#',Bb:'A#'};return value.replace(/\[([^\]]+)\]/g,(_,chord:string)=>'['+chord.replace(/(^|\/)([A-G](?:#|b)?)/g,(_m,p:string,n:string)=>p+notes[(notes.indexOf(flat[n]||n)+steps+120)%12])+']');};

export function countInSeconds(song:Song,offset:number){const map=beatMap(song);let interval=60/song.bpm;if(map?.length){const shift=song.beatOffset-map[0];let i=map.findIndex(b=>b+shift>=offset);if(i<0)i=map.length-1;const delta=(map[i+1]??map[i])-(map[i-1]??map[i]);if(delta>0)interval=delta/(i>0&&i<map.length-1?2:1)}return song.countIn*song.beats*interval;}
export function activeTabCue(section:import('./types').Section|undefined,instrument:string,position:number){return section?.tabCues?.filter(c=>c.instrument===instrument&&c.at<=position).at(-1);}
