import test from 'node:test';
import assert from 'node:assert/strict';
import {wavHeader,WavStream} from '../lib/wav-stream.ts';
import {requiredStems} from '../lib/rehearsal.ts';
import {BandAudio} from '../lib/audio.ts';
import {authorizePrivateAudio} from '../lib/private-audio.ts';
import {deviceAudioCache,assetCacheKey} from '../lib/device-audio-cache.ts';
function header({seconds=240,channels=2,rate=8000,bits=24,format=1,extra=false}={}){
 const block=channels*bits/8,dataBytes=seconds*rate*block,offset=extra?56:44,bytes=new Uint8Array(offset);const v=new DataView(bytes.buffer),word=(at,s)=>bytes.set(new TextEncoder().encode(s),at);
 word(0,'RIFF');v.setUint32(4,offset+dataBytes-8,true);word(8,'WAVE');word(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,format,true);v.setUint16(22,channels,true);v.setUint32(24,rate,true);v.setUint32(28,rate*block,true);v.setUint16(32,block,true);v.setUint16(34,bits,true);if(extra){word(36,'JUNK');v.setUint32(40,4,true)}word(offset-8,'data');v.setUint32(offset-4,dataBytes,true);return {bytes,total:offset+dataBytes,dataBytes,offset,channels,rate,bits,seconds};
}
function recording(options){const h=header(options),calls=[];return {...h,calls,read:async(start,end)=>{calls.push([start,end]);const out=new Uint8Array(end-start+1);for(let i=0;i<out.length;i++){const at=start+i;if(at<h.offset)out[i]=h.bytes[at];else out[i]=(at-h.offset)%6<3?0:127}return out.buffer}}}
class Context{
 currentTime=0;state='running';outputLatency=0;sampleRate=8000;destination={};sources=[];allocations=[];
 createBuffer(channels,length,rate){this.allocations.push(channels*length*4);const data=Array.from({length:channels},()=>new Float32Array(length));return {length,sampleRate:rate,numberOfChannels:channels,duration:length/rate,getChannelData:i=>data[i]}}
 createBufferSource(){const source={playbackRate:{value:1},connect(to){this.to=to},disconnect(){},start(...args){this.args=args},stop(){this.stopped=true},onended:null};this.sources.push(source);return source}
 createGain(){return {gain:{value:1,setValueAtTime(){},exponentialRampToValueAtTime(){},setTargetAtTime(){}},connect(){},disconnect(){}}}
 createOscillator(){return {frequency:{},connect(){},start(){},stop(){}}}
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,10));
test('WAV parser honors metadata chunks, duration, sample rate and PCM boundaries',async()=>{
 const file=recording({extra:true});const h=await wavHeader(file.read,file.total);assert.equal(h.dataOffset,56);assert.equal(h.duration,240);assert.equal(h.channels,2);assert.equal(h.bits,24);assert.ok(file.calls.every(([a,b])=>b-a<65536));
 const truncated=recording({});await assert.rejects(wavHeader(truncated.read,truncated.total-1),/incomplete/);
 const unsupported=recording({format:99});await assert.rejects(wavHeader(unsupported.read,unsupported.total),/format/);
});
test('long stereo stems retain only small chunks rather than decoding entire songs',async()=>{
 const file=recording({seconds:600,rate:44100}),ctx=new Context(),wave=new WavStream(ctx,await wavHeader(file.read,file.total),file.read);
 await wave.prepare(0);assert.equal(wave.chunks.size,2);for(let i=2;i<20;i++)await wave.chunk(i);
 assert.equal(wave.chunks.size,4);assert.ok(Math.max(...ctx.allocations)<=4*44100*2*4);assert.ok([...wave.chunks.values()].reduce((n,b)=>n+b.length*b.numberOfChannels*4,0)<6*1024*1024);
 assert.ok(file.calls.every(([a,b])=>b-a<2*1024*1024));assert.equal(wave.chunks.has(0),false);
});
test('concurrent chunk requests deduplicate and private streams clear without stale refill',async()=>{
 const file=recording({}),ctx=new Context(),wave=new WavStream(ctx,await wavHeader(file.read,file.total),file.read);let release;wave.read=()=>new Promise(resolve=>release=resolve);
 const a=wave.chunk(0),b=wave.chunk(0);wave.clear();release(new ArrayBuffer(wave.chunkFrames*wave.header.blockAlign));assert.equal(await a,await b);assert.equal(wave.chunks.size,0);
});
test('PCM stereo samples decode correctly without decodeAudioData or lowering quality',async()=>{
 const file=recording({seconds:1,bits:24}),ctx=new Context();file.read=async(start,end)=>{const out=new Uint8Array(end-start+1);for(let i=0;i<out.length;i++){const at=start+i;out[i]=at<44?file.bytes[at]:[0,0,128,255,255,127][(at-44)%6]}return out.buffer};const wave=new WavStream(ctx,await wavHeader(file.read,file.total),file.read),buffer=await wave.chunk(0);
 assert.equal(buffer.getChannelData(0)[0],-1);assert.ok(buffer.getChannelData(1)[0]>.999);assert.equal(buffer.sampleRate,8000);assert.equal(buffer.numberOfChannels,2);
});
test('independent device clocks schedule the same transport, loops and stem offsets',async()=>{
 const file=recording({seconds:40}),h=await wavHeader(file.read,file.total),stops=[];
 try{for(const current of [10,100]){const ctx=new Context();ctx.currentTime=current;const wave=new WavStream(ctx,h,file.read);await wave.prepare(12);stops.push(wave.schedule(ctx,{}, {when:current+1,offset:16,stemOffset:2,duration:40,rate:.5,loop:{start:16,end:20}},assert.fail));await settle();assert.ok(ctx.sources.length>=2);assert.equal(ctx.sources[0].args[0],current+1);assert.equal(ctx.sources[0].args[1],2);assert.equal(ctx.sources[0].playbackRate.value,.5);assert.ok(ctx.sources.every(s=>s.args[2]<=4))}}
 finally{stops.forEach(stop=>stop())}
});
test('stopping during a slow segment download never starts stale audio',async()=>{
 const file=recording({}),ctx=new Context(),wave=new WavStream(ctx,await wavHeader(file.read,file.total),file.read);let release;wave.read=()=>new Promise(resolve=>release=resolve);const stop=wave.schedule(ctx,{}, {when:1,offset:0,stemOffset:0,duration:240,rate:1},assert.fail);stop();release(new ArrayBuffer(wave.chunkFrames*wave.header.blockAlign));await settle();assert.equal(ctx.sources.length,0);
});
test('streamed stems preserve audience filtering and mixer gains in the audio engine',async()=>{
 const ctx=new Context(),file=recording({seconds:20}),h=await wavHeader(file.read,file.total),engine=new BandAudio();engine.context=ctx;engine.now=()=>0;engine.audience=true;engine.stems=true;
 const song={id:'song',duration:20,bpm:120,beats:4,countIn:0,beatOffset:0,stems:[{id:'music',enabled:true,volume:.7,pan:0},{id:'click',category:'click',bandOnly:true,enabled:true,volume:1}],sections:[]};
 for(const stem of song.stems){const wave=new WavStream(ctx,h,file.read);await wave.prepare();engine.streams.set(stem.id,wave)}
 try{engine.start(song,{status:'playing',run:'shared',startAt:1000,offset:0,countIn:0});await settle();assert.ok(ctx.sources.length);assert.equal(engine.gains.has('click'),false);assert.equal(engine.gains.get('music').gain.value,.7);engine.stop();assert.ok(ctx.sources.every(s=>s.stopped))}finally{engine.stop()}
});
function installCache(t,store){const before=globalThis.caches;globalThis.caches={open:async()=>store};t.after(()=>{if(before===undefined)delete globalThis.caches;else globalThis.caches=before})}
class Store{entries=new Map();async match(r){return this.entries.get(r.url)?.clone()}async put(r,res){this.entries.set(r.url,new Response(await res.arrayBuffer(),{headers:res.headers}))}async keys(){return [...this.entries.keys()].map(url=>new Request(url))}async delete(r){return this.entries.delete(r.url)}}
test('private ranges authorize first, reuse disk segments and preserve signed-download isolation',async t=>{
 const store=new Store();installCache(t,store);let auth=0,transfer=0;let denied=false;
 t.mock.method(globalThis,'fetch',async(url,options)=>{if(url.includes('authorize=1')){auth++;if(denied)return new Response('{}',{status:403});return Response.json({cacheScope:'band:user',assetId:'stem',bytes:20,downloadUrl:'https://audio.example/private'})}transfer++;assert.equal(options.credentials,'omit');assert.deepEqual(options.headers,{Range:'bytes=4-7'});return new Response(new Uint8Array([4,5,6,7]),{status:206,headers:{'content-range':'bytes 4-7/20'}})});
 try{await deviceAudioCache.clear();const stem={id:'stem',bytes:20,name:'Drums'};assert.deepEqual([...new Uint8Array(await (await authorizePrivateAudio('song',stem)).range(4,7))],[4,5,6,7]);await (await authorizePrivateAudio('song',stem)).range(4,7);assert.equal(auth,2);assert.equal(transfer,1);denied=true;await assert.rejects(authorizePrivateAudio('song',stem),/access ended/);assert.equal(transfer,1)}finally{await deviceAudioCache.clear()}
});
test('private range renewals enforce revocation even when the segment is cached',async t=>{
 const store=new Store();installCache(t,store);let now=0,requests=0;t.mock.method(Date,'now',()=>now);t.mock.method(globalThis,'fetch',async(url)=>{if(url.includes('authorize=1')){requests++;if(requests>1)return new Response('{}',{status:403});return Response.json({cacheScope:'band:user',assetId:'stem',bytes:20,downloadUrl:'https://audio.example/private'})}return new Response(new Uint8Array(4),{status:206})});
 try{await deviceAudioCache.clear();const audio=await authorizePrivateAudio('song',{id:'stem',bytes:20,name:'Drums'});await audio.range(4,7);now=46000;await assert.rejects(audio.range(4,7),/access ended/)}finally{await deviceAudioCache.clear()}
});
test('existing full-file cache can supply bounded ranges without a second download',async t=>{
 const store=new Store();installCache(t,store);t.mock.method(globalThis,'fetch',async url=>{assert.ok(url.includes('authorize=1'));return Response.json({cacheScope:'band:user',assetId:'stem',bytes:20,downloadUrl:'https://audio.example/private'})});
 try{await deviceAudioCache.clear();await deviceAudioCache.put(assetCacheKey('band:user','stem',20),Uint8Array.from({length:20},(_,i)=>i).buffer,20);assert.deepEqual([...new Uint8Array(await (await authorizePrivateAudio('song',{id:'stem',bytes:20,name:'Drums'})).range(10,13))],[10,11,12,13])}finally{await deviceAudioCache.clear()}
});

