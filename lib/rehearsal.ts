import type {Song, Stem, Transport} from './types';
import {restricted} from './stems.ts';
export type LoopRange = {start:number;end:number};
export type MixPreset = {id:string;name:string;stems:Pick<Stem,'id'|'enabled'|'volume'|'pan'|'solo'>[]};
export function safeLoop(value:unknown,duration:number):LoopRange|undefined {
 const v=value as LoopRange|undefined;
 if(!v||!Number.isFinite(v.start)||!Number.isFinite(v.end)||v.start<0||v.end>duration||v.end-v.start<.25)return;
 return {start:v.start,end:v.end};
}
export function transportPosition(t:Transport,now:number,duration:number){
 const raw=t.offset+Math.max(0,(now-t.startAt)/1000)*(t.rate||1),loop=safeLoop(t.loop,duration);
 return loop&&raw>=loop.end?loop.start+(raw-loop.start)%(loop.end-loop.start):Math.min(duration,raw);
}
export function safePresets(value:unknown,stems:Stem[]):MixPreset[]{
 if(!Array.isArray(value))return [];
 return value.slice(0,20).filter(p=>p&&typeof p.id==='string'&&/^[\w-]{1,80}$/.test(p.id)&&typeof p.name==='string'&&p.name.trim()).map(p=>({id:p.id,name:p.name.trim().slice(0,60),stems:stems.map(st=>{const x=Array.isArray(p.stems)?p.stems.find((s:any)=>s?.id===st.id):null;return {id:st.id,enabled:x?!!x.enabled:st.enabled,volume:Number.isFinite(x?.volume)?Math.max(0,Math.min(1,x.volume)):st.volume,pan:Number.isFinite(x?.pan)?Math.max(-1,Math.min(1,x.pan)):st.pan||0,solo:!!x?.solo}})}));
}
export function applyPreset(song:Song,preset:MixPreset):Song{return {...song,stems:song.stems.map(st=>({...st,...preset.stems.find(s=>s.id===st.id)}))}}
export function capturePreset(song:Song,name:string):MixPreset{return {id:crypto.randomUUID(),name:name.trim().slice(0,60),stems:song.stems.map(({id,enabled,volume,pan,solo})=>({id,enabled,volume,pan,solo}))}}
export function audibleStems(song:Song,audience=false){return song.stems.filter(st=>!audience||!restricted(st))}
export function librarySummary(song:Song){return {id:song.id,title:song.title,artist:song.artist,bpm:song.bpm,key:song.key,duration:song.duration,stemCount:song.stems.length,reviewed:!!song.info?.playbackConfirmed}}
export function pageRequest(url:URL){const limit=Math.max(1,Math.min(100,Number(url.searchParams.get('limit'))||50));const offset=Math.max(0,Math.min(100000,Number(url.searchParams.get('offset'))||0));return {limit:Math.floor(limit),offset:Math.floor(offset),query:(url.searchParams.get('q')||'').trim().slice(0,100)}}

export function requiredStems(song:Song,audience=false,backing=true){return audibleStems(song,audience).filter(st=>audience||backing||restricted(st))}
