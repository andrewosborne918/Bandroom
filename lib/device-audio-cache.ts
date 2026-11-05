// Encoded audio survives page/app restarts; decoded buffers remain memory-only.
// Callers must authorize the asset with the server BEFORE reading this cache.
type Store=Pick<Cache,'match'|'put'|'delete'|'keys'>;
const cacheName='bndrm-private-audio-v1';
// Encoded files use disk, not decoded audio memory. Cloud entitlement is unrelated.
export function cacheBudgetFor(userAgent:string,quota?:number){
 const ceiling=/iPhone|iPad|Android/i.test(userAgent)?4*1024*1024*1024:8*1024*1024*1024;
 return typeof quota==='number'&&Number.isFinite(quota)&&quota>=0?Math.min(ceiling,Math.floor(quota/2)):ceiling;
}
let observedBudget:number|undefined;
export const deviceCacheBudget=()=>observedBudget??cacheBudgetFor(typeof navigator==='undefined'?'':navigator.userAgent);
export async function refreshDeviceCacheBudget(){
 try{const estimate=await navigator.storage?.estimate();if(estimate?.quota!==undefined)observedBudget=cacheBudgetFor(navigator.userAgent,estimate.quota)}catch{}
 return deviceCacheBudget();
}
export const assetCacheKey=(scope:string,id:string,bytes:number)=>scope+':'+id+':'+bytes;
export class DeviceAudioCache{
 persistent:boolean|null=null;
 private pins=new Map<string,number>();
 pin(key:string,until:number){if(Number.isFinite(until)&&until>Date.now())this.pins.set(this.request(key).url,until)}
 private pending=new Map<string,Promise<ArrayBuffer>>();private writes:Promise<unknown>=Promise.resolve();private generation=0;
 private open:()=>Promise<Store|null>;private budget:()=>number;
 private index:Map<string,number>|null=null;private indexedAt=0;
 constructor(open:()=>Promise<Store|null>=async()=>typeof caches==='undefined'?null:caches.open(cacheName),budget:()=>number=deviceCacheBudget){this.open=open;this.budget=budget}
 private request(key:string){return new Request('https://bndrm-cache.invalid/audio/'+encodeURIComponent(key))}
 private mutate<T>(work:()=>Promise<T>):Promise<T>{const result=this.writes.then(work,work);this.writes=result.catch(()=>{});return result}
 async has(key:string){try{return !!await (await this.open())?.match(this.request(key))}catch{return false}}
 async remove(key:string){try{await this.mutate(async()=>{await (await this.open())?.delete(this.request(key));this.index?.delete(this.request(key).url)})}catch{}}
 async range(key:string,start:number,end:number){try{
  const response=await (await this.open())?.match(this.request(key));if(!response?.body)return null;
  const reader=response.body.getReader(),output=new Uint8Array(end-start+1);let position=0,written=0;
  try{while(position<=end){const part=await reader.read();if(part.done)break;const left=Math.max(0,start-position),right=Math.min(part.value.length,end-position+1);if(right>left){output.set(part.value.subarray(left,right),written);written+=right-left}position+=part.value.length}}finally{void reader.cancel().catch(()=>{})}
  return written===output.length?output.buffer:null;
 }catch{return null}}
 async put(key:string,body:Blob|ArrayBuffer,expectedBytes:number){const epoch=this.generation;return this.mutate(async()=>{try{
  const bytes=body instanceof Blob?body.size:body.byteLength,limit=this.budget();if(epoch!==this.generation||bytes!==expectedBytes||bytes>limit)return false;
  const store=await this.open();if(!store){this.persistent=false;return false}if(epoch!==this.generation)return false;
  const request=this.request(key);if(await store.match(request))return true;
  if(!this.index||Date.now()-this.indexedAt>30000){const index=new Map<string,number>();for(const request of await store.keys()){const response=await store.match(request);index.set(request.url,Math.max(0,Number(response?.headers.get('x-bndrm-bytes')||0)))}this.index=index;this.indexedAt=Date.now()}
  let total=0;const entries=[...this.index].map(([url,size])=>{total+=size;return {request:new Request(url),size}}).filter(entry=>(this.pins.get(entry.request.url)||0)<=Date.now());
  while(total+bytes>limit&&entries.length){const oldest=entries.shift()!;await store.delete(oldest.request);this.index.delete(oldest.request.url);total-=oldest.size}
  if(total+bytes>limit)return false;
  const response=()=>new Response(body,{headers:{'Content-Type':'application/octet-stream','x-bndrm-bytes':String(bytes)}});
  try{await store.put(request,response())}catch{if(entries.length){await store.delete(entries[0].request);this.index.delete(entries[0].request.url);await store.put(request,response())}else{this.persistent=false;return false}}
  this.index.set(request.url,bytes);this.persistent=true;return true;
 }catch{this.persistent=false;return false}})}
 async load(key:string,expectedBytes:number,loader:()=>Promise<ArrayBuffer>){const inFlight=this.pending.get(key);if(inFlight)return inFlight;const epoch=this.generation;
  const promise=(async()=>{try{const response=await (await this.open())?.match(this.request(key));if(response){this.persistent=true;const data=await response.arrayBuffer();if(data.byteLength===expectedBytes)return data;await this.remove(key)}}catch{}
   const data=await loader();if(epoch===this.generation)await this.put(key,data,expectedBytes);return data})();this.pending.set(key,promise);
  try{return await promise}finally{if(this.pending.get(key)===promise)this.pending.delete(key)}
 }
 async clear(){this.pins.clear();this.generation++;this.pending.clear();this.index=null;try{await this.mutate(async()=>{const store=await this.open();if(store)for(const request of await store.keys())await store.delete(request)})}catch{}}
}
export const deviceAudioCache=new DeviceAudioCache();
const watchKey=(scope:string)=>'bndrm-upload-cache-v1:'+scope;
export function rememberUploadedSong(scope:string,songId:string){try{const ids=uploadedSongs(scope);localStorage.setItem(watchKey(scope),JSON.stringify([songId,...ids.filter(id=>id!==songId)].slice(0,200)));window.dispatchEvent(new Event('bndrm-cache-uploads'))}catch{}}
export function uploadedSongs(scope:string):string[]{try{const ids=JSON.parse(localStorage.getItem(watchKey(scope))||'[]');return Array.isArray(ids)?ids.filter(id=>typeof id==='string'):[]}catch{return []}}
export async function mapAudio<T>(items:T[],work:(item:T)=>Promise<void>,limit=2){let next=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const item=items[next++];await work(item)}}))}