test('late ranges catch up to the shared position rather than shifting the device timeline',async()=>{
 const file=recording({seconds:40}),ctx=new Context(),wave=new WavStream(ctx,await wavHeader(file.read,file.total),file.read);let first=true;
 const read=wave.read;wave.read=async(a,b)=>{if(first){first=false;ctx.currentTime=2}return read(a,b)};
 const stop=wave.schedule(ctx,{}, {when:1,offset:12,stemOffset:0,duration:40,rate:1},assert.fail);
 try{await settle();assert.ok(ctx.sources.length);assert.equal(ctx.sources[0].args[0],2.005);assert.ok(Math.abs(ctx.sources[0].args[1]-1.005)<1e-9);assert.ok(ctx.sources.every(source=>source.args[0]>=ctx.currentTime))}finally{stop()}
});
test('seeking near the end reads only the destination chunks',async()=>{
 const file=recording({seconds:600}),ctx=new Context(),wave=new WavStream(ctx,await wavHeader(file.read,file.total),file.read);file.calls.length=0;
 await wave.prepare(594);assert.equal(wave.chunks.size,2);assert.ok(file.calls.every(([start])=>start>=file.offset+592*file.rate*6));
});
test('a server ignoring Range is rejected before the full song body is decoded or cached',async t=>{
 const store=new Store();installCache(t,store);t.mock.method(globalThis,'fetch',async url=>url.includes('authorize=1')?Response.json({cacheScope:'band:user',assetId:'stem',bytes:100,downloadUrl:'https://audio.example/private'}):new Response(new Uint8Array(100),{status:200}));
 try{await deviceAudioCache.clear();const audio=await authorizePrivateAudio('song',{id:'stem',bytes:100,name:'Drums'});await assert.rejects(audio.range(4,7),/requested segment/);assert.equal(store.entries.size,0)}finally{await deviceAudioCache.clear()}
});
test('muted originals do not consume audio memory after instrument processing',()=>{
 const stems=[{id:'original',name:'Full recording',source:'import',enabled:false},{id:'drums',source:'ai',enabled:true},{id:'bass',source:'ai',enabled:false},{id:'click',category:'click',bandOnly:true,enabled:true}];
 assert.deepEqual(requiredStems({stems}).map(s=>s.id),['drums','bass','click']);assert.deepEqual(requiredStems({stems},true).map(s=>s.id),['drums','bass']);
 assert.equal(requiredStems({stems:[{...stems[0],enabled:true},...stems.slice(1)]})[0].id,'original');
});
test('segment writes reuse the disk index instead of rescanning every cached response',async()=>{
 const {DeviceAudioCache}=await import('../lib/device-audio-cache.ts');const store=new Store();let scans=0;const keys=store.keys.bind(store);store.keys=async()=>{scans++;return keys()};const cache=new DeviceAudioCache(async()=>store,()=>12);
 for(let i=0;i<6;i++)assert.equal(await cache.put('chunk-'+i,new Uint8Array(4).buffer,4),true);
 assert.equal(scans,1);assert.equal(await cache.has('chunk-0'),false);assert.equal(await cache.has('chunk-5'),true);assert.equal(store.entries.size,3);
});

