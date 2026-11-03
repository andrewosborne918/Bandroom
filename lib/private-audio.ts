import {assetCacheKey,deviceAudioCache} from './device-audio-cache.ts';
import type {Stem} from './types';
type AudioDevice={code:string;token:string}|null;
// Always recheck membership and output role before using any durable local copy.
export async function authorizePrivateAudio(songId:string,stem:Stem,device:AudioDevice=null){
 const query=new URLSearchParams(device?{session:device.code}:{}),path='/api/band/audio/'+encodeURIComponent(songId)+'/'+encodeURIComponent(stem.id);
 const headers:Record<string,string>=device?{'x-band-token':device.token}:{};
 async function authorize(){const auth=await fetch(path+'?'+new URLSearchParams({...Object.fromEntries(query),authorize:'1'}),{headers,cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(!auth.ok)throw Error('Audio access ended or this track is unavailable.');
 const meta=await auth.json() as {cacheScope:string;assetId:string;bytes:number;downloadUrl:string;playback?:{id:string;bytes:number;downloadUrl:string}};
 if(typeof meta.cacheScope!=='string'||meta.assetId!==stem.id||meta.bytes!==stem.bytes||typeof meta.downloadUrl!=='string'||!meta.downloadUrl.startsWith('https://'))throw Error('Audio changed. Reopen this song to load its latest files.');
 if(meta.playback&&(meta.playback.id!==stem.id+'-aac-v1'||!Number.isSafeInteger(meta.playback.bytes)||meta.playback.bytes<=8||meta.playback.bytes>240*1024*1024||!meta.playback.downloadUrl?.startsWith('https://')))throw Error('Invalid optimized audio.');
 return meta;}
 let meta=await authorize(),authorizedAt=Date.now(),renewing:Promise<void>|undefined;
 async function fresh(force=false){if(!force&&Date.now()-authorizedAt<45000)return;if(!renewing)renewing=authorize().then(next=>{if(next.cacheScope!==meta.cacheScope)throw Error('Your account changed. Reopen this song.');meta=next;authorizedAt=Date.now()}).finally(()=>{renewing=undefined});await renewing}
 const key=assetCacheKey(meta.cacheScope,meta.assetId,meta.bytes);
 const playbackKey=meta.playback?assetCacheKey(meta.cacheScope,meta.playback.id,meta.playback.bytes):undefined;
 const chosen=(packed:boolean)=>{const entry=packed?meta.playback:meta;if(!entry)throw Error('Optimized audio changed. Reopen this song.');return entry};
 const range=async(start:number,end:number,packed=false)=>{
  await fresh();const entry=chosen(packed),total=entry.bytes,cacheKey=packed?playbackKey!:key;
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end>=total||end-start+1>16*1024*1024)throw Error('Invalid audio segment.');
  const bytes=end-start+1,partKey=cacheKey+':range:'+start+'-'+end;
  return deviceAudioCache.load(partKey,bytes,async()=>{
   const cached=await deviceAudioCache.range(cacheKey,start,end);if(cached)return cached;
   let response=await fetch(chosen(packed).downloadUrl,{headers:{Range:'bytes='+start+'-'+end},credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(30000)});
   if([401,403].includes(response.status)){await response.body?.cancel();await fresh(true);response=await fetch(chosen(packed).downloadUrl,{headers:{Range:'bytes='+start+'-'+end},credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(30000)})}
   const contentRange=response.headers.get('content-range');
   if(!(response.status===206||response.status===200&&start===0&&end===total-1)||contentRange&&contentRange!=='bytes '+start+'-'+end+'/'+total){await response.body?.cancel();throw Error('Audio storage did not return the requested segment. Retry audio.')}
   if(!response.body)throw Error('An audio segment was empty.');const reader=response.body.getReader(),output=new Uint8Array(bytes);let received=0;
   try{while(received<bytes){const part=await reader.read();if(part.done)break;if(received+part.value.byteLength>bytes)throw Error('An audio segment had an unexpected size.');output.set(part.value,received);received+=part.value.byteLength}}finally{void reader.cancel().catch(()=>{})}
   if(received!==bytes)throw Error('An audio segment was incomplete. Retry audio.');return output.buffer;
  });
 };
 async function load(packed=false){await fresh();const entry=chosen(packed);return deviceAudioCache.load(packed?playbackKey!:key,entry.bytes,async()=>{const response=await fetch(entry.downloadUrl,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(180000)});if(!response.ok)throw Error('Could not download '+stem.name);return response.arrayBuffer()})}
 return {key,range,load:()=>load(),playback:meta.playback?{key:playbackKey!,bytes:meta.playback.bytes,range:(start:number,end:number)=>range(start,end,true),load:()=>load(true)}:undefined};
}
