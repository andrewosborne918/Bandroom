import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {fileFingerprint,processImportBatch,MAX_BATCH_SONGS} from '../lib/import-batch.ts';
import {formatStorage,storageUsage,FREE_STORAGE_BYTES} from '../lib/storage-usage.ts';
test('storage displays include reservations, clamp remaining space and distinguish unlimited from zero',()=>{
 assert.deepEqual(storageUsage(1024,2048,4096),{used:3072,remaining:1024,unlimited:false,percent:75});
 assert.equal(storageUsage(5000,0,4096).remaining,0);assert.equal(storageUsage(1,0,0).percent,100);
 assert.equal(storageUsage(5000,2000,null).unlimited,true);assert.equal(storageUsage(5000,2000,null).remaining,null);
 assert.equal(formatStorage(FREE_STORAGE_BYTES),'2.00 GiB');
});
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
test('storage reconciliation repairs drift while preserving live upload, job and export reservations',async()=>{
 const b=(await user(other,"select create_band('Storage accounting') id")).rows[0].id;
 const completedInput=await input(b,other),complete=await submit(completedInput,b,other);
 // Completed jobs retain their estimate; it must not remain in reserved usage.
 await service("update processing_jobs set status='completed' where id=$1",[complete]);
 const queued=await submit(await input(b,other),b,other);
 const pending=crypto.randomUUID();await user(other,"select reserve_upload($1,$2,$3,$4,'pending.mp3',1000,2,44100,'original')",[b,completedInput.song,pending,crypto.randomUUID()]);
 const zip=(await user(other,'select * from request_export($1)',[complete])).rows[0];
 const expected=Number((await service('select bytes from storage_reservations where asset_id=$1',[pending])).rows[0].bytes)+Number((await service('select output_reserved_bytes from processing_jobs where id=$1',[queued])).rows[0].output_reserved_bytes)+Number(zip.reserved_bytes);
 await service('update band_usage set stored_bytes=999999,reserved_bytes=999999 where band_id=$1',[b]);
 await assert.rejects(user(other,'select reconcile_usage($1)',[b]),/permission denied/);
 await service('select reconcile_usage($1)',[b]);
 let usage=(await service('select * from band_usage where band_id=$1',[b])).rows[0];assert.equal(Number(usage.stored_bytes),2000);assert.equal(Number(usage.reserved_bytes),expected);
 await service("update export_jobs set status='completed',bytes=123,reserved_bytes=0 where id=$1",[zip.id]);
 await service('select reconcile_usage($1)',[b]);await service('select reconcile_usage($1)',[b]);
 usage=(await service('select * from band_usage where band_id=$1',[b])).rows[0];assert.equal(Number(usage.stored_bytes),2123);assert.equal(Number(usage.reserved_bytes),expected-Number(zip.reserved_bytes));
 await user(other,'select cancel_separation($1)',[queued]);await service('select release_upload($1)',[pending]);await service('select reconcile_usage($1)',[b]);
 assert.equal(Number((await service('select reserved_bytes from band_usage where band_id=$1',[b])).rows[0].reserved_bytes),0);
});
test('unlimited storage is service-granted, follows owned bands and cannot leak through membership or transfer',async()=>{
 const personal=crypto.randomUUID(),free=crypto.randomUUID();for(const id of [personal,free])await service('insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,$2,now(),$3)',[id,id+'@storage.test',JSON.stringify({storage_unlimited:true})]);
 const current=(await user(personal,"select create_band('Personal library') id")).rows[0].id;
 assert.equal(Number((await service('select storage_limit from entitlements where band_id=$1',[current])).rows[0].storage_limit),FREE_STORAGE_BYTES);
 await assert.rejects(user(personal,"insert into storage_account_overrides(user_id,storage_limit,plan) values($1,null,'personal')",[personal]),/permission denied/);
 await assert.rejects(user(personal,'select apply_account_storage($1)',[current]),/permission denied/);
 await service("insert into storage_account_overrides(user_id,storage_limit,plan) values($1,null,'personal')",[personal]);
 assert.equal((await service('select storage_limit from entitlements where band_id=$1',[current])).rows[0].storage_limit,null);
 const future=(await user(personal,"select create_band('Future personal library') id")).rows[0].id;
 assert.equal((await service('select storage_limit from entitlements where band_id=$1',[future])).rows[0].storage_limit,null);
 const ordinary=(await user(free,"select create_band('Free library') id")).rows[0].id;
 await service("insert into band_memberships(band_id,user_id,role) values($1,$2,'member')",[ordinary,personal]);
 assert.equal(Number((await service('select storage_limit from entitlements where band_id=$1',[ordinary])).rows[0].storage_limit),FREE_STORAGE_BYTES);
 await service('update band_usage set stored_bytes=$2 where band_id=$1',[current,3*1024**3]);
 const record=await input(current,personal);const job=await submit(record,current,personal);
 await assert.rejects(user(personal,"select reserve_upload($1,$2,$3,$4,'too-large.mp3',999999999,2,44100,'original')",[current,record.song,crypto.randomUUID(),crypto.randomUUID()]),/Invalid audio/);
 await service("update processing_jobs set status='completed',results='[]' where id=$1",[job]);
 assert.ok((await user(personal,'select * from request_export($1)',[job])).rows[0].id);
 await service("insert into band_memberships(band_id,user_id,role) values($1,$2,'member')",[current,free]);
 await user(personal,'select transfer_ownership($1,$2)',[current,free]);
 const entitlement=(await service('select * from entitlements where band_id=$1',[current])).rows[0];assert.equal(Number(entitlement.storage_limit),FREE_STORAGE_BYTES);assert.equal(entitlement.plan,'free');
 await assert.rejects(user(free,"select reserve_upload($1,$2,$3,$4,'full.mp3',1000,2,44100,'original')",[current,record.song,crypto.randomUUID(),crypto.randomUUID()]),/Storage allowance/);
 await service('delete from storage_account_overrides where user_id=$1',[personal]);
 assert.equal(Number((await service('select storage_limit from entitlements where band_id=$1',[future])).rows[0].storage_limit),FREE_STORAGE_BYTES);
});
test.after(()=>db.close());
