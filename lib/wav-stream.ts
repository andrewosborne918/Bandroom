import type {LoopRange} from './rehearsal.ts';
export type AudioRange=(start:number,end:number)=>Promise<ArrayBuffer>;
export type WavHeader={channels:number;sampleRate:number;bits:number;format:number;blockAlign:number;dataOffset:number;dataBytes:number;frames:number;duration:number};
const ascii=(view:DataView,at:number,length:number)=>String.fromCharCode(...new Uint8Array(view.buffer,view.byteOffset+at,length));
export async function wavHeader(read:AudioRange,bytes:number):Promise<WavHeader>{
 let start=0,buffer=await read(0,Math.min(bytes-1,65535)),view=new DataView(buffer);
 if(view.byteLength<12||ascii(view,0,4)!=='RIFF'||ascii(view,8,4)!=='WAVE')throw Error('This recording is not a supported WAV file.');
 async function at(position:number,size:number){if(position<start||position+size>start+view.byteLength){start=position;buffer=await read(start,Math.min(bytes-1,start+Math.max(size,65536)-1));view=new DataView(buffer)}if(position-start+size>view.byteLength)throw Error('Audio header is incomplete.');return position-start}
 let fmt:Omit<WavHeader,'dataOffset'|'dataBytes'|'frames'|'duration'>|undefined;
 for(let position=12,number=0;position+8<=bytes&&number<128;number++){
  const index=await at(position,8),name=ascii(view,index,4),size=view.getUint32(index+4,true);
  if(position+8+size>bytes)throw Error('Audio file is incomplete.');
  if(name==='fmt '){if(size<16||size>65536)throw Error('Unsupported WAV format.');const i=await at(position+8,Math.min(size,40));let format=view.getUint16(i,true);const channels=view.getUint16(i+2,true),sampleRate=view.getUint32(i+4,true),blockAlign=view.getUint16(i+12,true),bits=view.getUint16(i+14,true);if(format===65534&&size>=40)format=view.getUint16(i+24,true);if(![1,3].includes(format)||![1,2].includes(channels)||sampleRate<8000||sampleRate>192000||!(format===1?[8,16,24,32]:[32,64]).includes(bits)||blockAlign!==channels*bits/8)throw Error('This WAV format needs conversion to PCM audio.');fmt={channels,sampleRate,blockAlign,bits,format}}
  if(name==='data'){if(!fmt||!size||size%fmt.blockAlign)throw Error('Unsupported WAV layout.');const frames=size/fmt.blockAlign;return {...fmt,dataOffset:position+8,dataBytes:size,frames,duration:frames/fmt.sampleRate}}
  position+=8+size+(size%2);
 }
 throw Error('This WAV file has no audio data.');
}
export const WAV_CHUNK_SECONDS=4;
export class WavStream{
 readonly chunks=new Map<number,AudioBuffer>();private pending=new Map<number,Promise<AudioBuffer>>();private generation=0;
 readonly context:BaseAudioContext;readonly header:WavHeader;readonly maxChunks:number;private read:AudioRange;
 constructor(context:BaseAudioContext,header:WavHeader,read:AudioRange,maxChunks=4){this.context=context;this.header=header;this.read=read;this.maxChunks=maxChunks}
 get chunkFrames(){return Math.round(this.header.sampleRate*WAV_CHUNK_SECONDS)}
 async chunk(index:number){
  const cached=this.chunks.get(index);if(cached){this.chunks.delete(index);this.chunks.set(index,cached);return cached}const pending=this.pending.get(index);if(pending)return pending;
  const epoch=this.generation,promise=(async()=>{const h=this.header,first=index*this.chunkFrames,frames=Math.min(this.chunkFrames,h.frames-first);if(index<0||!Number.isInteger(index)||frames<=0)throw Error('Audio position is outside this recording.');const data=await this.read(h.dataOffset+first*h.blockAlign,h.dataOffset+(first+frames)*h.blockAlign-1);if(data.byteLength!==frames*h.blockAlign)throw Error('An audio segment was incomplete. Retry audio.');const view=new DataView(data),buffer=this.context.createBuffer(h.channels,frames,h.sampleRate),step=h.bits/8;
   for(let channel=0;channel<h.channels;channel++){const out=buffer.getChannelData(channel);for(let frame=0;frame<frames;frame++){const i=frame*h.blockAlign+channel*step;let value=0;if(h.format===3)value=h.bits===32?view.getFloat32(i,true):view.getFloat64(i,true);else if(h.bits===8)value=(view.getUint8(i)-128)/128;else if(h.bits===16)value=view.getInt16(i,true)/32768;else if(h.bits===24)value=((view.getUint8(i)|view.getUint8(i+1)<<8|view.getUint8(i+2)<<16)<<8>>8)/8388608;else value=view.getInt32(i,true)/2147483648;out[frame]=Number.isFinite(value)?Math.max(-1,Math.min(1,value)):0}}
   if(epoch===this.generation){this.chunks.set(index,buffer);while(this.chunks.size>this.maxChunks)this.chunks.delete(this.chunks.keys().next().value!)}return buffer;
  })();this.pending.set(index,promise);try{return await promise}finally{if(this.pending.get(index)===promise)this.pending.delete(index)}
 }
 async prepare(position=0,seconds=8){const h=this.header,from=Math.max(0,position);if(from>=h.duration)return;const first=Math.floor(from/WAV_CHUNK_SECONDS),last=Math.min(Math.ceil(h.frames/this.chunkFrames)-1,Math.floor((from+seconds-1/h.sampleRate)/WAV_CHUNK_SECONDS));for(let i=first;i<=last;i++)await this.chunk(i)}
 clear(){this.generation++;this.chunks.clear();this.pending.clear()}
 schedule(context:AudioContext,destination:AudioNode,options:{when:number;offset:number;duration:number;stemOffset:number;rate:number;loop?:LoopRange},onError:(error:Error)=>void){
  let stopped=false,busy=false,time=options.when,position=options.offset;const active=new Set<AudioBufferSourceNode>();
  const stop=()=>{stopped=true;clearInterval(timer);for(const source of active){source.onended=null;try{source.stop()}catch{}source.disconnect()}active.clear()};
  const wrap=(at:number)=>options.loop&&at>=options.loop.end?options.loop.start+(at-options.loop.start)%(options.loop.end-options.loop.start):at;
  const pump=async()=>{if(stopped||busy)return;busy=true;try{
   if(time<context.currentTime-.05){position=wrap(position+(context.currentTime+.03-time)*options.rate);time=context.currentTime+.03}
   let segments=0;while(!stopped&&time<context.currentTime+8&&segments++<128){position=wrap(position);const boundary=options.loop?.end??options.duration;if(position>=options.duration)break;const sourcePosition=position-options.stemOffset;
    if(sourcePosition<0||sourcePosition>=this.header.duration){const silence=Math.min(boundary-position,sourcePosition<0?-sourcePosition:options.duration-position);if(silence<=0)break;time+=silence/options.rate;position+=silence;continue}
    const index=Math.floor(sourcePosition/WAV_CHUNK_SECONDS),offset=sourcePosition-index*WAV_CHUNK_SECONDS,buffer=await this.chunk(index);if(stopped)break;
    const length=Math.min(buffer.duration-offset,boundary-position,options.duration-position);if(length<=0)break;const drop=Math.max(0,(context.currentTime+.005-time)*options.rate);
    if(drop<length){const source=context.createBufferSource();source.buffer=buffer;source.playbackRate.value=options.rate;source.connect(destination);active.add(source);source.onended=()=>{active.delete(source);source.disconnect()};source.start(time+drop/options.rate,offset+drop,length-drop)}
    time+=length/options.rate;position+=length;
   }
  }catch(error){if(!stopped){stop();onError(error instanceof Error?error:Error('Streaming audio failed.'))}}finally{busy=false}};
  const timer=setInterval(()=>void pump(),200);void pump();return stop;
 }
}
