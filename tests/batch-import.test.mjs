import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {fileFingerprint,processImportBatch,MAX_BATCH_SONGS} from '../lib/import-batch.ts';
test('batch uploads run sequentially and a failed file does not prevent later uploads',async()=>{
 const completed=[],failed=[];let active=0,maximum=0;
 await processImportBatch([1,2,3],async n=>{active++;maximum=Math.max(maximum,active);try{await Promise.resolve();if(n===2)throw Error('Bad recording');completed.push(n)}finally{active--}},(n,e)=>failed.push([n,e.message]));
 assert.deepEqual(completed,[1,3]);assert.deepEqual(failed,[[2,'Bad recording']]);assert.equal(maximum,1);
});
test('pause finishes the current item and leaves remaining files untouched',async()=>{let stop=false;const seen=[];await processImportBatch([1,2,3],async n=>{seen.push(n);stop=true},()=>assert.fail(),()=>stop);assert.deepEqual(seen,[1]);assert.equal(MAX_BATCH_SONGS,20);assert.equal(fileFingerprint({name:'a.mp3',size:1,lastModified:2}),fileFingerprint({name:'a.mp3',size:1,lastModified:2}));assert.notEqual(fileFingerprint({name:'a.mp3',size:1,lastModified:2}),fileFingerprint({name:'a.mp3',size:2,lastModified:2}));});
const db=new PGlite();await db.exec(readFileSync('tests/supabase-stubs.sql','utf8'));for(const f of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));
const owner=crypto.randomUUID(),other=crypto.randomUUID();for(const id of [owner,other])await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,id+'@batch.test']);
async function user(id,q,p=[]){await db.exec("reset role;select set_config('request.jwt.claim.sub','"+id+"',false);set role authenticated");return db.query(q,p)}
async function service(q,p=[]){await db.exec('reset role');return db.query(q,p)}
const band=(await user(owner,"select create_band('Batch band') id")).rows[0].id,foreign=(await user(other,"select create_band('Other band') id")).rows[0].id;
await service('update platform_config set ai_enabled=true,monthly_ai_seconds_cap=100000');
async function input(b=band,actor=owner){const song=crypto.randomUUID(),asset=crypto.randomUUID();await user(actor,'insert into songs(id,band_id,data,created_by) values($1,$2,$3,$4)',[song,b,JSON.stringify({id:song,title:'Batch song',stems:[],sections:[]}),actor]);await user(actor,"select reserve_upload($1,$2,$3,$4,'mix.mp3',1000,2,44100,'original')",[b,song,asset,crypto.randomUUID()]);await service("select finalize_upload($1,1000,2,44100,'other')",[asset]);return {song,asset}}
async function submit(record,b=band,actor=owner){const job=crypto.randomUUID();await user(actor,'select submit_separation($1,$2,$3,$4,$5)',[b,record.song,record.asset,job,'batch-'+job]);return job}
let first,second,third;
test('several songs queue durably while desktop processors claim only one per band',async()=>{
 first=await submit(await input());second=await submit(await input());third=await submit(await input());
 const claimed=(await service("select claim_desktop_job('first-lease',$1) job",[band])).rows[0].job;assert.equal(claimed.id,first);
 assert.equal((await service("select claim_desktop_job('second-device',$1) job",[band])).rows[0].job,null);
 await assert.rejects(service("update processing_jobs set status='processing' where id=$1",[second]),/duplicate key/);
 await service("update processing_jobs set lease_expires_at=now()-interval '1 second' where id=$1",[first]);
 assert.equal((await service("select claim_desktop_job('recovered-lease',$1) job",[band])).rows[0].job.id,first);
 await assert.rejects(service("select finish_separation($1,'first-lease','[]','stale')",[first]),/Stale job/);
 await service("select finish_separation($1,'recovered-lease','[]','test failure')",[first]);
 assert.equal((await service("select claim_desktop_job('next-lease',$1) job",[band])).rows[0].job.id,second);
 await user(owner,'select retry_separation($1)',[first]);
 assert.equal((await service("select claim_desktop_job('blocked-device',$1) job",[band])).rows[0].job,null);
 assert.equal((await service('select count(*)::int n from processing_usage where job_id=$1',[first])).rows[0].n,1);
 await service("select finish_separation($1,'next-lease','[]','continue after failure')",[second]);
 const after=(await service("select claim_desktop_job('retry-lease',$1) job",[band])).rows[0].job;assert.equal(after.id,first);
 await user(owner,'select cancel_separation($1)',[first]);await user(owner,'select cancel_separation($1)',[third]);
});
test('another band cannot read, submit, cancel or claim these jobs',async()=>{
 assert.equal((await user(other,'select * from processing_jobs where band_id=$1',[band])).rows.length,0);
 await assert.rejects(user(other,'select cancel_separation($1)',[second]),/Permission denied/);
 const own=await input();await assert.rejects(submit(own,band,other),/Editor permission/);
 assert.equal((await service("select claim_desktop_job('foreign-lease',$1) job",[foreign])).rows[0].job,null);
});
test('queue capacity stays bounded and rejected submissions do not reserve more output storage',async()=>{
 const queued=[];for(let i=0;i<20;i++)queued.push(await submit(await input()));
 const extra=await input();const before=Number((await service('select reserved_bytes from band_usage where band_id=$1',[band])).rows[0].reserved_bytes);
 await assert.rejects(submit(extra),/queue is full/);assert.equal(Number((await service('select reserved_bytes from band_usage where band_id=$1',[band])).rows[0].reserved_bytes),before);
 await user(owner,'select cancel_separation($1)',[queued[0]]);assert.ok(await submit(extra));
});
test('batch queue still enforces the monthly processing allowance',async()=>{
 const b=(await user(other,"select create_band('Limited band') id")).rows[0].id;await service('update entitlements set ai_monthly_seconds=2 where band_id=$1',[b]);await submit(await input(b,other),b,other);await assert.rejects(submit(await input(b,other),b,other),/allowance reached/);
});
test.after(()=>db.close());
