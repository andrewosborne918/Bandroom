import {admin} from './clients';
import {presign,r2Config,r2Key} from './r2';

export const usesR2=()=>process.env.AUDIO_STORAGE==='r2';
async function wrapped<T>(fn:()=>Promise<T>){try{return {data:await fn(),error:null}}catch{return {data:null,error:{message:'Private audio storage operation failed'}}}}
export function storage(bucket:string):any {
 if(!usesR2())return admin().storage.from(bucket);
 const sign=(method:string,key:string,seconds=60,options:any={})=>presign(r2Config(),method,r2Key(bucket,key),seconds,options);
 return {
  createSignedUrl:(key:string,seconds:number,options:any={})=>wrapped(async()=>({signedUrl:sign('GET',key,seconds,options.download?{query:{'response-content-disposition':'attachment; filename="'+String(options.download).replace(/["\r\n]/g,'')+'"'}}:{})})),
  createSignedUploadUrl:(key:string,options:any={})=>wrapped(async()=>({signedUrl:sign('PUT',key,900,options.bytes?{headers:{'content-length':String(options.bytes)}}:{}),token:''})),
  info:(key:string)=>wrapped(async()=>{const r=await fetch(sign('HEAD',key),{signal:AbortSignal.timeout(15000),cache:'no-store'});if(!r.ok)throw Error('Object unavailable');return {size:Number(r.headers.get('content-length')),etag:r.headers.get('etag')}}),
  copy:(key:string,destination:string,options:any={})=>wrapped(async()=>{const source='/'+r2Config().bucket+'/'+r2Key(bucket,key).split('/').map(encodeURIComponent).join('/');const headers={'x-amz-copy-source':source};const r=await fetch(presign(r2Config(),'PUT',r2Key(options.destinationBucket||bucket,destination),60,{headers}),{method:'PUT',headers,signal:AbortSignal.timeout(45000)});const body=await r.text();if(!r.ok||body.includes('<Error>'))throw Error('Copy failed');return {path:destination}}),
  remove:(keys:string[])=>wrapped(async()=>{for(const key of keys){const r=await fetch(sign('DELETE',key),{method:'DELETE',signal:AbortSignal.timeout(15000)});if(!r.ok&&r.status!==404)throw Error('Deletion failed')}return keys}),
 };
}
