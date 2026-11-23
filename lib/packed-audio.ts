import {WAV_CHUNK_SECONDS,WavStream,wavHeader,type AudioRange,type WavHeader} from './wav-stream.ts';
export type PlaybackIndex={version:1;codec:'aac';sampleRate:number;channels:number;frames:number;chunkSeconds:4;segments:{bytes:number;frames:number;start:number;end:number}[]};
export async function playbackIndex(read:AudioRange,bytes:number):Promise<PlaybackIndex>{
 const prefix=await read(0,7),view=new DataView(prefix);if(prefix.byteLength!==8||view.getUint32(0)!==0x424e4131)throw Error('Invalid playback file.');const length=view.getUint32(4,true);if(length<2||length>65536||length+8>=bytes)throw Error('Invalid playback index.');
 const raw=JSON.parse(new TextDecoder().decode(await read(8,7+length)));if(raw.version!==1||raw.codec!=='aac'||raw.chunkSeconds!==4||![1,2].includes(raw.channels)||raw.sampleRate!==44100||!Number.isSafeInteger(raw.frames)||raw.frames<=0||raw.frames>44100*7200||!Array.isArray(raw.segments)||raw.segments.length!==Math.ceil(raw.frames/(44100*4)))throw Error('Unsupported playback index.');
 let position=length+8,frames=0;const segments=raw.segments.map((segment:{bytes:number;frames:number},index:number)=>{const expected=Math.min(44100*4,raw.frames-index*44100*4);if(!Number.isSafeInteger(segment.bytes)||segment.bytes<1||segment.bytes>1024*1024||segment.frames!==expected)throw Error('Invalid playback segment.');const start=position;position+=segment.bytes;frames+=segment.frames;return {...segment,start,end:position-1}});if(position!==bytes||frames!==raw.frames)throw Error('Incomplete playback file.');return {...raw,segments};
}
export function packedStream(context:AudioContext,index:PlaybackIndex,read:AudioRange,fallback?:{read:AudioRange;bytes:number}){
 const header:WavHeader={channels:index.channels,sampleRate:index.sampleRate,bits:16,format:1,blockAlign:index.channels*2,dataOffset:0,dataBytes:index.frames*index.channels*2,frames:index.frames,duration:index.frames/index.sampleRate};
 let fallbackStream:Promise<WavStream>|null=null;
 let useFallback=false;
 const decodeOriginal=(number:number)=>{
  if(!fallback)return null;
  if(!fallbackStream)fallbackStream=wavHeader(fallback.read,fallback.bytes).then(original=>new WavStream(context,original,fallback.read,1));
  return fallbackStream.then(stream=>stream.chunk(number));
 };
 const stream=new WavStream(context,header,read,4,async number=>{
  if(useFallback&&fallback)return decodeOriginal(number)!;
  const segment=index.segments[number];
  if(!segment)throw Error('Audio position is outside this recording.');
  const data=await read(segment.start,segment.end);
  const frames=Math.max(1,Math.round(segment.frames/index.sampleRate*context.sampleRate));
  const partialTail=number===index.segments.length-1&&segment.frames<index.sampleRate*WAV_CHUNK_SECONDS;
  // Legacy MP4 edit lists rounded the ending down to a whole millisecond.
  const shortfall=2+(partialTail?Math.ceil(context.sampleRate/1000):0);
  let decoded:AudioBuffer;
  try{
   decoded=await context.decodeAudioData(data);
  }catch(error){
   // Some browsers reject a legacy edit whose duration rounded down to zero.
   if(partialTail&&segment.frames<index.sampleRate/1000&&error instanceof DOMException&&error.name==='EncodingError'){
    return context.createBuffer(index.channels,frames,context.sampleRate);
   }
   if(fallback&&error instanceof DOMException&&error.name==='EncodingError'){
    if(!partialTail)useFallback=true;
    return decodeOriginal(number)!;
   }
   throw error;
  }
  if(decoded.numberOfChannels!==index.channels||decoded.length<frames-shortfall||decoded.length>frames+context.sampleRate*.1){
   if(fallback){
    if(!partialTail)useFallback=true;
    return decodeOriginal(number)!;
   }
   throw Error('This browser could not align the compressed audio. Retry using original audio.');
  }
  const buffer=context.createBuffer(index.channels,frames,context.sampleRate);
  for(let channel=0;channel<index.channels;channel++){
   const source=decoded.getChannelData(channel);
   buffer.getChannelData(channel).set(source.subarray(0,Math.min(frames,source.length)));
  }
  return buffer;
 });
 const clear=stream.clear.bind(stream);
 stream.clear=()=>{clear();void fallbackStream?.then(s=>s.clear()).catch(()=>{});fallbackStream=null;};
 return stream;
}
