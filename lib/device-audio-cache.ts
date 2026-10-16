// Encoded audio survives page/app restarts; decoded buffers remain memory-only.
// Callers must authorize the asset with the server BEFORE reading this cache.
type Store=Pick<Cache,'match'|'put'|'delete'|'keys'>;
const cacheName='bndrm-private-audio-v1';
export const deviceCacheBudget=()=>typeof navigator!=='undefined'&&/iPhone|iPad|Android/i.test(navigator.userAgent)?256*1024*1024:1024*1024*1024;
export const assetCacheKey=(scope:string,id:string,bytes:number)=>scope+':'+id+':'+bytes;
export class DeviceAudioCache{
 persistent:boolean|null=null;
 private pending=new Map<string,Promise<ArrayBuffer>>();private writes:Promise<unknown>=Promise.resolve();private generation=0;
 private open:()=>Promise<Store|null>;private budget:()=>number;
 constructor(open:()=>Promise<Store|null>=async()=>typeof caches==='undefined'?null:caches.open(cacheName),budget:()=>number=deviceCacheBudget){this.open=open;this.budget=budget}
 private request(key:string){return new Request('https://bndrm-cache.invalid/audio/'+encodeURIComponent(key))}
 private mutate<T>(work:()=>Promise<T>):Promise<T>{const result=this.writes.then(work,work);this.writes=result.catch(()=>{});return result}
 async has(key:string){try{return !!await (await this.open())?.match(this.request(key))}catch{return false}}
 async remove(key:string){try{await this.mutate(async()=>{await (await this.open())?.delete(this.request(key))})}catch{}}
 async put(key:string,body:Blob|ArrayBuffer,expectedBytes:number){const epoch=this.generation;return this.mutate(async()=>{try{
  const bytes=body instanceof Blob?body.size:body.byteLength,limit=this.budget();if(epoch!==this.generation||bytes!==expectedBytes||bytes>limit)return false;
  const store=await this.open();if(!store){this.persistent=false;return false}if(epoch!==this.generation)return false;
  const request=this.request(key);if(await store.match(request))return true;
  let total=0;const entries=[];for(const request of await store.keys()){const response=await store.match(request);const size=Number(response?.headers.get('x-bndrm-bytes')||0);total+=size;entries.push({request,size})}
  while(total+bytes>limit&&entries.length){const oldest=entries.shift()!;await store.delete(oldest.request);total-=oldest.size}
  const response=()=>new Response(body,{headers:{'Content-Type':'application/octet-stream','x-bndrm-bytes':String(bytes)}});
  try{await store.put(request,response())}catch{if(entries.length){await store.delete(entries[0].request);await store.put(request,response())}else{this.persistent=false;return false}}
  this.persistent=true;return true;
 }catch{this.persistent=false;return false}})}
 async load(key:string,expectedBytes:number,loader:()=>Promise<ArrayBuffer>){const inFlight=this.pending.get(key);if(inFlight)return inFlight;const epoch=this.generation;
  const promise=(async()=>{try{const response=await (await this.open())?.match(this.request(key));if(response){this.persistent=true;const data=await response.arrayBuffer();if(data.byteLength===expectedBytes)return data;await this.remove(key)}}catch{}
   const data=await loader();if(epoch===this.generation)await this.put(key,data,expectedBytes);return data})();this.pending.set(key,promise);
  try{return await promise}finally{if(this.pending.get(key)===promise)this.pending.delete(key)}
 }
 async clear(){this.generation++;this.pending.clear();try{await this.mutate(async()=>{const store=await this.open();if(store)for(const request of await store.keys())await store.delete(request)})}catch{}}
}
export const deviceAudioCache=new DeviceAudioCache();
const watchKey=(scope:string)=>'bndrm-upload-cache-v1:'+scope;
export function rememberUploadedSong(scope:string,songId:string){try{const ids=uploadedSongs(scope);localStorage.setItem(watchKey(scope),JSON.stringify([songId,...ids.filter(id=>id!==songId)].slice(0,200)));window.dispatchEvent(new Event('bndrm-cache-uploads'))}catch{}}
export function uploadedSongs(scope:string):string[]{try{const ids=JSON.parse(localStorage.getItem(watchKey(scope))||'[]');return Array.isArray(ids)?ids.filter(id=>typeof id==='string'):[]}catch{return []}}
export async function mapAudio<T>(items:T[],work:(item:T)=>Promise<void>,limit=2){let next=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const item=items[next++];await work(item)}}))}
