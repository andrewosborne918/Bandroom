import {assetCacheKey,deviceAudioCache} from './device-audio-cache.ts';
import type {Stem} from './types';
type AudioDevice={code:string;token:string}|null;
// Always recheck membership and output role before using any durable local copy.
export async function authorizePrivateAudio(songId:string,stem:Stem,device:AudioDevice=null){
 const query=new URLSearchParams(device?{session:device.code}:{}),path='/api/band/audio/'+encodeURIComponent(songId)+'/'+encodeURIComponent(stem.id);
 const headers:Record<string,string>=device?{'x-band-token':device.token}:{};
 const auth=await fetch(path+'?'+new URLSearchParams({...Object.fromEntries(query),authorize:'1'}),{headers,cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(!auth.ok)throw Error('Audio access ended or this track is unavailable.');
 const meta=await auth.json() as {cacheScope:string;assetId:string;bytes:number;downloadUrl:string};
 if(typeof meta.cacheScope!=='string'||meta.assetId!==stem.id||meta.bytes!==stem.bytes||typeof meta.downloadUrl!=='string'||!meta.downloadUrl.startsWith('https://'))throw Error('Audio changed. Reopen this song to load its latest files.');
 const key=assetCacheKey(meta.cacheScope,meta.assetId,meta.bytes);
 return {key,load:()=>deviceAudioCache.load(key,meta.bytes,async()=>{const response=await fetch(meta.downloadUrl,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(180000)});if(!response.ok)throw Error('Could not download '+stem.name);return response.arrayBuffer()})};
}
