import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();await db.exec(readFileSync('tests/supabase-stubs.sql','utf8'));
for(const f of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));
const a=crypto.randomUUID(),b=crypto.randomUUID();for(const id of [a,b])await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,id+'@desktop.test']);
async function user(id,q,p=[]){await db.exec("reset role;select set_config('request.jwt.claim.sub','"+id+"',false);set role authenticated");return db.query(q,p)}
async function service(q,p=[]){await db.exec('reset role');return db.query(q,p)}
const ba=(await user(a,"select create_band('Desktop A') id")).rows[0].id,bb=(await user(b,"select create_band('Desktop B') id")).rows[0].id;
const song=crypto.randomUUID();await user(b,'insert into songs(id,band_id,data,created_by) values($1,$2,$3,$4)',[song,bb,JSON.stringify({id:song,title:'Private B',stems:[]}),b]);
test('desktop approvals require actual editor membership and are single use',async()=>{
 const p=(await service("select * from start_desktop_pair('ip-a','Laptop','macos','poll-a','code-a')")).rows[0];
 await assert.rejects(service("select approve_desktop_pair('code-a',$1,$2)",[ba,b]),/Editor permission/);
 const id=(await service("select approve_desktop_pair('code-a',$1,$2) id",[ba,a])).rows[0].id;
 assert.equal((await service('select band_id from processor_devices where id=$1',[id])).rows[0].band_id,ba);
 await assert.rejects(service("select approve_desktop_pair('code-a',$1,$2)",[bb,b]),/already used/);
 await assert.rejects(user(a,'select * from desktop_pairings'),/permission denied/);
 await assert.rejects(user(a,'select * from processor_devices'),/permission denied/);
 await assert.rejects(user(a,"select claim_desktop_job('attack',$1)",[bb]),/permission denied/);
});
test('expired codes and excessive pairing requests fail',async()=>{
 const p=(await service("select * from start_desktop_pair('ip-b','PC','windows','poll-b','code-b')")).rows[0];await service("update desktop_pairings set expires_at=now()-interval '1 second' where id=$1",[p.id]);await assert.rejects(service("select approve_desktop_pair('code-b',$1,$2)",[ba,a]),/expired/);
 for(let i=0;i<6;i++)await service('select start_desktop_pair($1,$2,$3,$4,$5)',['limited-ip','Computer','windows','poll-'+i,'code-'+i]);await assert.rejects(service("select start_desktop_pair('limited-ip','Computer','windows','poll-7','code-7')"),/Too many/);
});
test('verification and separation queues never claim another band',async()=>{
 const asset=crypto.randomUUID(),job=crypto.randomUUID();await service("update platform_config set ai_enabled=true,monthly_ai_seconds_cap=36000");
 await user(b,"select reserve_upload($1,$2,$3,$4,'mix.mp3',1000,60,44100,'original')",[bb,song,asset,crypto.randomUUID()]);await service('insert into verification_tasks(asset_id) values($1)',[asset]);
 assert.equal((await service("select claim_desktop_job('lease-a',$1) job",[ba])).rows[0].job,null);
 const verify=(await service("select claim_desktop_job('lease-b',$1) job",[bb])).rows[0].job;assert.equal(verify.kind,'verification');assert.equal(verify.asset.band_id,bb);
 await service("update verification_tasks set status='completed' where id=$1",[verify.id]);await service("select finalize_upload($1,1000,60,44100,'other')",[asset]);await user(b,"select submit_separation($1,$2,$3,$4,'desktop-job')",[bb,song,asset,job]);
 assert.equal((await service("select claim_desktop_job('lease-a',$1) job",[ba])).rows[0].job,null);const separation=(await service("select claim_desktop_job('lease-b',$1) job",[bb])).rows[0].job;assert.equal(separation.id,job);assert.equal(separation.band_id,bb);
 await service("update processing_jobs set status='completed',results='[]' where id=$1",[job]);await user(b,'select request_export($1)',[job]);
 assert.equal((await service("select claim_desktop_export('zip-a',$1) job",[ba])).rows[0].job,null);assert.equal((await service("select claim_desktop_export('zip-b',$1) job",[bb])).rows[0].job.band_id,bb);
});
test.after(()=>db.close());
