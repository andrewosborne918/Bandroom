import type {Song,Session,Stem} from './types';
import {safeLoop,type LoopRange} from './rehearsal.ts';
import {sectionStart} from './timeline.ts';
export type PracticeMarker={id:string;name:string;at:number};
export type PracticeLoop=LoopRange&{id:string;name:string;rate:number};
export type Rehearsal={markers:PracticeMarker[];loops:PracticeLoop[];bandNotes:string;approved?:{fingerprint:string;at:number}};
export type PersonalMix=Record<string,{volume:number;muted:boolean}>;
const text=(v:unknown,n:number)=>typeof v==='string'?v.trim().slice(0,n):'';
const validId=(v:unknown)=>typeof v==='string'&&/^[\w-]{1,80}$/.test(v);
export function safeRehearsal(value:any,duration:number):Rehearsal{
 const markers:PracticeMarker[]=[],loops:PracticeLoop[]=[];
 for(const m of Array.isArray(value?.markers)?value.markers.slice(0,100):[]){if(!m||!validId(m.id)||markers.some(x=>x.id===m.id)||!text(m.name,60)||!Number.isFinite(m.at)||m.at<0||m.at>=duration||markers.some(x=>Math.abs(x.at-m.at)<.25))continue;markers.push({id:m.id,name:text(m.name,60),at:Math.min(duration-.001,Math.round(m.at*1000)/1000)})}
 for(const l of Array.isArray(value?.loops)?value.loops.slice(0,40):[]){const range=safeLoop(l,duration);if(!range||!validId(l.id)||loops.some(x=>x.id===l.id)||!text(l.name,60))continue;loops.push({...range,id:l.id,name:text(l.name,60),rate:Number.isFinite(l.rate)?Math.max(.5,Math.min(1.25,l.rate)):1})}
 return {markers:markers.sort((a,b)=>a.at-b.at),loops,bandNotes:text(value?.bandNotes,4000),approved:value?.approved&&/^v1-[a-f0-9]{8}$/.test(value.approved.fingerprint)&&Number.isSafeInteger(value.approved.at)&&value.approved.at>0?{fingerprint:value.approved.fingerprint,at:value.approved.at}:undefined};
}
// A content identity for review invalidation, not a credential or security signature.
function canonical(value:any):any{if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])]));return value}
export function chartFingerprint(song:Song){const content=JSON.stringify(canonical({sections:song.sections.map(s=>({id:s.id,name:s.name,start:s.start,bars:s.bars,manual:!!s.manual,lyrics:s.lyrics,chords:s.chords,tabs:s.tabs,lineCues:s.lineCues||[],tabCues:s.tabCues||[]})),chart:song.chart?{plainLyrics:song.chart.plainLyrics,chordpro:song.chart.chordpro,timedLyrics:song.chart.timedLyrics}:null,analysis:song.analysis?{chords:song.analysis.chords,lyrics:song.analysis.lyrics,beats:song.analysis.beats}:null,useManualTiming:!!song.info?.useManualTiming,duration:song.duration,key:song.key,countIn:song.countIn,tuning:song.info?.guitarTuning,customTuning:song.info?.guitarTuningCustom,bpm:song.bpm,beats:song.beats,denominator:song.denominator,beatOffset:song.beatOffset,markers:song.rehearsal?.markers||[],notes:song.rehearsal?.bandNotes||''}));let hash=2166136261;for(let i=0;i<content.length;i++){hash^=content.charCodeAt(i);hash=Math.imul(hash,16777619)}return 'v1-'+(hash>>>0).toString(16).padStart(8,'0')}
export const chartApproved=(song:Song)=>song.rehearsal?.approved?.fingerprint===chartFingerprint(song);
export function practiceParts(song:Song){const markers=song.rehearsal?.markers||[];const points=markers.length?markers:song.sections.map((s,i)=>({id:s.id,name:s.name,at:sectionStart(song,i)}));return points.map((p,i)=>({...p,start:p.at,end:Math.min(song.duration,points[i+1]?.at??song.duration)})).filter(p=>p.end-p.start>=.25)}
export function addPracticeMarker(song:Song,name:string,at:number):Song{
 if(!name.trim())throw Error('Name the section first.');if(!Number.isFinite(at)||at<0||at>=song.duration)throw Error('Mark a position inside the song.');
 const initial=song.rehearsal?.markers.length?song.rehearsal.markers:song.sections.length>1?song.sections.map((s,i)=>({id:s.id,name:s.name,at:sectionStart(song,i)})):[];
 if(initial.length>=100)throw Error('This song already has 100 markers.');if(initial.some(m=>Math.abs(m.at-at)<.25))throw Error('A section already starts here. Rename it or choose another position.');
 const markers=[...initial,{id:crypto.randomUUID(),name,at}];if(!initial.length&&at>=.25)markers.push({id:crypto.randomUUID(),name:'Intro',at:0});
 return {...song,rehearsal:safeRehearsal({...song.rehearsal,markers},song.duration)};
}
export function personalMonitor(song:Song,mix:PersonalMix,audience=false):Song{if(audience)return song;return {...song,stems:song.stems.map(st=>{const local=Object.hasOwn(mix,st.id)?mix[st.id]:undefined;return local?{...st,volume:st.volume*Math.max(0,Math.min(2,local.volume)),enabled:st.enabled&&!local.muted}:st})}}
export function safePersonalMix(value:any,stems:Stem[]):PersonalMix{return Object.fromEntries(stems.filter(st=>value?.[st.id]&&Number.isFinite(value[st.id].volume)).map(st=>[st.id,{volume:Math.max(0,Math.min(2,value[st.id].volume)),muted:!!value[st.id].muted}]))}
export function deviceReadiness(session:Session,now=Date.now()){return session.members.map(m=>({...m,status:now-m.seen>=30000?'disconnected':m.songId!==session.songId?'preparing-song':m.clockError!==undefined&&m.clockError>100?'clock':m.ready?'ready':'audio'}))}
