import test from 'node:test';
import {validInvitationTokenHash} from '../lib/invitation-token.ts';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();await db.exec(readFileSync('tests/supabase-stubs.sql','utf8'));
for(const f of readdirSync('supabase/migrations').filter(x=>x.endsWith('.sql')).sort())await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));
const owner=crypto.randomUUID();await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'owner@private.test',now())",[owner]);
await db.exec('drop trigger aaa_approve_fixture_identity on auth.users');
async function service(q,p=[]){await db.exec('reset role');return db.query(q,p)}
async function user(id,q,p=[]){await db.exec("reset role;select set_config('request.jwt.claim.sub','"+id+"',false);set role authenticated");return db.query(q,p)}
const band=(await user(owner,"select create_band('Private rehearsal') id")).rows[0].id;
const guest=crypto.randomUUID();
test('uninvited direct signup is rejected, including forged owner metadata',async()=>{
 await assert.rejects(service("insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,'stranger@private.test',now(),'{\"role\":\"owner\",\"applicationOwner\":true}')",[crypto.randomUUID()]),/invite-only/);
});
test('only the app owner may issue invitations and admission records are private',async()=>{
 await user(owner,"select invite_member($1,' Guest@private.test ','member','guest_hash')",[band]);
 await service("insert into auth.users(id,email,email_confirmed_at) values($1,'guest@private.test',now())",[guest]);
 assert.equal((await user(guest,'select is_invitation_owner() allowed')).rows[0].allowed,false);
 await assert.rejects(user(guest,'select * from invitation_owners'),/permission denied/);
 await assert.rejects(user(guest,'insert into invitation_owners values($1)',[guest]),/permission denied/);
 await user(guest,"select respond_invitation('guest_hash',true)");
 await service("update band_memberships set role='admin' where band_id=$1 and user_id=$2",[band,guest]);
 await assert.rejects(user(guest,"select invite_member($1,'next@private.test','member','forged_hash')",[band]),/Invitation permission denied/);
 await assert.rejects(user(guest,"select create_band('Unapproved room')"),/Only the app owner/);
});
test('expired, declined and replaced invitations cannot create new accounts',async()=>{
 for(const state of ['expired','declined']){
  await user(owner,"select invite_member($1,$2,'member',$3)",[band,state+'@private.test',state]);
  await service(state==='expired'?"update invitations set expires_at=now()-interval '1 second' where token_hash=$1":"update invitations set declined_at=now() where token_hash=$1",[state]);
  await assert.rejects(service('insert into auth.users(id,email) values($1,$2)',[crypto.randomUUID(),state+'@private.test']),/invite-only/);
 }
 await user(owner,"select invite_member($1,'repeat@private.test','member','old')",[band]);
 await user(owner,"select invite_member($1,'repeat@private.test','editor','new')",[band]);
 assert.equal((await service("select declined_at is not null revoked from invitations where token_hash='old'")).rows[0].revoked,true);
});
test('a valid invitation still requires its matching verified email and remains single use',async()=>{
 await user(owner,"select invite_member($1,'fresh@private.test','member','fresh')",[band]);
 const fresh=crypto.randomUUID();await service("insert into auth.users(id,email) values($1,'fresh@private.test')",[fresh]);
 await assert.rejects(user(fresh,"select respond_invitation('fresh',true)"),/verified invited email/);
 await assert.rejects(user(guest,"select respond_invitation('fresh',true)"),/verified invited email/);
 await service('update auth.users set email_confirmed_at=now() where id=$1',[fresh]);
 await user(fresh,"select respond_invitation('fresh',true)");
 await assert.rejects(user(fresh,"select respond_invitation('fresh',true)"),/expired or used/);
 assert.equal((await user(fresh,'select count(*)::int count from songs')).rows[0].count,0);
});
test('legacy uninvited accounts cannot create workspaces or invite people',async()=>{
 await service('alter table auth.users disable trigger require_invited_signup');const legacy=crypto.randomUUID();await service("insert into auth.users(id,email,email_confirmed_at) values($1,'legacy@private.test',now())",[legacy]);await service('alter table auth.users enable trigger require_invited_signup');
 await assert.rejects(user(legacy,"select create_band('Blocked')"),/Only the app owner/);
 await assert.rejects(user(legacy,"select invite_member($1,'next@private.test','member','nope')",[band]),/Invitation permission denied/);
 assert.equal((await user(legacy,'select count(*)::int count from bands')).rows[0].count,0);
});

test('invitation acceptance accepts actual provider token sizes and rejects unsafe or unbounded input',()=>{
 for(const token of ['a'.repeat(56),'b'.repeat(64),'opaque_provider_token_'.repeat(3)])assert.equal(validInvitationTokenHash(token),true);
 for(const token of ['', 'x'.repeat(257),'a b'.repeat(20),'http://untrusted.example'])assert.equal(validInvitationTokenHash(token),false);
});
