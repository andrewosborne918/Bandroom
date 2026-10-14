import {chartLines} from './song-charts.ts';
import type {Song} from './types';
export type AudioAnalysis={version:1;bpm:number;key:string;beats:number[];lyrics:{start:number;end:number;text:string}[];chords:{time:number;chord:string;confidence?:number}[];methods:Record<string,string>;warnings:string[]};
export function safeAnalysis(value:any,duration:number):AudioAnalysis|undefined {
 if(!value||typeof value!=='object')return undefined;
 const finite=(v:any)=>typeof v==='number'&&Number.isFinite(v);
 if(!finite(value.bpm)||(value.bpm!==0&&(value.bpm<25||value.bpm>300))||!Array.isArray(value.beats)||value.beats.length>40000)return undefined;
 const beats=value.beats.filter((x:any)=>finite(x)&&x>=0&&x<=duration);
 if(beats.length!==value.beats.length||beats.some((x:number,i:number)=>i>0&&x<=beats[i-1])||(value.bpm===0?beats.length!==0:beats.length<3))return undefined;
 return {version:1,bpm:value.bpm,key:String(value.key||'').slice(0,12),beats,
  lyrics:(Array.isArray(value.lyrics)?value.lyrics:[]).slice(0,2000).filter((s:any)=>s&&finite(s.start)&&finite(s.end)&&s.start>=0&&s.end>s.start&&s.end<=duration+1).map((s:any)=>({start:s.start,end:s.end,text:String(s.text||'').slice(0,1000)})).sort((a:any,b:any)=>a.start-b.start),
  chords:(Array.isArray(value.chords)?value.chords:[]).slice(0,4000).filter((s:any)=>s&&finite(s.time)&&s.time>=0&&s.time<=duration).map((s:any)=>({time:s.time,chord:String(s.chord||'N').slice(0,16),confidence:finite(s.confidence)?Math.max(0,Math.min(1,s.confidence)):undefined})).sort((a:any,b:any)=>a.time-b.time),
  methods:Object.fromEntries(Object.entries(value.methods&&typeof value.methods==='object'?value.methods:{}).slice(0,6).map(([k,v])=>[k.slice(0,30),String(v).slice(0,150)])),
  warnings:(Array.isArray(value.warnings)?value.warnings:[]).slice(0,8).map((x:any)=>String(x).slice(0,300))};
}
export function applyAnalysis(song:Song,analysis:AudioAnalysis):Song {
 const lyrics=song.chart?.plainLyrics||analysis.lyrics.map(s=>s.text).join('\n');
 const chords=chartLines({...song,analysis});
 return {...song,analysis,bpm:analysis.bpm||song.bpm,key:analysis.key||song.key,beatOffset:analysis.beats[0]??song.beatOffset,info:{...song.info,playbackConfirmed:false,useManualTiming:false},sections:song.sections.some(s=>s.manual||(s.lyrics||s.chords)&&!['Analyzed song','Online lyrics'].includes(s.name))?song.sections:[{id:crypto.randomUUID(),name:'Analyzed song',bars:Math.max(1,Math.ceil(analysis.beats.length/song.beats)),lyrics,chords,tabs:{}}]};
}
export function beatMap(song:Song){return song.info?.useManualTiming?undefined:song.analysis?.beats;}
export function clickReady(song:Song){return !!beatMap(song)?.length||!!song.info?.playbackConfirmed||!!song.demo;}
export function beatAt(song:Song,seconds:number){
 const beats=beatMap(song);
 if(!beats?.length){const b=(seconds-song.beatOffset)*song.bpm/60;return {index:Math.floor(b),fraction:b-Math.floor(b)};}
 const shift=song.beatOffset-beats[0];let lo=0,hi=beats.length;
 while(lo<hi){const mid=(lo+hi)>>1;if(beats[mid]+shift<=seconds)lo=mid+1;else hi=mid;}
 const index=lo-1;
 return {index,fraction:index<0?1:(seconds-beats[index]-shift)/((beats[index+1]??beats[index]+60/song.bpm)-beats[index])};
}
