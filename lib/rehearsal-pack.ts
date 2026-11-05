import type {Stem} from './types';
export type AudioDevice={code:string;token:string}|null;
export type AudioMetadata={cacheScope:string;assetId:string;bytes:number;downloadUrl:string;offlineUntil?:number;playback?:{id:string;bytes:number;downloadUrl:string}};
type Grant={meta:AudioMetadata;until:number};
const grants=new Map<string,Grant>();
export const PACK_WINDOW_MS=2*60*60*1000;
export const packIdentity=(scope:string,songId:string,stem:Stem,device:AudioDevice)=>JSON.stringify([scope,songId,stem.id,stem.bytes,stem.audioVersion||'',device?.code||'',device?.token||'']);
export function rememberPackGrant(scope:string,songId:string,stem:Stem,device:AudioDevice,meta:AudioMetadata,now=Date.now()){
 if(!scope||meta.cacheScope!==scope||!Number.isSafeInteger(meta.offlineUntil)||meta.offlineUntil!<=now||meta.offlineUntil!>now+PACK_WINDOW_MS+5000)throw Error('A fresh rehearsal authorization is required.');
 grants.set(packIdentity(scope,songId,stem,device),{meta,until:Math.min(meta.offlineUntil!,now+PACK_WINDOW_MS)});
}
export function packGrant(scope:string,songId:string,stem:Stem,device:AudioDevice,now=Date.now()){
 const key=packIdentity(scope,songId,stem,device),grant=grants.get(key);if(!grant||grant.until<=now){grants.delete(key);return undefined}return grant.meta;
}
export function clearRehearsalPacks(){grants.clear()}
export function dropPackGrant(scope:string,songId:string,stem:Stem,device:AudioDevice){grants.delete(packIdentity(scope,songId,stem,device))}
