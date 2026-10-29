import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {safeLoop,requiredStems,transportPosition,safePresets,capturePreset,applyPreset,pageRequest} from '../lib/rehearsal.ts';
import {mergeSession} from '../lib/session-state.ts';
import {BandAudio} from '../lib/audio.ts';
import {safeDiagnostic} from '../lib/diagnostics.ts';
const song={id:'song',title:'A song',duration:32,bpm:120,beats:4,beatOffset:0,countIn:1,stems:[{id:'drums',name:'Drums',category:'drums',enabled:true,volume:.7,pan:0,bytes:100,duration:32}],sections:[]};
test('loops reject invalid ranges and rate-adjusted transport wraps consistently at boundaries',()=>{
 for(const loop of [{start:-1,end:3},{start:3,end:3},{start:0,end:33},{start:0,end:Infinity},{start:NaN,end:3}])assert.equal(safeLoop(loop,32),undefined);
 const t={status:'playing',offset:16,startAt:1000,rate:.5,loop:{start:16,end:24}};
 assert.equal(transportPosition(t,900,32),16);assert.equal(transportPosition(t,9000,32),20);assert.equal(transportPosition(t,17000,32),16);assert.equal(transportPosition(t,21000,32),18);
 assert.equal(transportPosition({...t,loop:undefined},100000,32),32);
});
test('presets restore only mixer properties and ignore foreign or forged audio identity',()=>{
 const p=capturePreset(song,'No drummer');p.stems[0].enabled=false;p.stems[0].bytes=999;p.stems.push({id:'foreign',enabled:true});
 const safe=safePresets([p],song.stems)[0],applied=applyPreset(song,safe);assert.equal(applied.stems[0].enabled,false);assert.equal(applied.stems[0].bytes,100);assert.equal(applied.stems.length,1);
 assert.equal(safePresets([{...p,name:'   '}],song.stems).length,0);
});
test('compact session updates reuse unchanged charts, replace changed songs and prune removed songs',()=>{
 const before={code:'BAND',revision:1,songs:[song,{...song,id:'other'}]};
 const unchanged=mergeSession(before,{code:'BAND',revision:2,partial:true,songIds:['song'],songs:[]});assert.equal(unchanged.songs.length,1);assert.equal(unchanged.songs[0],song);
 const changed=mergeSession(unchanged,{code:'BAND',revision:3,partial:true,songIds:['song'],songs:[{...song,title:'Edited'}]});assert.equal(changed.songs[0].title,'Edited');assert.equal(mergeSession(changed,{...before,revision:1}),changed);
 assert.equal(mergeSession(before,{code:'NEW',revision:1,partial:true,songIds:['song'],songs:[]}).songs.length,0);
});
test('pagination and diagnostics enforce bounds and never retain freeform private content',()=>{
 assert.deepEqual(pageRequest(new URL('https://test/?limit=10000&offset=-50')),{limit:100,offset:0,query:''});
 assert.throws(()=>safeDiagnostic({kind:'anything'}));assert.deepEqual(safeDiagnostic({kind:'audio.prepare.failure',seconds:99999,tracks:100,lyrics:'private',email:'private'}),{kind:'audio.prepare.failure',seconds:3600,tracks:24});
});
class Context{
 currentTime=0;sampleRate=100;state='running';outputLatency=0;destination={};sources=[];oscillators=[];
 createBuffer(channels,frames,rate){const data=Array.from({length:channels},()=>new Float32Array(frames));return {duration:frames/rate,numberOfChannels:channels,length:frames,sampleRate:rate,getChannelData:i=>data[i]}}
 createBufferSource(){let assigned=false,value;const node={playbackRate:{value:1},connect(){},start(...args){this.args=args},stop(){}};Object.defineProperty(node,'buffer',{get:()=>value,set:v=>{if(assigned)throw Error('Buffer assigned twice');assigned=true;value=v}});this.sources.push(node);return node}
 createGain(){return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){},setTargetAtTime(){}},connect(){}}}
 createOscillator(){const node={frequency:{},connect(){},start(at){this.at=at},stop(){}};this.oscillators.push(node);return node}
}
test('loop audio preserves offsets and silence, assigns each native buffer once and schedules common loop bounds',()=>{
 const context=new Context(),engine=new BandAudio();engine.context=context;engine.now=()=>0;engine.stems=true;const original=context.createBuffer(1,3200,100);original.getChannelData(0).fill(.5);engine.buffers.set('drums',original);
 try{engine.start({...song,stems:[{...song.stems[0],offset:18}]},{status:'playing',run:'loop',startAt:1000,offset:16,countIn:0,loop:{start:16,end:24}});const node=context.sources[0];assert.equal(node.loop,true);assert.equal(node.buffer.duration,8);assert.equal(node.args[0],1);assert.equal(node.args[1],0);assert.equal(node.buffer.getChannelData(0)[0],0);assert.equal(node.buffer.getChannelData(0)[199],0);assert.equal(node.buffer.getChannelData(0)[200],.5)}finally{engine.stop()}
});
test('count-in does not emit duplicate clicks for zero count-in and audience blocks every click',()=>{
 for(const audience of [false,true]){const context=new Context(),engine=new BandAudio();engine.context=context;engine.now=()=>0;engine.click=true;engine.audience=audience;try{engine.start({...song,stems:[]},{status:'playing',run:'click',startAt:100,offset:0,countIn:0});assert.equal(context.oscillators.length,audience?0:1)}finally{engine.stop()}}
});
const db=new PGlite();await db.exec(readFileSync('tests/supabase-stubs.sql','utf8'));for(const f of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));
const owner=crypto.randomUUID(),other=crypto.randomUUID(),member=crypto.randomUUID();for(const id of [owner,other,member])await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,id+'@rehearsal.test']);
async function asUser(id,query,params=[]){await db.exec("reset role;select set_config('request.jwt.claim.sub','"+id+"',false);set role authenticated");return db.query(query,params)}
async function service(query,params=[]){await db.exec('reset role');return db.query(query,params)}
const band=(await asUser(owner,"select create_band('Band A') id")).rows[0].id,bandB=(await asUser(other,"select create_band('Band B') id")).rows[0].id;
const songA=crypto.randomUUID(),songB=crypto.randomUUID();await service("insert into band_memberships(band_id,user_id,role) values($1,$2,'member')",[band,member]);
for(const [id,b,u] of [[songA,band,owner],[songB,bandB,other]])await asUser(u,'insert into songs(id,band_id,data,created_by) values($1,$2,$3,$4)',[id,b,JSON.stringify({...song,id}),u]);
test('named sets permit multiple gigs, isolate bands, reject foreign songs and atomically protect revisions',async()=>{
 const set=(await asUser(owner,"insert into setlists(band_id,name,is_default) values($1,'Gig',false) returning id",[band])).rows[0].id;
 await asUser(owner,"insert into setlists(band_id,name,is_default) values($1,'Rehearsal',false)",[band]);
 assert.equal((await asUser(owner,"select save_named_setlist($1,1,'Friday',$2) revision",[set,[songA]])).rows[0].revision,2);
 await assert.rejects(asUser(owner,"select save_named_setlist($1,1,'Stale',$2)",[set,[]]),/Setlist changed/);
 await assert.rejects(asUser(owner,"select save_named_setlist($1,2,'Foreign',$2)",[set,[songB]]),/outside workspace/);
 await assert.rejects(asUser(member,"select save_named_setlist($1,2,'Member edit',$2)",[set,[]]),/Editor permission/);
 assert.equal((await asUser(other,'select * from setlists where id=$1',[set])).rows.length,0);
 assert.deepEqual((await asUser(owner,'select song_id from setlist_items where setlist_id=$1',[set])).rows.map(r=>r.song_id),[songA]);
 await assert.rejects(asUser(owner,'insert into setlist_items values($1,$2,1)',[set,songB]),/row-level security/);
});
test('shared request gate checks band membership, fixed scopes and strict diagnostic quota',async()=>{
 await assert.rejects(asUser(other,"select admit_band_request($1,'read')",[band]),/access denied/);
 await assert.rejects(asUser(owner,"select admit_band_request($1,'unlimited')",[band]),/Invalid request scope/);
 await asUser(owner,"select admit_band_request($1,'diagnostics')",[band]);
 await service("update request_windows set count=120 where user_id=$1 and scope='band.diagnostics'",[owner]);
 await assert.rejects(asUser(owner,"select admit_band_request($1,'diagnostics')",[band]),/Request limit/);
 await assert.rejects(db.exec("reset role;set role anon;select public.admit_band_request('"+band+"','read')"),/permission denied/);
});
test('catalog search is paginated, excludes full charts, and cannot read another band',async()=>{
 const catalog=(await asUser(owner,"select * from song_catalog($1,'song',0,50)",[band])).rows;assert.equal(catalog.length,1);assert.equal(catalog[0].id,songA);assert.equal(catalog[0].stems,undefined);assert.equal(catalog[0].sections,undefined);
 assert.equal((await asUser(other,"select * from song_catalog($1,'',0,50)",[band])).rows.length,0);
 assert.equal((await asUser(owner,"select * from song_catalog($1,'does not exist',0,50)",[band])).rows.length,0);
});
test('click-only musicians avoid backing downloads while audience devices retain only public tracks',()=>{
 const example={...song,stems:[...song.stems,{...song.stems[0],id:'click',category:'click',bandOnly:true}]};
 assert.deepEqual(requiredStems(example,false,false).map(s=>s.id),['click']);assert.deepEqual(requiredStems(example,true,true).map(s=>s.id),['drums']);
});
test('isolated database snapshot restores setlists and privacy rules',async()=>{
 await service('select 1');const snapshot=await db.dumpDataDir('gzip');const restored=new PGlite({loadDataDir:snapshot});try{assert.equal((await restored.query('select count(*)::int n from setlists where band_id=$1',[band])).rows[0].n,3);await restored.exec("select set_config('request.jwt.claim.sub','"+other+"',false);set role authenticated");assert.equal((await restored.query('select * from songs where band_id=$1',[band])).rows.length,0)}finally{await restored.close()}
});
test.after(()=>db.close());
