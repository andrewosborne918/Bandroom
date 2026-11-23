import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,readdirSync} from 'node:fs';import {PGlite} from '@electric-sql/pglite';
import {BandAudio} from '../lib/audio.ts';
import {clockSample,calibratedClock,outputAudioTime} from '../lib/audio-clock.ts';import {playbackIndex,packedStream,PackedAudioError} from '../lib/packed-audio.ts';import {countInSeconds,countInPlan} from '../lib/timeline.ts';
test('clock calibration rejects invalid measurements, expires stale samples and ignores slow outliers',()=>{assert.throws(()=>clockSample(10,20,100,90));const samples=[clockSample(0,10,100003,100003),clockSample(20,30,100023,100023),clockSample(40,440,100240,100240)];const clock=calibratedClock(samples,450);assert.equal(clock.offset,99998);assert.equal(clock.uncertainty,5);assert.equal(calibratedClock(samples,70000),null);assert.equal(calibratedClock(samples,50000).fresh,false)});
test('audible timestamp maps shared server time without counting latency twice',()=>{const context={currentTime:10,outputLatency:.1,getOutputTimestamp:()=>({contextTime:9.9,performanceTime:1000})};assert.ok(Math.abs(outputAudioTime(context,200000,199000,1100)-11)<1e-9);assert.equal(outputAudioTime({currentTime:10,outputLatency:.1},200000,199000,1100),10.9)});
function packed(tailFrames=44100){const raw={version:1,codec:'aac',channels:2,sampleRate:44100,frames:44100*4+tailFrames,chunkSeconds:4,segments:[{bytes:20,frames:44100*4},{bytes:10,frames:tailFrames}]},json=new TextEncoder().encode(JSON.stringify(raw)),bytes=new Uint8Array(8+json.length+30);bytes.set(new TextEncoder().encode('BNA1'));new DataView(bytes.buffer).setUint32(4,json.length,true);bytes.set(json,8);return bytes}
test('compressed index validates every range, frame boundary and complete file length',async()=>{const bytes=packed(),read=async(a,b)=>bytes.slice(a,b+1).buffer,index=await playbackIndex(read,bytes.length);assert.equal(index.segments[0].end+1,index.segments[1].start);assert.equal(index.segments[1].frames,44100);await assert.rejects(playbackIndex(read,bytes.length-1),/Incomplete/);bytes[0]=0;await assert.rejects(playbackIndex(read,bytes.length),/Invalid/) });
test('AAC decoding is cropped to the exact source grid after browser resampling',async()=>{const bytes=packed(),read=async(a,b)=>bytes.slice(a,b+1).buffer,index=await playbackIndex(read,bytes.length),allocations=[];const context={sampleRate:48000,decodeAudioData:async()=>({numberOfChannels:2,length:192000+512,getChannelData:()=>new Float32Array(192000+512).fill(.25)}),createBuffer:(channels,length,rate)=>{allocations.push(length);const data=Array.from({length:channels},()=>new Float32Array(length));return {numberOfChannels:channels,length,duration:length/rate,sampleRate:rate,getChannelData:i=>data[i]}}};const stream=packedStream(context,index,read),a=await stream.chunk(0),b=await stream.chunk(0);assert.equal(a,b);assert.equal(a.length,192000);assert.equal(a.getChannelData(1)[0],.25);assert.deepEqual(allocations,[192000])});
test('legacy AAC final segments preserve the indexed duration despite MP4 rounding',async()=>{
 const sampleRate=48000;
 const context={
  sampleRate,
  createBuffer:(channels,length,rate)=>{
   const data=Array.from({length:channels},()=>new Float32Array(length));
   return {length,duration:length/rate,getChannelData:channel=>data[channel]};
  },
  decodeAudioData:async data=>{
   const length=data.byteLength===20?191986:12047;
   return {numberOfChannels:2,length,getChannelData:()=>new Float32Array(length).fill(.25)};
  },
 };
 const bytes=packed(11081),read=async(a,b)=>bytes.slice(a,b+1).buffer;
 const index=await playbackIndex(read,bytes.length),stream=packedStream(context,index,read);
 const tail=await stream.chunk(1);
 assert.equal(tail.length,12061);
 assert.equal(tail.getChannelData(0)[12046],.25);
 assert.ok(tail.getChannelData(0).slice(12047).every(sample=>sample===0));
 await assert.rejects(stream.chunk(0),/could not align/);
 context.decodeAudioData=async()=>({numberOfChannels:2,length:11900});
 await assert.rejects(packedStream(context,index,read).chunk(1),/could not align/);

 const tinyBytes=packed(32),readTiny=async(a,b)=>tinyBytes.slice(a,b+1).buffer;
 const tinyIndex=await playbackIndex(readTiny,tinyBytes.length);
 context.decodeAudioData=async()=>{throw new DOMException('Unable to decode audio data','EncodingError')};
 const tinyTail=await packedStream(context,tinyIndex,readTiny).chunk(1);
 assert.equal(tinyTail.length,35);
 assert.ok(tinyTail.getChannelData(0).every(sample=>sample===0));
 await assert.rejects(packedStream(context,index,read).chunk(1),error=>error instanceof PackedAudioError&&error.cause?.name==='EncodingError');
 await assert.rejects(packedStream(context,tinyIndex,async()=>{throw Error('Network unavailable')}).chunk(1),/Network unavailable/);
});
const db=new PGlite();await db.exec(readFileSync('tests/supabase-stubs.sql','utf8'));for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
const owner=crypto.randomUUID(),member=crypto.randomUUID(),stranger=crypto.randomUUID();async function service(sql,args=[]){await db.exec('reset role');return db.query(sql,args)}async function user(id,sql,args=[]){await db.exec("reset role;select set_config('request.jwt.claim.sub','"+id+"',false);set role authenticated;");return db.query(sql,args)}
for(const [id,name] of [[owner,'Owner'],[member,'Member'],[stranger,'Stranger']])await service('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,name+'@test.invalid']);const band=(await user(owner,"select create_band('Playback') id")).rows[0].id;await service("insert into band_memberships(band_id,user_id,role) values($1,$2,'member')",[band,member]);const song=crypto.randomUUID(),asset=crypto.randomUUID();await user(owner,'insert into songs(id,band_id,data,created_by) values($1,$2,$3,$4)',[song,band,JSON.stringify({id:song,title:'Test',duration:60,stems:[],sections:[]}),owner]);await user(owner,"select reserve_upload($1,$2,$3,$4,'guitar.wav',1000,60,44100,'import')",[band,song,asset,crypto.randomUUID()]);await service("select finalize_upload($1,1000,60,44100,'guitar')",[asset]);
test('playback tasks are private, lease-protected, quota-counted and idempotent',async()=>{await assert.rejects(user(member,'select * from audio_playbacks'),/permission denied/);await assert.rejects(user(owner,"select claim_audio_playback($1,'rogue')",[band]),/permission denied/);const job=(await service("select claim_audio_playback($1,'lease') job",[band])).rows[0].job;assert.equal(job.id,asset);assert.equal((await service("select claim_audio_playback($1,'other') job",[band])).rows[0].job,null);await assert.rejects(service("select finish_audio_playback($1,'wrong',512,null)",[asset]),/Stale/);await service("select finish_audio_playback($1,'lease',512,null)",[asset]);await service("select finish_audio_playback($1,'lease',512,null)",[asset]);await service('select reconcile_usage($1)',[band]);assert.equal(Number((await service('select stored_bytes from band_usage where band_id=$1',[band])).rows[0].stored_bytes),1512)});
test('shared starts wait for every current device to prepare the exact run with a healthy clock',async()=>{const state={code:'SYNC0001',name:'Test',songIds:[song],songId:song,transport:{status:'preparing',run:'run-1',offset:30,startAt:0,countIn:2}};const session=(await user(owner,"select * from new_session($1,'SYNC0001',$2)",[band,JSON.stringify(state)])).rows[0];const host=crypto.randomUUID(),phone=crypto.randomUUID();await user(owner,"select join_device($1,$2,'Host','musician','Leader')",[session.id,host]);await user(member,"select join_device($1,$2,'Phone','musician','Guitar')",[session.id,phone]);await assert.rejects(user(stranger,"select report_audio_ready($1,$2,true,$3,'run-1',5)",[session.id,phone,song]),/denied/);await user(owner,"select report_audio_ready($1,$2,true,$3,'run-1',5)",[session.id,host,song]);await user(member,"select report_audio_ready($1,$2,true,$3,'old-run',5)",[session.id,phone,song]);await service("select start_prepared_audio($1,'run-1')",[session.id]);assert.equal((await service('select data from playback_sessions where id=$1',[session.id])).rows[0].data.transport.status,'preparing');await user(member,"select report_audio_ready($1,$2,true,$3,'run-1',500)",[session.id,phone,song]);await service("select start_prepared_audio($1,'run-1')",[session.id]);assert.equal((await service('select data from playback_sessions where id=$1',[session.id])).rows[0].data.transport.status,'preparing');await user(member,"select report_audio_ready($1,$2,true,$3,'run-1',5)",[session.id,phone,song]);await service("select start_prepared_audio($1,'run-1')",[session.id]);const next=(await service('select data from playback_sessions where id=$1',[session.id])).rows[0].data.transport;assert.equal(next.status,'playing');assert.equal(next.offset,30);assert.ok(next.startAt>Date.now()+4500);await service("select start_prepared_audio($1,'run-1')",[session.id]);assert.equal((await service('select data from playback_sessions where id=$1',[session.id])).rows[0].data.transport.startAt,next.startAt);await user(owner,'select grant_control($1,$2,true)',[session.id,member]);await user(owner,'select leave_device($1)',[host]);await service("update playback_sessions set data=jsonb_set(data,'{transport}', $2::jsonb) where id=$1",[session.id,JSON.stringify({...next,status:'preparing',run:'controller-run',startAt:0})]);await user(member,"select report_audio_ready($1,$2,true,$3,'controller-run',5)",[session.id,phone,song]);await service("select start_prepared_audio($1,'controller-run')",[session.id]);assert.equal((await service('select data from playback_sessions where id=$1',[session.id])).rows[0].data.transport.status,'playing')});
test('deleting a source schedules playback cleanup and releases derived storage',async()=>{await user(owner,'delete from songs where id=$1',[song]);assert.equal((await service('select * from audio_playbacks where asset_id=$1',[asset])).rows.length,0);assert.equal(Number((await service('select stored_bytes from band_usage where band_id=$1',[band])).rows[0].stored_bytes),0);assert.ok((await service("select * from cleanup_jobs where bucket='stems' and object_key like '%playback-%'")).rows.length)});
test.after(()=>db.close());

test('preparation buffers the requested seek position, rather than elapsed wall-clock time',async()=>{const engine=new BandAudio(),positions=[];engine.now=()=>1000000000;engine.streams.set('stem',{prepare:async position=>positions.push(position)});await engine.preparePlayback({duration:200,stems:[{id:'stem',offset:2}]},{status:'preparing',run:'seek',offset:60,startAt:0,countIn:2});assert.deepEqual(positions,[58])});
test('device drift detects a clock correction against the original scheduled start',()=>{const engine=new BandAudio();engine.context={currentTime:10,state:'running',outputLatency:0};engine.run='run';engine.startTarget=10;engine.now=()=>200000;const transport={run:'run',startAt:200000};assert.equal(engine.driftMs(transport),0);engine.now=()=>200080;assert.ok(Math.abs(engine.driftMs(transport)+80)<1e-9);assert.equal(engine.driftMs({...transport,run:'old-run'}),0)});

test('audio enable rejects an interrupted output instead of claiming readiness',async()=>{
 const engine=new BandAudio();engine.context={state:'interrupted',resume:async()=>{}};
 await assert.rejects(engine.arm(),/interrupted/);assert.equal(engine.ready,false);
 assert.throws(()=>engine.start({stems:[]},{status:'playing',run:'silent'}),/interrupted/);
});
test('reconnecting output replaces the old context and invalidates its stream cache',async()=>{
 const prior=globalThis.AudioContext;let oldClosed=false,cleared=false;
 globalThis.AudioContext=class{state='suspended';resume(){this.state='running';return Promise.resolve()}};
 const engine=new BandAudio();engine.context={state:'running',close:async()=>{oldClosed=true}};
 engine.streams.set('old',{clear:()=>{cleared=true}});engine.bufferKeys.set('old','cached');
 try{await engine.reconnectOutput();assert.equal(oldClosed,true);assert.equal(cleared,true);assert.equal(engine.streams.size,0);assert.equal(engine.bufferKeys.size,0);assert.equal(engine.ready,true)}finally{globalThis.AudioContext=prior}
});
test('playback follows the system output and reports the current context’s interruptions',async()=>{
 const previous=globalThis.AudioContext;
 const sinks=[],states=[];
 globalThis.AudioContext=class{
  state='suspended';
  constructor(options){sinks.push(options.sinkId)}
  async resume(){this.state='running'}
  async close(){this.state='closed';this.onstatechange()}
 };
 try{
  const engine=new BandAudio();
  engine.onOutputStateChange=state=>states.push(state);
  await engine.arm();
  const first=engine.context;
  first.state='interrupted';first.onstatechange();
  first.state='running';first.onstatechange();
  await engine.reconnectOutput();
  assert.deepEqual(sinks,['','']);
  assert.deepEqual(states,['interrupted','running']);
  assert.equal(engine.ready,true);
 }finally{if(previous)globalThis.AudioContext=previous;else delete globalThis.AudioContext}
});
test('sound check bypasses a muted monitor mix and uses a bounded low-volume tone',async()=>{
 const engine=new BandAudio(),levels=[],times=[];let connected,disconnected=false;
 const gain={gain:{setValueAtTime:v=>levels.push(v),linearRampToValueAtTime:v=>levels.push(v)},connect:to=>{connected=to},disconnect(){}};
 const tone={frequency:{value:0},connect(){},disconnect(){disconnected=true},start:t=>times.push(t),stop:t=>times.push(t)};
 engine.context={state:'running',currentTime:10,destination:{speaker:true},resume:async()=>{},createOscillator:()=>tone,createGain:()=>gain};engine.stems=false;engine.click=false;
 await engine.testOutput();assert.equal(connected,engine.context.destination);assert.deepEqual(levels,[0,.06,0]);assert.ok(times[1]-times[0]<=.51);tone.onended();assert.equal(disconnected,true);
});

test('channel sound checks isolate left and right and can stop without stopping music',async()=>{
 for(const channel of [0,1]){
  const engine=new BandAudio();
  const connections=[];
  let stopped=false,disconnected=false;
  const merger={connect:target=>connections.push(['output',target]),disconnect:()=>{disconnected=true}};
  const gain={gain:{setValueAtTime(){},linearRampToValueAtTime(){}},connect:(target,output,input)=>connections.push(['channel',target,output,input]),disconnect(){}};
  const tone={frequency:{value:0},connect(){},disconnect(){},start(){},stop:at=>{if(at===undefined)stopped=true}};
  engine.context={state:'running',currentTime:0,destination:{speaker:true},resume:async()=>{},createGain:()=>gain,createOscillator:()=>tone,createChannelMerger:()=>merger};
  await engine.testOutput(channel);
  assert.deepEqual(connections[0],['channel',merger,0,channel]);
  assert.equal(connections[1][1],engine.context.destination);
  engine.stopOutputTest();
  assert.equal(stopped,true);
  tone.onended();
  assert.equal(disconnected,true);
 }
});

test('packedStream falls back to original PCM WAV seamlessly when browser AAC alignment fails',async()=>{
 const sampleRate=44100,channels=2,tailFrames=11081,totalFrames=sampleRate*4+tailFrames;
 const wavBytes=new Uint8Array(44+totalFrames*channels*2);
 const v=new DataView(wavBytes.buffer);
 new TextEncoder().encodeInto('RIFF',wavBytes.subarray(0,4));v.setUint32(4,wavBytes.length-8,true);
 new TextEncoder().encodeInto('WAVE',wavBytes.subarray(8,12));new TextEncoder().encodeInto('fmt ',wavBytes.subarray(12,16));
 v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,channels,true);v.setUint32(24,sampleRate,true);
 v.setUint32(28,sampleRate*channels*2,true);v.setUint16(32,channels*2,true);v.setUint16(34,16,true);
 new TextEncoder().encodeInto('data',wavBytes.subarray(36,40));v.setUint32(40,totalFrames*channels*2,true);
 // Fill tail sample with a known non-zero value so we verify PCM fallback was actually used.
 v.setInt16(44+sampleRate*4*channels*2,16384,true);
 const fallbackRead=async(a,b)=>wavBytes.slice(a,b+1).buffer;
 const bytes=packed(tailFrames),read=async(a,b)=>bytes.slice(a,b+1).buffer;
 const index=await playbackIndex(read,bytes.length);
 const context={
  sampleRate:48000,
  createBuffer:(ch,length,rate)=>{
   const data=Array.from({length:ch},()=>new Float32Array(length));
   return {numberOfChannels:ch,length,duration:length/rate,sampleRate:rate,getChannelData:c=>data[c]};
  },
  // Simulate a browser whose AAC decoder returns a badly misaligned tail segment.
  decodeAudioData:async()=>({numberOfChannels:2,length:9000,getChannelData:()=>new Float32Array(9000)}),
 };
 const stream=packedStream(context,index,read,{read:fallbackRead,bytes:wavBytes.length});
 const tail=await stream.chunk(1);
 assert.equal(tail.length,tailFrames);
 assert.ok(Math.abs(tail.getChannelData(0)[0]-0.5)<1e-3);
});

