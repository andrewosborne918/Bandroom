import test from 'node:test';import assert from 'node:assert/strict';
import {liveSessions} from '../lib/live-sessions.ts';
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
