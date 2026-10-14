import type {Stem} from './types';
export const audioCacheKey=(songId:string,stem:Stem)=>[songId,stem.id,stem.audioVersion||'',stem.bytes,stem.sampleRate||0,stem.duration].join(':');
export class DecodedAudioCache{
 entries=new Map<string,{buffer:AudioBuffer;bytes:number}>();pending=new Map<string,Promise<AudioBuffer>>();bytes=0;
 get(key:string){const entry=this.entries.get(key);if(!entry)return;this.entries.delete(key);this.entries.set(key,entry);return entry.buffer;}
 async load(key:string,loader:()=>Promise<AudioBuffer>,maxBytes:number):Promise<AudioBuffer>{const cached=this.get(key);if(cached)return cached;const pending=this.pending.get(key);if(pending)return pending;const promise=(async()=>{const buffer=await loader(),bytes=buffer.length*buffer.numberOfChannels*4;if(bytes>maxBytes)throw Error('This audio file exceeds device audio memory. Use a computer or import mono stems.');while(this.bytes+bytes>maxBytes&&this.entries.size){const oldest=this.entries.keys().next().value!;this.bytes-=this.entries.get(oldest)!.bytes;this.entries.delete(oldest)}this.entries.set(key,{buffer,bytes});this.bytes+=bytes;return buffer})();this.pending.set(key,promise);try{return await promise}finally{if(this.pending.get(key)===promise)this.pending.delete(key)}}
}
export const decodedAudioCache=new DecodedAudioCache();
export const deviceAudioBudget=()=>typeof navigator!=='undefined'&&/iPhone|iPad|Android/i.test(navigator.userAgent)?192*1024*1024:768*1024*1024;
