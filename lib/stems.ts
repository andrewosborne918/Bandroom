import type { Stem } from './types';
export const categories=['vocals','drums','bass','guitar','keyboards','backing vocals','other','click','spoken cues'] as const;
export type Category=typeof categories[number];
export const restricted=(s:Partial<Stem>)=>!!s.bandOnly||s.category==='click'||s.category==='spoken cues';
export function suggest(filename:string){const name=filename.replace(/\.[^.]+$/,'').replace(/[_-]/g,' ').trim();const category:Category=/click|metronome|count.?in/i.test(name)?'click':/cue|spoken/i.test(name)?'spoken cues':/back.*vocal|bgv|harmony/i.test(name)?'backing vocals':/vocal|voice/i.test(name)?'vocals':/drum|perc/i.test(name)?'drums':/bass/i.test(name)?'bass':/guitar/i.test(name)?'guitar':/key|piano|organ|synth/i.test(name)?'keyboards':'other';return {name,category};}
export type SeparationJob={progress?:import('./job-progress').JobProgress;processingStarted?:number;id:string;songId:string;owner?:string;filename:string;duration:number;sampleRate:number;bytes:number;status:'uploading'|'queued'|'processing'|'completed'|'failed';created:number;updated:number;attempt:number;error?:string;lease?:string;leaseUntil?:number;analysis?:import('./analysis').AudioAnalysis;stems:Stem[];saved?:boolean};
export type ProcessingConfig={AUDD_API_TOKEN?:string;RECOGNITION_ENABLED?:string;BACKGROUND_SECRET?:string;SEPARATION_PRICE?:string;MAX_AUDIO_BYTES?:string;MAX_AUDIO_SECONDS?:string;AUTO_PROCESS_UPLOADS?:string;MAC_SETUP_CODE?:string;SITES_WORKER_TOKEN?:string};
export const limits=(env:ProcessingConfig)=>({bytes:Math.max(1024,Math.min(100*1024*1024,Number(env.MAX_AUDIO_BYTES)||60*1024*1024)),seconds:Math.max(1,Math.min(7200,Number(env.MAX_AUDIO_SECONDS)||1200))});
export async function audioStream(request:Request,max:number){
 const size=Number(request.headers.get('content-length'));if(!size||size>max)throw Object.assign(new Error('File exceeds the upload limit or has no size.'),{status:413});
 if(!request.body)throw Object.assign(new Error('Empty audio file'),{status:400});
 const reader=request.body.getReader();const first=await reader.read();const b=first.value||new Uint8Array();const ascii=new TextDecoder().decode(b.slice(0,16));
 if(!(ascii.startsWith('RIFF')&&ascii.slice(8,12)==='WAVE'||ascii.startsWith('ID3')||ascii.slice(4,8)==='ftyp'||b[0]===255&&(b[1]&224)===224))throw Object.assign(new Error('Unsupported audio. Upload WAV, MP3, M4A, or AAC.'),{status:415});
 let seen=b.length;const stream=new ReadableStream<Uint8Array>({start(c){c.enqueue(b)},async pull(c){const r=await reader.read();if(r.done){if(seen!==size)c.error(new Error('Incomplete upload'));else c.close();return;}seen+=r.value.length;if(seen>max||seen>size){await reader.cancel();c.error(new Error('Upload exceeds limit'));return;}c.enqueue(r.value)},cancel(){return reader.cancel()}});
 if(typeof FixedLengthStream!=='undefined'){const fixed=new FixedLengthStream(size);void stream.pipeTo(fixed.writable).catch(()=>{});return {size,stream:fixed.readable};}return {size,stream};
}

export async function listObjects(bucket:R2Bucket,prefix:string){const objects:R2Object[]=[];let cursor:string|undefined;do{const page=await bucket.list({prefix,limit:1000,cursor});objects.push(...page.objects);cursor=page.truncated?page.cursor:undefined;}while(cursor);return objects;}
