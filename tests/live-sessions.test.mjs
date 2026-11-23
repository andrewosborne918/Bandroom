import test from 'node:test';import assert from 'node:assert/strict';
import {liveSessions} from '../lib/live-sessions.ts';
import {readSessionJoin,sessionJoinUrl} from '../lib/session-join.ts';
function client(sessions,devices,error=null){const calls=[];return {calls,from(table){const q={select:(...args)=>{calls.push([table,'select',...args]);return q},eq:(...args)=>{calls.push([table,'eq',...args]);return q},gt:(...args)=>{calls.push([table,'gt',...args]);return q},order:()=>q,limit:(...args)=>{calls.push([table,'limit',...args]);return q},in:(...args)=>{calls.push([table,'in',...args]);return q},then(resolve){return Promise.resolve({data:table==='playback_sessions'?sessions:devices,error}).then(resolve)}};return q}}}
test('live discovery is band scoped, time bounded, and omits sessions without a recent device',async()=>{
 const db=client([{id:'a',code:'LIVE1234',data:{name:'Rehearsal',transport:{status:'playing'}}},{id:'b',code:'STALE123',data:{name:'Old'}}],[{session_id:'a'},{session_id:'a'}]);
 const rooms=await liveSessions(db,'band-a',100000);
 assert.deepEqual(rooms,[{code:'LIVE1234',name:'Rehearsal',status:'playing',devices:2}]);
 assert.ok(db.calls.some(c=>c[0]==='playback_sessions'&&c[1]==='eq'&&c[2]==='band_id'&&c[3]==='band-a'));
 assert.ok(db.calls.some(c=>c[0]==='playback_sessions'&&c[1]==='gt'&&c[2]==='expires_at'&&c[3]===new Date(100000).toISOString()));
 assert.ok(db.calls.some(c=>c[0]==='session_devices'&&c[1]==='gt'&&c[2]==='last_seen'&&c[3]===new Date(55000).toISOString()));
 assert.ok(db.calls.some(c=>c[0]==='session_devices'&&c[1]==='in'&&c[2]==='session_id'&&c[3].join(',')==='a,b'));
 assert.equal('token' in rooms[0],false);
});
test('session discovery propagates access failures and skips empty device queries',async()=>{
 const empty=client([],[]);assert.deepEqual(await liveSessions(empty,'band-a'),[]);assert.equal(empty.calls.some(c=>c[0]==='session_devices'),false);
 await assert.rejects(liveSessions(client([],[],Error('denied')),'band-b'),/denied/);
});
test('session sharing links round-trip the session, band and device role',()=>{
 const band='d8ac1899-4558-4ba6-9cb0-3afedd3844b0';
 const link=sessionJoinUrl('https://band.test/workspace?token=ignored','LIVE1234','musician',band);
 assert.equal(link.href,'https://band.test/?join=LIVE1234&band='+band);
 assert.deepEqual(readSessionJoin(link.search),{code:'LIVE1234',role:'musician',band});
 const audience=sessionJoinUrl('https://band.test','LIVE1234','audience',band);
 assert.deepEqual(readSessionJoin(audience.search),{code:'LIVE1234',role:'audience',band});
 assert.deepEqual(readSessionJoin('?join=live1234&band=invalid&role=host'),{code:'LIVE1234',role:'musician',band:undefined});
 assert.equal(readSessionJoin('?join=bad%2Fcode'),null);
});