test('streamed practice loops leave the requested silent rest between repetitions',async()=>{
 const file=recording({seconds:20}),ctx=new Context(),wave=new WavStream(ctx,await wavHeader(file.read,file.total),file.read);await wave.prepare(0);
 const stop=wave.schedule(ctx,{}, {when:1,offset:0,stemOffset:0,duration:20,rate:1,loop:{start:0,end:2,rest:3}},assert.fail);
 try{await settle();assert.ok(ctx.sources.length>=2);assert.equal(ctx.sources[0].args[0],1);assert.equal(ctx.sources[0].args[2],2);assert.equal(ctx.sources[1].args[0],6);assert.equal(ctx.sources[1].args[1],0)}finally{stop()}
});

test('decoded loops add silent rest frames without copying later song audio into the gap',()=>{
 const ctx=new Context(),engine=new BandAudio();engine.context=ctx;engine.now=()=>1000;engine.generatedClick=false;const buffer=ctx.createBuffer(1,8000*10,8000);buffer.getChannelData(0).fill(.5);engine.buffers.set('drums',buffer);
 const song={id:'rest',duration:10,bpm:120,beats:4,beatOffset:0,countIn:0,stems:[{id:'drums',name:'Drums',enabled:true,volume:1}],sections:[]};
 try{engine.start(song,{status:'playing',run:'rest-run',startAt:1000,offset:0,countIn:0,rate:1,loop:{start:0,end:2,rest:3}});const piece=ctx.sources[0].buffer;assert.equal(piece.duration,5);assert.equal(piece.getChannelData(0)[100],.5);assert.equal(piece.getChannelData(0)[8000*3],0)}finally{engine.stop()}
});

test('different devices preserve the same slowed repeat and real-time rest schedule',async()=>{
 const file=recording({seconds:40}),h=await wavHeader(file.read,file.total),stops=[];
 try{for(const now of [10,100]){const ctx=new Context();ctx.currentTime=now;const wave=new WavStream(ctx,h,file.read);await wave.prepare(16);stops.push(wave.schedule(ctx,{}, {when:now+.5,offset:16,stemOffset:0,duration:40,rate:.5,loop:{start:16,end:18,rest:3}},assert.fail));await settle();assert.equal(ctx.sources[0].args[0],now+.5);assert.equal(ctx.sources[1].args[0],now+7.5);assert.equal(ctx.sources[0].playbackRate.value,.5)}}finally{stops.forEach(stop=>stop())}
});