test('count-in matches the song groove BPM and aligns seamlessly onto the first song beat',()=>{
 // Song at 120 BPM (0.5s/beat), but beat 0->1 has a noisy 0.72s intro gap and beatOffset is 0.35s.
 const beats=[0.35,1.07,1.57,2.07,2.57,3.07,3.57,4.07,4.57,5.07];
 const song={id:'s',title:'Test',artist:'',duration:60,bpm:120,beats:4,denominator:4,key:'C',countIn:1,beatOffset:0.35,stems:[],sections:[],analysis:{version:1,bpm:120,key:'C',beats,lyrics:[],chords:[],methods:{},warnings:[]}};
 // Median beat interval ignores the single 0.72s outlier and uses 0.5s => 4 * 0.5 = 2.0s count-in.
 const ci=countInSeconds(song,0);
 assert.ok(Math.abs(ci-2.0)<1e-6);
 const startAt=10000;
 const plan=countInPlan(song,{startAt,offset:0,countIn:ci,rate:1});
 assert.equal(plan.countBeats,4);
 assert.ok(Math.abs(plan.intervalMs-500)<1e-6);
 // Last count-in click (i=3) is exactly one beat (500ms) before song beat 1 (startAt + 350ms).
 const lastCountIn=plan.countStartMs+3*plan.intervalMs;
 const songBeat1=startAt+350;
 assert.ok(Math.abs((songBeat1-lastCountIn)-500)<1e-6);
 assert.equal(plan.leadInBeats.length,0);

 // When beatOffset is 1.35s (more than 2 beats after 0), count-in stays phase-locked and adds 2 lead-in clicks.
 const lateSong={...song,beatOffset:1.35,analysis:{...song.analysis,beats:beats.map(b=>b+1.0)}};
 const latePlan=countInPlan(lateSong,{startAt,offset:0,countIn:2.0,rate:1});
 assert.equal(latePlan.leadInBeats.length,2);
 const allClicks=[
  ...Array.from({length:4},(_,i)=>latePlan.countStartMs+i*latePlan.intervalMs),
  ...latePlan.leadInBeats.map(b=>b.at),
  startAt+1350,
 ];
 for(let i=1;i<allClicks.length;i++)assert.ok(Math.abs((allClicks[i]-allClicks[i-1])-500)<1e-6);
});
test('count-in uses the entering tempo and skips a beat just before the playback offset',()=>{
 const beats=[0,.5,1,1.5,2,2.75,3.5,4.25,5,5.75];
 const song={bpm:120,beats:4,countIn:1,beatOffset:0,analysis:{beats}};
 const startAt=10000,offset=2.0005,countIn=countInSeconds(song,offset);
 assert.equal(countIn,3);
 const plan=countInPlan(song,{startAt,offset,countIn});
 const firstSongBeat=startAt+(2.75-offset)*1000;
 const lastCountClick=plan.countStartMs+3*plan.intervalMs;
 assert.ok(Math.abs(firstSongBeat-lastCountClick-750)<.001);
 assert.equal(plan.firstCountIndex,1);
});
