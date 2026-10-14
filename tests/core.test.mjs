import test from 'node:test';
import assert from 'node:assert/strict';
import { handleBand } from '../lib/band-api.ts';
import { sectionAt, sectionStart, transpose } from '../lib/timeline.ts';
import { BandAudio } from '../lib/audio.ts';
class Bucket {
  items=new Map(); rev=0;
  async get(k){const o=this.items.get(k);return o?{etag:o.etag,httpMetadata:o.meta,body:o.body,json:async()=>JSON.parse(o.body)}:null;}
  async put(k,body,opts={}){const old=this.items.get(k);if(opts.onlyIf?.etagMatches&&old?.etag!==opts.onlyIf.etagMatches)return null;if(opts.onlyIf?.etagDoesNotMatch==='*'&&old)return null;this.items.set(k,{body:body instanceof ReadableStream?new Uint8Array(await new Response(body).arrayBuffer()):body,meta:opts.httpMetadata,etag:String(++this.rev)});return {etag:String(this.rev)};}
  async list({prefix}){return {objects:[...this.items.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key}))};}
  async delete(keys){for(const k of Array.isArray(keys)?keys:[keys])this.items.delete(k);}
}
const base={title:'Rehearsal',bpm:120,beats:4,denominator:4,key:'G',countIn:1,duration:32,sections:[{id:'verse',name:'Verse',bars:8,lyrics:'Original lyric',chords:'[G] Original [C] lyric',tabs:{Guitar:'e|--3--|'}}]};
const request=(path,method='GET',data,token,user='owner')=>new Request('https://bandroom.test/api/band/'+path,{method,headers:{...(user?{'oai-authenticated-user-id':user}:{}),...(token?{'x-band-token':token}:{}),...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
async function call(db,...args){const r=await handleBand(request(...args),db);return {status:r.status,body:await r.json()};}
test('song isolation, shared sessions, authorization, uploads, and transport',async()=>{
 const db=new Bucket();
 assert.equal((await call(db,'songs','GET',null,null,null)).status,401);
 const created=await call(db,'songs','POST',base);assert.equal(created.status,201);const sid=created.body.id;
 assert.equal((await call(db,'songs/'+sid,'GET',null,null,'stranger')).status,404);
 const fileRequest=new Request('https://bandroom.test/api/band/stems?song='+sid+'&name=Drums&filename=drums.wav&duration=32',{method:'POST',headers:{'oai-authenticated-user-id':'owner','Content-Length':'16','Content-Type':'audio/wav'},body:new TextEncoder().encode('RIFF0000WAVEdata')});
 const upload=await handleBand(fileRequest,db);assert.equal(upload.status,201);const stemSong=await upload.json();assert.equal(stemSong.stems.length,1);const stem=stemSong.stems[0];
 const sr=await call(db,'sessions','POST',{songIds:[sid],name:'Friday'});assert.equal(sr.status,201);const host=sr.body.token,code=sr.body.session.code;
 assert.equal(sr.body.session.hostToken,undefined);assert.equal(sr.body.session.owner,undefined);
 assert.equal((await call(db,'sessions/'+code)).status,403);
 const joins=await Promise.all(['Alice','Bob'].map(name=>call(db,'sessions/'+code+'/join','POST',{name,instrument:'Guitar'},null,'guest')));
 assert.ok(joins.every(j=>j.status===200));const member=joins[0].body.token;
 const read=await call(db,'sessions/'+code,'GET',null,member,'guest');assert.equal(read.body.members.length,2);assert.equal(read.body.memberTokens,undefined);
 const ready=await call(db,'sessions/'+code+'/ready','POST',{ready:true,songId:sid},member,'guest');assert.equal(ready.status,200);assert.equal(ready.body.session.members.filter(m=>m.ready).length,1);
 assert.equal((await call(db,'sessions/'+code+'/action','POST',{action:'play'},member,'guest')).status,403);
 const t0=Date.now();const played=await call(db,'sessions/'+code+'/action','POST',{action:'play',offset:0},host);assert.equal(played.status,200);assert.equal(played.body.session.transport.countIn,2);assert.ok(played.body.session.transport.startAt>=t0+5000);
 assert.equal((await call(db,'sessions/'+code+'/action','POST',{action:'mix',stems:[]},host)).status,200);
 assert.equal((await call(db,'sessions/'+code+'/action','POST',{action:'select',songId:'wrong'},host)).status,400);
 const stopped=await call(db,'sessions/'+code+'/action','POST',{action:'stop',offset:8},host);assert.equal(stopped.body.session.transport.offset,8);
 const resumed=await call(db,'sessions/'+code+'/action','POST',{action:'play',offset:8},host);assert.equal(resumed.body.session.transport.countIn,2);
 const audio=await handleBand(request('audio/'+sid+'/'+stem.id+'?session='+code,'GET',null,member,'guest'),db);assert.equal(audio.status,200);assert.equal((await audio.arrayBuffer()).byteLength,16);
 assert.equal((await handleBand(request('audio/'+sid+'/'+stem.id+'?session='+code),db)).status,403);
 const cross=new Request('https://bandroom.test/api/band/songs',{method:'POST',headers:{'oai-authenticated-user-id':'owner',Origin:'https://evil.test'},body:JSON.stringify(base)});assert.equal((await handleBand(cross,db)).status,403);
});
test('section timing and chord transposition',()=>{
 const song={...base,beatOffset:1,sections:[{bars:4},{bars:8}]};assert.equal(sectionAt(song,0).index,0);assert.equal(sectionAt(song,8.99).index,0);assert.equal(sectionAt(song,9).index,1);assert.equal(sectionStart(song,1),9);assert.equal(transpose('[G]Hello [D/F#]there [Am7]',2),'[A]Hello [E/G#]there [Bm7]');
});
class FakeContext {
 currentTime=10;sampleRate=100;state='running';outputLatency=.1;destination={};sources=[];oscillators=[];
 resume(){return Promise.resolve();}
 createGain(){return {channelCount:0,channelCountMode:'',gain:{value:0,setValueAtTime(){},exponentialRampToValueAtTime(){},setTargetAtTime(value){this.target=value;}},connect(){}};}
 createChannelMerger(){return {connect(){}};}
 createBufferSource(){const s={buffer:null,connect(){},start(...args){this.args=args;},stop(){this.stopped=true;}};this.sources.push(s);return s;}
 createOscillator(){const o={frequency:{value:0},connect(){},start(t){this.when=t;},stop(){}};this.oscillators.push(o);return o;}
}
test('audio schedules stems on one clock, compensates latency, resumes late, and cancels sources',()=>{
 const a=new BandAudio(),ctx=new FakeContext();a.context=ctx;a.now=()=>1000;a.stems=true;a.buffers.set('drums',{duration:32});
 const song={...base,beatOffset:0,stems:[{id:'drums',enabled:true,volume:.7}]};
 a.start(song,{status:'playing',run:'one',startAt:2000,offset:0,countIn:0});assert.equal(ctx.sources[0].args[0],10.9);assert.equal(ctx.sources[0].args[1],0);assert.equal(ctx.sources[0].args[2],32);
 a.stop();assert.equal(ctx.sources[0].stopped,true);assert.equal(a.timer,null);
 a.now=()=>5000;a.start(song,{status:'playing',run:'two',startAt:2000,offset:0,countIn:0});assert.ok(Math.abs(ctx.sources[1].args[1]-3.13)<.001);a.stop();
});
test('audience joins have no transport control, can load stems, and must be ready before start',async()=>{
 const db=new Bucket();const song=(await call(db,'songs','POST',base)).body;
 const created=(await call(db,'sessions','POST',{songIds:[song.id]})).body;const code=created.session.code,leader=created.token;
 const joined=await call(db,'sessions/'+code+'/join','POST',{name:'PA laptop',role:'audience'},null,'guest');assert.equal(joined.status,200);const audience=joined.body.token;
 assert.equal(joined.body.session.members[0].role,'audience');assert.equal(joined.body.session.members[0].instrument,'Audience output');
 assert.equal((await call(db,'sessions/'+code+'/action','POST',{action:'play'},audience,'guest')).status,403);
 const wait=await call(db,'sessions/'+code+'/action','POST',{action:'play'},leader);assert.equal(wait.status,400);assert.match(wait.body.error,/audience device.*loading/i);
 await call(db,'sessions/'+code+'/ready','POST',{ready:true,songId:song.id},audience,'guest');
 assert.equal((await call(db,'sessions/'+code+'/action','POST',{action:'play'},leader)).status,200);
 const left=await call(db,'sessions/'+code+'/leave','POST',{},audience,'guest');assert.equal(left.status,200);assert.equal(left.body.session.members.length,0);
 assert.equal((await call(db,'sessions/'+code,'GET',null,audience,'guest')).status,403);
});
test('leader can hear click and stems while audience engine blocks click and band-only stems',()=>{
 const song={...base,beatOffset:0,stems:[{id:'drums',enabled:true,volume:.7},{id:'guide',enabled:true,volume:.4,bandOnly:true}]};
 const t={status:'playing',run:'shared',startAt:1150,offset:0,countIn:0};
 const leader=new BandAudio();leader.context=new FakeContext();leader.now=()=>1000;leader.click=true;leader.stems=true;
 for(const id of ['drums','guide'])leader.buffers.set(id,{duration:32});leader.start(song,t);
 assert.equal(leader.context.sources.length,2);assert.ok(leader.context.oscillators.length>0);leader.stop();
 const pa=new BandAudio();pa.context=new FakeContext();pa.now=()=>1000;pa.click=true;pa.audience=true;pa.stems=true;pa.split=true;
 for(const id of ['drums','guide'])pa.buffers.set(id,{duration:32});pa.start(song,t);
 assert.equal(pa.context.sources.length,1);assert.equal(pa.context.oscillators.length,0);assert.equal(pa.gains.has('guide'),false);
 let connected=false;pa.output({connect(){connected=true;}},true);assert.equal(connected,false);pa.stop();
});
test('imported click and spoken cue files are denied at the audience API boundary; mixes survive reload',async()=>{
 const db=new Bucket();let s=(await call(db,'songs','POST',base)).body;
 for(const name of ['drums','click','spoken cues']){const r=await handleBand(new Request('https://bandroom.test/api/band/stems?'+new URLSearchParams({song:s.id,name,filename:name+'.wav',duration:'32',sampleRate:'44100'}),{method:'POST',headers:{'oai-authenticated-user-id':'owner','Content-Length':'16'},body:new TextEncoder().encode('RIFF0000WAVEdata')}),db);s=await r.json();assert.equal(r.status,201)}
 const session=(await call(db,'sessions','POST',{songIds:[s.id]})).body;const joined=(await call(db,'sessions/'+session.session.code+'/join','POST',{role:'audience'},null,'guest')).body;
 for(const st of s.stems){const r=await handleBand(request('audio/'+s.id+'/'+st.id+'?session='+session.session.code,'GET',null,joined.token,'guest'),db);assert.equal(r.status,st.category==='drums'?200:403)}
 const stems=s.stems.map((st,i)=>({...st,enabled:i===0,volume:.3,pan:-.2,solo:i===0}));assert.equal((await call(db,'sessions/'+session.session.code+'/action','POST',{action:'mix',stems},session.token)).status,200);
 const reloaded=(await call(db,'songs/'+s.id)).body;assert.equal(reloaded.stems[0].volume,.3);assert.equal(reloaded.stems[0].pan,-.2);assert.equal(reloaded.stems[1].enabled,false);
});
test('asynchronous jobs authorize, deduplicate, retry with CAS, retain originals, review results, and persist',async()=>{
 const db=new Bucket(),env={BACKGROUND_SECRET:'test-worker-secret'};const s=(await call(db,'songs','POST',base)).body;
 const send=async(path,method='GET',body,worker=false,lease)=>{const headers=worker?{authorization:'Bearer test-worker-secret',...(lease?{'x-job-lease':lease}:{})}:{'oai-authenticated-user-id':'owner'};if(body instanceof Uint8Array){headers['Content-Length']=String(body.length);headers['x-upload-id']='upload-one'}else if(body)headers['Content-Type']='application/json';return handleBand(new Request('https://bandroom.test/api/band/'+path,{method,headers,body:body instanceof Uint8Array?body:body?JSON.stringify(body):undefined}),db,env)};
 const bytes=new TextEncoder().encode('RIFF0000WAVEdata'),path='separation?song='+s.id+'&filename=original.wav&duration=32&sampleRate=44100';
 let r=await send(path,'POST',bytes);assert.equal(r.status,201);const job=await r.json();assert.equal(job.status,'queued');r=await send(path,'POST',bytes);assert.equal(r.status,200);assert.equal((await r.json()).id,job.id);
 assert.equal((await handleBand(request('separation/'+job.id+'/original','GET',null,null,'other-band'),db,env)).status,404);
 assert.equal((await handleBand(request('processing/queue'),db,env)).status,403);
 const claim=await (await send('processing/queue','GET',null,true)).json();assert.equal(claim.job.status,'processing');assert.equal((await (await send('processing/queue','GET',null,true)).json()).job,null);
 assert.equal((await send('processing/'+job.id+'/finish','POST',{error:'Decoder failed'},true,'wrong')).status,409);
 await send('processing/'+job.id+'/finish','POST',{error:'Decoder failed'},true,claim.job.lease);
 const retries=await Promise.all([send('separation/'+job.id+'/retry','POST',{}),send('separation/'+job.id+'/retry','POST',{})]);assert.equal(retries.filter(r=>r.status===200).length,1);
 const again=await (await send('processing/queue','GET',null,true)).json();assert.equal(again.job.attempt,2);
 for(const category of ['vocals','drums','bass','other']){r=await send('processing/'+job.id+'/result?category='+category+'&duration=32&sampleRate=44100','PUT',bytes,true,again.job.lease);assert.equal(r.status,200)}
 assert.equal((await send('processing/'+job.id+'/finish','POST',{},true,again.job.lease)).status,200);
 const list=await (await send('separation?song='+s.id)).json();assert.equal(list.jobs[0].status,'completed');assert.equal(list.jobs[0].lease,undefined);
 const saved=await (await send('separation/'+job.id+'/save','POST',{stems:list.jobs[0].stems.map(st=>({...st,volume:.4,name:'My '+st.name}))})).json();assert.equal(saved.stems.length,4);assert.equal(saved.stems[0].volume,.4);
 const againSave=await (await send('separation/'+job.id+'/save','POST',{stems:saved.stems})).json();assert.equal(againSave.stems.length,4);
 const original=await send('separation/'+job.id+'/original');assert.deepEqual(new Uint8Array(await original.arrayBuffer()),bytes);
});
test('positive and negative stem offsets preserve one timeline when seeking',()=>{
 const e=new BandAudio();e.context=new FakeContext();e.stems=true;e.now=()=>1000;for(const id of ['a','b','c'])e.buffers.set(id,{duration:32});const s={...base,stems:[{id:'a',enabled:true,volume:1,offset:0},{id:'b',enabled:true,volume:1,offset:2},{id:'c',enabled:true,volume:1,offset:-1}]};
 e.start(s,{status:'playing',run:'seek',startAt:2000,offset:5,countIn:0});assert.deepEqual(e.context.sources.map(x=>x.args[1]),[5,3,6]);assert.ok(e.context.sources.every(x=>x.args[0]===10.9));e.stop();
});
test('streamed ZIP can be read by Python standard zipfile without buffering source files on the server',async()=>{
 const {streamZip}=await import('../lib/zip-stream.ts');const {spawnSync}=await import('node:child_process');const data=new TextEncoder().encode('aligned audio');const body=new ReadableStream({start(c){c.enqueue(data);c.close()}});const zip=new Uint8Array(await new Response(streamZip([{name:'drums.wav',size:data.length,body}])).arrayBuffer());const r=spawnSync('python',['-c','import sys,io,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.read("drums.wav")==b"aligned audio"; assert z.testzip() is None'],{input:zip});assert.equal(r.status,0,r.stderr.toString());
});
test('GarageBand-style WAV imports retain identical leading silence and raw timing through storage',async()=>{
 const rate=8000,frames=8000,wav=new Uint8Array(44+frames*2),view=new DataView(wav.buffer),enc=new TextEncoder();wav.set(enc.encode('RIFF'),0);view.setUint32(4,wav.length-8,true);wav.set(enc.encode('WAVEfmt '),8);view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);wav.set(enc.encode('data'),36);view.setUint32(40,frames*2,true);for(let n=4000;n<frames;n++)view.setInt16(44+n*2,Math.sin(n*.1)*12000,true);
 const db=new Bucket(),s=(await call(db,'songs','POST',base)).body;let updated;
 for(const filename of ['bass.wav','guitar.wav']){const r=await handleBand(new Request('https://bandroom.test/api/band/stems?'+new URLSearchParams({song:s.id,name:filename,filename,duration:'1',sampleRate:String(rate)}),{method:'POST',headers:{'oai-authenticated-user-id':'owner','Content-Length':String(wav.length)},body:wav}),db);assert.equal(r.status,201);updated=await r.json();}
 for(const st of updated.stems){assert.equal(st.offset,0);assert.equal(st.sampleRate,rate);const r=await handleBand(request('audio/'+s.id+'/'+st.id),db);assert.deepEqual(new Uint8Array(await r.arrayBuffer()),wav);}
 const e=new BandAudio();e.context=new FakeContext();e.stems=true;e.now=()=>1000;for(const st of updated.stems)e.buffers.set(st.id,{duration:1});e.start(updated,{status:'playing',run:'garageband',startAt:2000,offset:0,countIn:0});assert.equal(e.context.sources[0].args[0],e.context.sources[1].args[0]);assert.equal(e.context.sources[0].args[1],0);e.stop();
});

test('nonuniform detected beats drive click and section changes after a seek; manual timing can override',async()=>{
 const {beatAt,clickReady}=await import('../lib/analysis.ts');
 const song={...base,stems:[],beatOffset:.2,sections:[{bars:1},{bars:2}],analysis:{beats:[.2,.7,1.2,1.7,2.4,3.1,3.8,4.5,5.2]}};
 assert.equal(sectionAt(song,2.39).index,0);assert.equal(sectionAt(song,2.4).index,1);assert.equal(sectionStart(song,1),2.4);assert.equal(beatAt(song,2.75).index,4);assert.ok(Math.abs(beatAt(song,2.75).fraction-.5)<1e-8);
 const engine=new BandAudio();engine.context=new FakeContext();engine.now=()=>1000;engine.click=true;
 engine.start(song,{status:'playing',run:'beat-seek',startAt:1150,offset:2.4,countIn:0});assert.equal(engine.context.oscillators.length,1);assert.equal(engine.nextBeat,5);assert.ok(Math.abs(engine.context.oscillators[0].when-10.05)<1e-8);engine.stop();
 const manual={...song,info:{useManualTiming:true,playbackConfirmed:true}};assert.equal(sectionStart(manual,1),2.2);assert.equal(clickReady(manual),true);assert.equal(clickReady({...base}),false);assert.equal(clickReady({...base,analysis:{beats:[]}}),false);
});
test('analysis validates untrusted payloads and preserves authored charts',async()=>{
 const {safeAnalysis,applyAnalysis}=await import('../lib/analysis.ts');const data={bpm:120,beats:[.1,.6,1.1],lyrics:[null,{start:0,end:2,text:'A sung line'}],chords:[{time:0,chord:'C',confidence:2}],warnings:'bad shape',methods:null};const a=safeAnalysis(data,32);assert.equal(a.warnings.length,0);assert.equal(a.lyrics.length,1);assert.equal(a.chords[0].confidence,1);assert.equal(safeAnalysis({...data,beats:[1,1,2]},32),undefined);assert.equal(safeAnalysis({...data,beats:[1,2,33]},32),undefined);assert.equal(safeAnalysis({...data,bpm:0,beats:[]},32).beats.length,0);assert.deepEqual(applyAnalysis({...base,beatOffset:0},a).sections,base.sections);const result=applyAnalysis({...base,sections:[],beatOffset:0},a);assert.match(result.sections[0].lyrics,/sung/);assert.match(result.sections[0].chords,/\[C\]/);
});
test('process uploaded recording is idempotent, isolated, auto saves analysis and four stems without doubling original',async()=>{
 const db=new Bucket(),env={BACKGROUND_SECRET:'pipeline-secret'};let s=(await call(db,'songs','POST',{...base,sections:[]})).body;
 const bytes=new TextEncoder().encode('RIFF0000WAVEdata');const upload=await handleBand(new Request('https://bandroom.test/api/band/stems?'+new URLSearchParams({song:s.id,name:'Full recording',filename:'mix.wav',duration:'32',sampleRate:'44100'}),{method:'POST',headers:{'oai-authenticated-user-id':'owner','Content-Length':'16'},body:bytes}),db);s=await upload.json();
 const send=async(path,method='GET',body,worker=false,lease)=>{const headers=worker?{authorization:'Bearer pipeline-secret',...(lease?{'x-job-lease':lease}:{})}:{'oai-authenticated-user-id':'owner'};if(body instanceof Uint8Array)headers['Content-Length']=String(body.length);return handleBand(new Request('https://bandroom.test/api/band/'+path,{method,headers,body:body instanceof Uint8Array?body:body?JSON.stringify(body):undefined}),db,env)};
 const queued=await Promise.all([send('separation/from-song/'+s.id,'POST',{}),send('separation/from-song/'+s.id,'POST',{})]);const jobs=await Promise.all(queued.map(r=>r.json()));assert.equal(jobs[0].id,jobs[1].id);assert.equal((await handleBand(request('separation/from-song/'+s.id,'POST',{},null,'stranger'),db,env)).status,404);
 const claim=await (await send('processing/queue','GET',null,true)).json();for(const category of ['vocals','drums','bass','other'])assert.equal((await send('processing/'+claim.job.id+'/result?category='+category+'&duration=32&sampleRate=44100','PUT',bytes,true,claim.job.lease)).status,200);
 assert.equal((await send('processing/'+claim.job.id+'/finish','POST',{analysis:{bpm:100,beats:[0,.6,1.2],key:'G',lyrics:[{start:0,end:2,text:'Actual transcript'}],chords:[{time:0,chord:'G'}],warnings:[]}},true,claim.job.lease)).status,200);
 const saved=(await call(db,'songs/'+s.id)).body;assert.equal(saved.bpm,100);assert.equal(saved.stems.length,5);assert.equal(saved.stems[0].enabled,false);assert.equal(saved.stems.filter(st=>st.source==='ai'&&st.enabled).length,4);assert.match(saved.sections[0].lyrics,/Actual transcript/);assert.equal(saved.analysis.beats[1],.6);
});

test('deleting a song removes its audio, jobs, recognition and saved set entry while retaining other songs',async()=>{
 const db=new Bucket(),env={BACKGROUND_SECRET:'test-secret'};let doomed=(await call(db,'songs','POST',base)).body;const keep=(await call(db,'songs','POST',{...base,title:'Keep this song'})).body;
 await call(db,'setlist','PUT',{ids:[doomed.id,keep.id]});const bytes=new TextEncoder().encode('RIFF0000WAVEdata');const upload=await handleBand(new Request('https://bandroom.test/api/band/stems?'+new URLSearchParams({song:doomed.id,name:'Full recording',filename:'mix.wav',duration:'32'}),{method:'POST',headers:{'oai-authenticated-user-id':'owner','Content-Length':'16'},body:bytes}),db);doomed=await upload.json();
 const jobResponse=await handleBand(request('separation/from-song/'+doomed.id,'POST',{}),db,env);assert.equal(jobResponse.status,201);const job=await jobResponse.json();await db.put('library/owner/recognition/'+doomed.id+'.json',JSON.stringify({status:'matched'}));
 assert.equal((await call(db,'songs/'+doomed.id,'DELETE',null,null,'stranger')).status,404);assert.equal((await call(db,'songs/'+doomed.id)).status,200);
 assert.equal((await call(db,'songs/'+doomed.id,'DELETE')).status,200);assert.equal((await call(db,'songs/'+doomed.id)).status,404);assert.equal((await call(db,'songs/'+keep.id)).status,200);assert.deepEqual((await call(db,'setlist')).body.ids,[keep.id]);assert.equal((await call(db,'songs')).body.songs.length,1);
 assert.equal(await db.get('jobs/'+job.id+'.json'),null);assert.equal(await db.get('library/owner/originals/'+job.id),null);assert.equal(await db.get('library/owner/recognition/'+doomed.id+'.json'),null);assert.equal([...db.items.keys()].filter(k=>k.includes('/audio/'+doomed.id+'/')).length,0);
});

test('Mac setup requires sign-in and one-time code; drops queue durably while Mac is offline',async()=>{
 const db=new Bucket(),env={BACKGROUND_SECRET:'server-only-test-secret',MAC_SETUP_CODE:'x'.repeat(64),SITES_WORKER_TOKEN:'private-site-test-token',AUTO_PROCESS_UPLOADS:'true'};
 assert.equal((await handleBand(request('mac-setup?code='+env.MAC_SETUP_CODE,'GET',null,null,null),db,env)).status,401);
 assert.equal((await handleBand(request('mac-setup?code=wrong'),db,env)).status,403);
 const config=await handleBand(request('mac-setup?code='+env.MAC_SETUP_CODE),db,env);assert.equal(config.status,200);assert.match(config.headers.get('Content-Disposition'),/worker-config.json/);assert.equal((await config.json()).BACKGROUND_SECRET,env.BACKGROUND_SECRET);assert.equal((await handleBand(request('mac-setup?code='+env.MAC_SETUP_CODE),db,env)).status,410);
 const song=(await call(db,'songs','POST',{...base,sections:[]})).body;const uploaded=await handleBand(new Request('https://bandroom.test/api/band/stems?'+new URLSearchParams({song:song.id,name:'Full recording',filename:'mix.wav',duration:'32',auto:'1'}),{method:'POST',headers:{'oai-authenticated-user-id':'owner','Content-Length':'16'},body:new TextEncoder().encode('RIFF0000WAVEdata')}),db,env);assert.equal(uploaded.status,201);
 const jobs=await (await handleBand(request('separation?song='+song.id),db,env)).json();assert.equal(jobs.jobs.length,1);assert.equal(jobs.jobs[0].status,'queued');assert.equal((await handleBand(request('separation/from-song/'+song.id,'POST',{}),db,env)).status,200);
});

test('cached Mac jobs renew their lease and recover expired leases without a duplicate job',async()=>{
 const db=new Bucket(),env={BACKGROUND_SECRET:'resume-secret'};const s=(await call(db,'songs','POST',base)).body;
 const workerRequest=(path,lease)=>new Request('https://bandroom.test/api/band/'+path,{method:path.endsWith('/resume')?'POST':'GET',headers:{authorization:'Bearer resume-secret',...(lease?{'x-job-lease':lease}:{})}});
 const upload=await handleBand(new Request('https://bandroom.test/api/band/separation?'+new URLSearchParams({song:s.id,filename:'mix.wav',duration:'32'}),{method:'POST',headers:{'oai-authenticated-user-id':'owner','Content-Length':'16','x-upload-id':'resume-job'},body:new TextEncoder().encode('RIFF0000WAVEdata')}),db,env);assert.equal(upload.status,201);
 const claimed=await (await handleBand(workerRequest('processing/queue'),db,env)).json();const lease=claimed.job.lease;
 assert.equal((await handleBand(workerRequest('processing/resume-job/resume','different-worker'),db,env)).status,409);
 const renewed=await (await handleBand(workerRequest('processing/resume-job/resume',lease),db,env)).json();assert.equal(renewed.job.lease,lease);
 const saved=await (await db.get('jobs/resume-job.json')).json();saved.leaseUntil=Date.now()-1;await db.put('jobs/resume-job.json',JSON.stringify(saved));
 const recovered=await (await handleBand(workerRequest('processing/resume-job/resume','new-worker'),db,env)).json();assert.notEqual(recovered.job.lease,lease);assert.equal(recovered.job.status,'processing');assert.equal([...db.items.keys()].filter(k=>k.startsWith('jobs/')).length,1);
 saved.status='completed';saved.saved=true;await db.put('jobs/resume-job.json',JSON.stringify(saved));assert.equal((await (await handleBand(workerRequest('processing/resume-job/resume'),db,env)).json()).completed,true);
});

test('worker progress is lease-scoped, sanitized, visible only to the song owner and ignores stale leases',async()=>{
 const db=new Bucket(),env={BACKGROUND_SECRET:'progress-secret'};const s=(await call(db,'songs','POST',base)).body;
 const upload=await handleBand(new Request('https://bandroom.test/api/band/separation?'+new URLSearchParams({song:s.id,filename:'mix.wav',duration:'32'}),{method:'POST',headers:{'oai-authenticated-user-id':'owner','Content-Length':'16','x-upload-id':'progress-job'},body:new TextEncoder().encode('RIFF0000WAVEdata')}),db,env);assert.equal(upload.status,201);
 const send=(path,method='GET',body,lease)=>handleBand(new Request('https://bandroom.test/api/band/'+path,{method,headers:{authorization:'Bearer progress-secret',...(lease?{'x-job-lease':lease}:{})},body:body?JSON.stringify(body):undefined}),db,env);
 const claim=await (await send('processing/queue')).json();const lease=claim.job.lease;
 assert.equal((await send('processing/progress-job/progress','POST',{stage:'separating',percent:15,etaSeconds:73,startedAt:Date.now()-13000},'wrong')).status,409);
 assert.equal((await send('processing/progress-job/progress','POST',{stage:'separating',percent:15,etaSeconds:73,startedAt:Date.now()-13000},lease)).status,200);
 const jobs=await (await handleBand(request('separation?song='+s.id),db,env)).json();assert.equal(jobs.jobs[0].progress.percent,15);assert.equal(jobs.jobs[0].progress.etaSeconds,73);assert.equal(jobs.jobs[0].lease,undefined);
 const privateJobs=await (await handleBand(request('separation?song='+s.id,'GET',null,null,'stranger'),db,env)).json();assert.equal(privateJobs.jobs.length,0);
 assert.equal((await send('processing/progress-job/progress','POST',{stage:'invented'},lease)).status,400);
 const stored=await (await db.get('jobs/progress-job.json')).json();stored.lease='replacement';await db.put('jobs/progress-job.json',JSON.stringify(stored));const stale=await (await handleBand(request('separation?song='+s.id),db,env)).json();assert.equal(stale.jobs[0].progress,undefined);
});

test('online lyrics prefer exact title artist duration, persist privately, and survive later audio analysis',async()=>{
 const {lookupLyrics}=await import('../lib/chart-api.ts');const {displaySection,recordChart,applyChart,exactLyricsMatch}=await import('../lib/song-charts.ts');const {applyAnalysis}=await import('../lib/analysis.ts');
 const s={...base,title:'Example Band - Sample / Lyrics',artist:'uploader',duration:32,sections:[]};const record={id:123,trackName:'Sample',artistName:'Example Band',duration:32,plainLyrics:'One original fixture line',syncedLyrics:'[00:01.00] One original fixture line'};
 assert.equal(exactLyricsMatch(s,record),true);assert.equal(exactLyricsMatch(s,{...record,artistName:'Other Band'}),false);assert.equal(exactLyricsMatch(s,{...record,duration:40}),false);
 const found=await lookupLyrics(s,async()=>new Response(JSON.stringify([record])));assert.equal(found.status,'matched');assert.equal(found.chart.timedLyrics[0].start,1);
 const analyzed=applyAnalysis(applyChart(s,found.chart),{version:1,bpm:120,key:'G',beats:[0,.5,1],lyrics:[{start:0,end:2,text:'wrong estimate'}],chords:[{time:1,chord:'G'}],methods:{},warnings:[]});const section=displaySection(analyzed,analyzed.sections[0]);assert.equal(section.lyrics,record.plainLyrics);assert.match(section.chords,/\[G\]One/);assert.doesNotMatch(section.chords,/@/);
 const db=new Bucket();const stored=(await call(db,'songs','POST',analyzed)).body;assert.equal((await call(db,'songs/'+stored.id)).body.chart.source,'lrclib');assert.equal((await call(db,'charts/'+stored.id,'POST',{},null,'other')).status,404);
 const originalFetch=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify([record]));try{const result=await call(db,'charts/'+stored.id,'POST',{});assert.equal(result.status,200);assert.equal(result.body.song.chart.plainLyrics,record.plainLyrics);}finally{globalThis.fetch=originalFetch}
});

test('unmatched online lyrics retain estimates and imported ChordPro preserves word placement',async()=>{
 const {lookupLyrics}=await import('../lib/chart-api.ts');const {applyChart,safeChart,displaySection}=await import('../lib/song-charts.ts');
 const s={...base,artist:'Fixture Artist',sections:[]};const found=await lookupLyrics(s,async()=>new Response('[]'));assert.equal(found.status,'not_found');assert.equal(found.chart,undefined);
 const chart=safeChart({source:'import',title:s.title,artist:s.artist,plainLyrics:'Our fixture words',chordpro:'[G]Our fixture [C]words',timedLyrics:[]},32);const song=applyChart(s,chart);assert.equal(displaySection(song,song.sections[0]).chords,'[G]Our fixture [C]words');
 assert.equal(safeChart({source:'untrusted'},32),undefined);
 const db=new Bucket();const added=(await call(db,'songs','POST',{...base,countIn:undefined})).body;assert.equal(added.countIn,1);const imported=await call(db,'charts/'+added.id,'POST',{chordpro:'[G]Our fixture [C]words'});assert.equal(imported.status,200);assert.equal(imported.body.song.chart.source,'import');assert.equal(imported.body.song.sections[0].name,'Imported chart');
});

test('manual chart edits survive analysis and active sessions receive current library charts',async()=>{
 const {applyAnalysis}=await import('../lib/analysis.ts');const {displaySection}=await import('../lib/song-charts.ts');const db=new Bucket();
 const saved=(await call(db,'songs','POST',{...base,sections:[{...base.sections[0],name:'Analyzed song'}]})).body;
 const created=(await call(db,'sessions','POST',{songIds:[saved.id]})).body,code=created.session.code,host=created.token;const transport=(await call(db,'sessions/'+code+'/action','POST',{action:'play',offset:8},host)).body.session.transport;
 const edit={...saved,sections:[{...saved.sections[0],lyrics:'Correct fixture words',chords:'[Am]Correct fixture [E7]words',tabs:{Guitar:'e|--0--|'},tabCues:[{id:'riff',at:8,instrument:'Guitar',text:'e|--1--|'}]}]};
 const updated=(await call(db,'songs/'+saved.id,'PUT',edit)).body;assert.equal(updated.sections[0].manual,true);assert.equal(displaySection(updated,updated.sections[0]).lyrics,'Correct fixture words');
 const analyzed=applyAnalysis(updated,{version:1,bpm:120,key:'G',beats:[0,.5,1],lyrics:[{start:0,end:2,text:'Wrong estimate'}],chords:[],methods:{},warnings:[]});assert.equal(analyzed.sections[0].lyrics,'Correct fixture words');
 const refreshed=(await call(db,'sessions/'+code,'GET',null,host)).body;assert.equal(refreshed.songs[0].sections[0].lyrics,'Correct fixture words');assert.equal(refreshed.songs[0].sections[0].tabCues[0].at,8);assert.deepEqual(refreshed.transport,transport);
 assert.equal((await call(db,'sessions/'+code)).status,403);
});
test('plain chords above lyrics convert into sections and timed tabs follow seeks',async()=>{
 const {normalizeChordChart,importedSections}=await import('../lib/song-charts.ts');const {activeTabCue,countInSeconds}=await import('../lib/timeline.ts');
 const normalized=normalizeChordChart('[Verse 1]\nAm      E7\nFixture words here\n[Chorus 2]\n[C]Another fixture');assert.match(normalized,/\[Am\]/);assert.match(normalized,/\[E7\]/);assert.match(normalized,/\{section: Chorus 2\}/);const parts=importedSections(normalized);assert.equal(parts.length,2);assert.equal(parts[1].name,'Chorus 2');assert.equal(parts[0].manual,true);
 const song={...base,sections:[{...base.sections[0],start:0},{...base.sections[0],id:'second',name:'Chorus 2',start:20,tabCues:[{id:'a',at:20,instrument:'Guitar',text:'first riff'},{id:'b',at:24,instrument:'Guitar',text:'second riff'}]}]};assert.equal(sectionStart(song,1),20);assert.equal(sectionAt(song,23).index,1);assert.equal(activeTabCue(song.sections[1],'Guitar',25).text,'second riff');assert.equal(activeTabCue(song.sections[1],'Guitar',21).text,'first riff');assert.equal(activeTabCue(song.sections[1],'Bass',25),undefined);assert.equal(countInSeconds(song,20),2);
});
test('live backing changes preserve transport and scheduled source alignment',async()=>{
 const db=new Bucket();const song=(await call(db,'songs','POST',base)).body;const upload=await handleBand(new Request('https://bandroom.test/api/band/stems?'+new URLSearchParams({song:song.id,name:'Bass',filename:'bass.wav',duration:'32'}),{method:'POST',headers:{'oai-authenticated-user-id':'owner','Content-Length':'16'},body:new TextEncoder().encode('RIFF0000WAVEdata')}),db);const withStem=await upload.json();const created=(await call(db,'sessions','POST',{songIds:[song.id]})).body;const path='sessions/'+created.session.code+'/action',host=created.token;const played=(await call(db,path,'POST',{action:'play',offset:8},host)).body.session.transport;
 const mixed=await call(db,path,'POST',{action:'mix',stems:withStem.stems.map(s=>({...s,enabled:false}))},host);assert.equal(mixed.status,200);assert.deepEqual(mixed.body.session.transport,played);assert.equal((await call(db,'songs/'+song.id)).body.stems[0].enabled,false);
 const audio=new BandAudio();audio.context=new FakeContext();audio.now=()=>1000;audio.stems=true;audio.buffers.set(withStem.stems[0].id,{duration:32});audio.start(withStem,{status:'playing',run:'same',startAt:2000,offset:8,countIn:0});const source=audio.sources[0];audio.mix({...withStem,stems:withStem.stems.map(s=>({...s,enabled:false}))});assert.equal(audio.gains.get(withStem.stems[0].id).gain.target,0);audio.mix(withStem);assert.equal(audio.sources[0],source);assert.equal(audio.sources.length,1);assert.equal(audio.run,'same');audio.stop();
});
test('count-in emits four lead-in beats at a resumed position with detected timing',()=>{
 const a=new BandAudio(),ctx=new FakeContext();a.context=ctx;a.click=true;let now=1000;a.now=()=>now;const song={...base,analysis:{bpm:120,beats:Array.from({length:64},(_,i)=>i*.5)},stems:[]};const originalInterval=globalThis.setInterval;let tick;globalThis.setInterval=fn=>{tick=fn;return 1};try{a.start(song,{status:'playing',run:'resume',startAt:3200,offset:8,countIn:2});for(now=1025;now<=2875;now+=25)tick();assert.equal(ctx.oscillators.length,4);assert.equal(a.transport.offset,8);}finally{a.stop();globalThis.setInterval=originalInterval}
});

test('lyrics view removes raw chord rows and inline chords while retaining lyric text',async()=>{
 const {lyricsOnly,importedSections,normalizeChordChart}=await import('../lib/song-charts.ts');
 assert.equal(lyricsOnly('Am E Dm Am\n\n[Verse 1]\nAm       E7\nOur original fixture words\n Dm   Am\nAnd another fixture line'),'Verse 1\n\nOur original fixture words\n\nAnd another fixture line');
 assert.equal(lyricsOnly('[Am]Our original [E7]fixture words'),'Our original fixture words');
 assert.equal(lyricsOnly('A\nA line with ordinary words'),'A\nA line with ordinary words');
 assert.equal(lyricsOnly('F#m7 Bsus4 Cmaj7 D/F#\nFixture chorus'),'Fixture chorus');
 const sections=importedSections(normalizeChordChart('[Verse 1]\nAm      E7\nOriginal fixture words'));assert.doesNotMatch(sections[0].lyrics,/Am|E7|\[/);assert.match(sections[0].chords,/\[Am\]/);
});

test('Follow highlights matched edited lyric lines and manual marks survive reload and seeks',async()=>{
 const {followRows,activeFollowRow}=await import('../lib/chart-follow.ts');const s={...base,sections:[{...base.sections[0],manual:true,lyrics:'Original fixture line\nSecond fixture line',chords:'[G]Original fixture line\n[C]Second fixture line'}],chart:{source:'import',plainLyrics:'Original fixture line\nSecond fixture line',timedLyrics:[{start:5,end:10,text:'Original fixture line'},{start:10,end:15,text:'Second fixture line'}],title:'Fixture',artist:'Fixture Artist',sourceUrl:'',updated:1}};
 const rows=followRows(s,0);assert.equal(rows[0].at,5);assert.equal(activeFollowRow(rows,4),-1);assert.equal(activeFollowRow(rows,7),0);assert.equal(activeFollowRow(rows,12),1);assert.equal(activeFollowRow(rows,7),0);assert.equal(activeFollowRow(rows,16),-1);
 const marked={...s,sections:[{...s.sections[0],lineCues:[{line:1,at:13}]}]};const db=new Bucket();const stored=(await call(db,'songs','POST',marked)).body;const loaded=(await call(db,'songs/'+stored.id)).body;assert.equal(loaded.sections[0].lineCues[0].at,13);assert.equal(followRows(loaded,0)[1].at,13);assert.equal(followRows(loaded,0)[1].text,'[C]Second fixture line');
 const unknown={...s,chart:{...s.chart,timedLyrics:[]},analysis:undefined};assert.equal(followRows(unknown,0).every(r=>r.at===undefined),true);
});

test('existing imported headings become durable distinct sections without losing chart or tab data',async()=>{
 const {expandImportedSections}=await import('../lib/song-charts.ts');const db=new Bucket();const original={...base,title:'Fixture song',chart:{source:'import',title:'Fixture song',artist:'Fixture artist',plainLyrics:'Original fixture line',chordpro:'[Intro]\nAm E Dm Am\n[Verse 1]\n[G]Original fixture line\n[Chorus 2]\n[C]Another fixture line',timedLyrics:[],sourceUrl:'',updated:1},sections:[{...base.sections[0],name:'Imported chart',bars:89,chords:'[Intro]\nAm E Dm Am\n[Verse 1]\n[G]Original fixture line\n[Chorus 2]\n[C]Another fixture line',tabCues:[{id:'riff',at:3,instrument:'Guitar',text:'fixture tab'}],lineCues:[{line:3,at:12}]}]};const expanded=expandImportedSections(original);assert.deepEqual(expanded.sections.map(s=>s.name),['Intro','Verse 1','Chorus 2']);assert.equal(expanded.sections[0].start,0);assert.equal(expanded.sections[1].lineCues[0].at,12);assert.equal(expanded.sections[1].lineCues[0].line,0);assert.equal(expanded.sections[1].tabCues[0].text,'fixture tab');assert.equal(expanded.chart.chordpro,original.chart.chordpro);assert.equal(expandImportedSections(expanded),expanded);
 const stored=(await call(db,'songs','POST',original)).body;const loaded=(await call(db,'songs/'+stored.id)).body;assert.equal(loaded.sections.length,3);const again=(await call(db,'songs/'+stored.id)).body;assert.deepEqual(again.sections.map(s=>s.id),loaded.sections.map(s=>s.id));assert.equal((await call(db,'songs/'+stored.id,'GET',null,null,'other')).status,404);
});

test('full song score keeps later lyrics visible and assigns automatic clickable times',async()=>{
 const {automaticScore}=await import('../lib/chart-follow.ts');const song={...base,duration:40,sections:[{...base.sections[0],id:'intro',name:'Intro',start:0,lyrics:'',chords:'[Am] [E7]',tabs:{Guitar:'e|--0--|\n\ne|--2--|'}},{...base.sections[0],id:'verse',name:'Verse',start:10,lyrics:'Original lyric line\nAdded correct lyric line',chords:'[G]Original lyric line\n[C]Added correct lyric line',tabs:{}},{...base.sections[0],id:'chorus',name:'Chorus',start:25,lyrics:'Later chorus fixture',chords:'[C]Later chorus fixture',tabs:{}}],chart:{source:'import',plainLyrics:'',sourceUrl:'',title:'Fixture',artist:'Fixture',updated:1,timedLyrics:[{start:10,end:15,text:'Original lyric line'},{start:25,end:30,text:'Later chorus fixture'}]}};
 const rows=automaticScore(song,'lyrics','Guitar');assert.ok(rows.some(r=>r.text==='Later chorus fixture'));assert.ok(rows.some(r=>r.text==='Added correct lyric line'));assert.equal(rows.find(r=>r.text==='Original lyric line').at,10);const missing=rows.find(r=>r.text==='Added correct lyric line');assert.ok(missing.at>=10&&missing.at<25);assert.equal(missing.estimated,true);assert.ok(rows.every(r=>Number.isFinite(r.at)));
 const tabs=automaticScore(song,'tabs','Guitar').filter(r=>r.tab);assert.equal(tabs.length,2);assert.equal(tabs[0].at,0);assert.ok(tabs[1].at>0&&tabs[1].at<10);
 const separate={...song,sections:[{...song.sections[1],lyrics:'My separately edited fixture lyric',chords:'[G]Older chart text'}]};assert.equal(automaticScore(separate,'lyrics','Guitar').find(r=>!r.heading).text,'My separately edited fixture lyric');
});

test('decoded audio is shared and concurrent loads deduplicate; failed loads retry and eviction is bounded',async()=>{
 const {DecodedAudioCache,audioCacheKey}=await import('../lib/audio-cache.ts');const cache=new DecodedAudioCache();let calls=0,release;const buffer={length:10,numberOfChannels:2};const loader=()=>{calls++;return new Promise(resolve=>{release=()=>resolve(buffer)})};const one=cache.load('one',loader,100),two=cache.load('one',loader,100);release();assert.equal(await one,buffer);assert.equal(await two,buffer);assert.equal(calls,1);assert.equal(await cache.load('one',loader,100),buffer);assert.equal(calls,1);
 await assert.rejects(()=>cache.load('bad',async()=>{throw Error('offline')},100));assert.equal(cache.pending.size,0);assert.equal(await cache.load('bad',async()=>buffer,100),buffer);assert.equal(cache.bytes,80);assert.equal(cache.entries.size,1);
 const stem={id:'stem',bytes:16,sampleRate:44100,duration:32,name:'Bass',enabled:true,volume:.7};assert.equal(audioCacheKey('song',stem),audioCacheKey('song',{...stem,name:'Renamed',enabled:false,volume:.1,pan:1,category:'bass'}));assert.notEqual(audioCacheKey('song',stem),audioCacheKey('song',{...stem,audioVersion:'replaced'}));
});
test('mix changes and cue monitoring retain decoded buffers and scheduled sources',async()=>{
 const {decodedAudioCache}=await import('../lib/audio-cache.ts');decodedAudioCache.entries.clear();decodedAudioCache.bytes=0;const a=new BandAudio(),other=new BandAudio();a.context=new FakeContext();other.context=new FakeContext();const stem={id:'cache-fixture',name:'Bass',bytes:16,duration:32,sampleRate:44100,enabled:true,volume:.7};let fetches=0,decodes=0;const buffer={length:10,numberOfChannels:1,duration:32};a.decode=async()=>{decodes++;return buffer};other.decode=async()=>{throw Error('should reuse buffer')};const loader=async()=>{fetches++;return new ArrayBuffer(16)};
 await a.loadStem('song',stem,loader);await a.loadStem('song',{...stem,volume:.2},loader);await other.loadStem('song',stem,loader);assert.equal(fetches,1);assert.equal(decodes,1);assert.equal(other.buffers.get(stem.id),buffer);
 a.stems=true;a.now=()=>1000;const song={...base,stems:[{...stem,category:'spoken cues'}]};a.cues=false;a.start(song,{status:'playing',run:'unchanged',startAt:2000,offset:0,countIn:0});const source=a.sources[0];assert.equal(a.gains.get(stem.id).gain.value,0);a.cues=true;a.mix(song);assert.equal(a.gains.get(stem.id).gain.target,.7);assert.equal(a.sources[0],source);a.stop();
 const cancelled=new BandAudio();cancelled.decode=async()=>buffer;await cancelled.loadStem('other',stem,loader,()=>false);assert.equal(cancelled.buffers.size,0);
});
