import test from 'node:test';
import assert from 'node:assert/strict';
import {presign,r2Key,r2ObjectInfo} from '../lib/cloud/r2.ts';
import {validateSong} from '../lib/cloud/song-validation.ts';
import {countInSeconds} from '../lib/timeline.ts';
const config={endpoint:'https://example.r2.cloudflarestorage.com',bucket:'private-audio',accessKey:'example-access',secretKey:'server-only-secret'};
test('R2 signed URLs bind object and method, encode filenames, expire and hide signing secrets',()=>{
 const options={now:new Date('2026-10-14T18:00:00Z')};
 const read=new URL(presign(config,'GET','stems/bands/band-a/A song #1.wav',60,options));
 assert.equal(read.pathname,'/private-audio/stems/bands/band-a/A%20song%20%231.wav');
 assert.equal(read.searchParams.get('X-Amz-Expires'),'60');
 assert.equal(read.searchParams.get('X-Amz-Credential'),'example-access/20261014/auto/s3/aws4_request');
 assert.ok(!read.href.includes(config.secretKey));
 const signature=read.searchParams.get('X-Amz-Signature');
 assert.notEqual(new URL(presign(config,'PUT','stems/bands/band-a/A song #1.wav',60,options)).searchParams.get('X-Amz-Signature'),signature);
 assert.notEqual(new URL(presign(config,'GET','stems/bands/band-b/A song #1.wav',60,options)).searchParams.get('X-Amz-Signature'),signature);
 assert.throws(()=>presign(config,'GET','stems/../other'));
 assert.throws(()=>r2Key('untrusted','file'));
});
test('public song saves preserve manual charts and timing while audio identity remains immutable',()=>{
 const old={id:'song-a',title:'Song',duration:120,stems:[{id:'stem-a',name:'Drums',filename:'drums.wav',duration:120,bytes:500,sampleRate:44100,audioVersion:'version-a',enabled:true,volume:.7}]};
 const saved=validateSong({...old,bpm:120,beats:4,countIn:1,chart:{plainLyrics:'Edited lyrics',timedLyrics:[{start:10,end:20,text:'Edited lyrics'}],source:'import',chordpro:'[G]Edited lyrics',updated:1},sections:[{id:'chorus',name:'Chorus 2',manual:true,start:45,bars:8,lyrics:'Edited lyrics',chords:'[G]Edited lyrics',tabs:{Guitar:'e|--3--'},lineCues:[{line:0,at:45}],tabCues:[{id:'tab-a',at:46,instrument:'Guitar',text:'e|--3--'}]}],stems:[{...old.stems[0],bytes:99999,audioVersion:'fake',enabled:false,volume:.4}]},old.id,old);
 assert.equal(saved.chart.plainLyrics,'Edited lyrics');assert.equal(saved.sections[0].start,45);assert.equal(saved.sections[0].manual,true);assert.equal(saved.sections[0].tabCues[0].at,46);assert.equal(saved.stems[0].audioVersion,'version-a');assert.equal(saved.stems[0].bytes,500);assert.equal(saved.stems[0].enabled,false);assert.equal(countInSeconds(saved,45),2);
});
test('renaming an imported click or spoken cue cannot open the audience path',()=>{
 for(const filename of ['click.mp3','spoken-cues.m4a']){
  const old={id:'song-a',title:'Song',duration:120,stems:[{id:'private-a',name:'Track',filename,duration:120,bytes:500,category:'other',enabled:true,volume:.7}]};
  const saved=validateSong({...old,stems:[{...old.stems[0],name:'Guitar',category:'guitar',bandOnly:false}]},old.id,old);
  assert.equal(saved.stems[0].bandOnly,true);
 }
});

test('uploaded R2 stems are verified with HEAD matching the signed method, without downloading audio',async t=>{
 let calls=0;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  calls++;assert.equal(options.method,'HEAD');assert.equal(options.cache,'no-store');
  const signed=new URL(url),stamp=signed.searchParams.get('X-Amz-Date');
  const now=new Date(stamp.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/,'$1-$2-$3T$4:$5:$6Z'));
  assert.equal(url,presign(config,options.method,'stems/bands/band-a/drums.wav',60,{now}));
  return new Response(null,{headers:{'content-length':'60000000',etag:'verified-stem'}});
 });
 assert.deepEqual(await r2ObjectInfo(config,'stems/bands/band-a/drums.wav'),{size:60000000,etag:'verified-stem'});
 assert.equal(calls,1);
});

import {safeProgress,mergeProgress,overallProgress,overallRemaining} from '../lib/job-progress.ts';
test('overall progress advances through phases and four uploads without resetting on retries or reloads',()=>{
 const start=1_000_000;
 const update=(previous,stage,percent,now)=>mergeProgress(previous,safeProgress({stage,percent,startedAt:start},now));
 let p=update(undefined,'downloading',100,start+5000);assert.equal(p.overallPercent,5);
 p=update(p,'separating',100,start+60000);assert.equal(p.overallPercent,50);
 p=update(p,'lyrics',undefined,start+62000);assert.equal(p.overallPercent,50);
 p=update(p,'beats',100,start+80000);assert.equal(p.overallPercent,80);
 for(const percent of [0,25,50,75,100]){const old=p.overallPercent;p=update(p,'uploading',percent,start+90000+percent*1000);assert.ok(p.overallPercent>=old)}
 assert.equal(p.overallPercent,98);p=update(p,'saving',undefined,start+200000);
 const reloaded=JSON.parse(JSON.stringify(p));
 p=mergeProgress(reloaded,safeProgress({stage:'uploading',percent:0,startedAt:start+210000},start+210000));
 assert.equal(p.overallPercent,98);assert.equal(p.overallStartedAt,start);assert.equal(p.recovering,true);
 assert.equal(overallRemaining(p,start+210000),undefined);
 p=update(p,'saving',100,start+220000);assert.equal(p.overallPercent,99);
 const newAttempt=update(undefined,'downloading',0,start+230000);assert.equal(newAttempt.overallPercent,0);
});
test('overall ETA needs observed processing, excludes idle or stale updates and ignores client overall claims',()=>{
 const start=1_000_000,now=start+60000;
 const incoming=safeProgress({stage:'separating',percent:50,startedAt:start,overallPercent:100,overallStartedAt:0},now);
 assert.equal(incoming.overallPercent,undefined);
 const p=mergeProgress(undefined,incoming);
 assert.equal(overallProgress(p),27.5);assert.ok(overallRemaining(p,now)>0);
 assert.equal(overallRemaining(p,now+21000),undefined);
 assert.equal(overallRemaining({...p,connectionLost:true},now),undefined);
 assert.equal(overallRemaining({...p,updatedAt:start+5000},start+5000),undefined);
});

import {DeviceAudioCache,assetCacheKey,deviceAudioCache,mapAudio} from '../lib/device-audio-cache.ts';
import {authorizePrivateAudio} from '../lib/private-audio.ts';
class LocalAudioStore{
 entries=new Map();
 async match(request){const row=this.entries.get(request.url);return row?new Response(row.data.slice(0),{headers:row.headers}):undefined}
 async put(request,response){this.entries.set(request.url,{data:await response.arrayBuffer(),headers:Object.fromEntries(response.headers)})}
 async delete(request){return this.entries.delete(request.url)}
 async keys(){return [...this.entries.keys()].map(url=>new Request(url))}
}
test('uploaded files persist across cache instances, reuse local bytes, and isolate users, bands and file versions',async()=>{
 const store=new LocalAudioStore(),first=new DeviceAudioCache(async()=>store,()=>100),key=assetCacheKey('band-a:user-a','stem-a',4);
 assert.equal(await first.put(key,new Blob(['WAVE']),4),true);
 const reopened=new DeviceAudioCache(async()=>store,()=>100);let downloads=0;const loader=async()=>{downloads++;return new TextEncoder().encode('WAVE').buffer};
 assert.equal(new TextDecoder().decode(await reopened.load(key,4,loader)),'WAVE');assert.equal(downloads,0);
 await reopened.load(assetCacheKey('band-a:user-b','stem-a',4),4,loader);
 await reopened.load(assetCacheKey('band-b:user-a','stem-a',4),4,loader);
 await reopened.load(assetCacheKey('band-a:user-a','replacement',4),4,loader);assert.equal(downloads,3);
});
test('device cache bounds disk use, deduplicates downloads, retries failures and tolerates unavailable storage',async()=>{
 const store=new LocalAudioStore(),cache=new DeviceAudioCache(async()=>store,()=>8);
 await cache.put('old',new ArrayBuffer(6),6);await cache.put('new',new ArrayBuffer(6),6);assert.equal(await cache.has('old'),false);assert.equal(await cache.has('new'),true);
 assert.equal(await cache.put('oversize',new ArrayBuffer(20),20),false);
 let release;const loader=()=>new Promise(resolve=>release=resolve);const one=cache.load('pending',4,loader),two=cache.load('pending',4,loader);
 await new Promise(r=>setTimeout(r,0));release(new ArrayBuffer(4));assert.equal(await one,await two);
 await assert.rejects(cache.load('failure',4,async()=>{throw Error('offline')}));await cache.load('failure',4,async()=>new ArrayBuffer(4));
 const unsupported=new DeviceAudioCache(async()=>{throw Error('blocked')},()=>8);assert.equal((await unsupported.load('x',4,async()=>new ArrayBuffer(4))).byteLength,4);
});
test('clearing private cache prevents an in-flight download from restoring signed-out audio',async()=>{
 const store=new LocalAudioStore(),cache=new DeviceAudioCache(async()=>store,()=>100);let release;
 const pending=cache.load('private',4,()=>new Promise(resolve=>release=resolve));await new Promise(r=>setTimeout(r,0));await cache.clear();release(new ArrayBuffer(4));await pending;assert.equal(await cache.has('private'),false);
});
test('persistent audio requires fresh authorization and never reads a revoked or audience-restricted asset',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async(url,options)=>{calls++;assert.match(url,/authorize=1/);assert.match(url,/session=BAND/);assert.equal(options.headers['x-band-token'],'audience-device');return new Response('{}',{status:403})});
 await assert.rejects(authorizePrivateAudio('song',{id:'click',bytes:4},{code:'BAND',token:'audience-device'}),/access ended/);assert.equal(calls,1);
});
test('background preparation uses a bounded number of concurrent files',async()=>{
 let active=0,max=0,completed=0;await mapAudio([1,2,3,4,5],async()=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,1));active--;completed++},2);assert.equal(completed,5);assert.equal(max,2);
});

test('cached playback performs authorization but skips the full audio transfer',async t=>{
 const store=new LocalAudioStore(),old=globalThis.caches;globalThis.caches={open:async()=>store};let authorization=0,downloads=0;
 t.after(async()=>{await deviceAudioCache.clear();if(old)globalThis.caches=old;else delete globalThis.caches});
 t.mock.method(globalThis,'fetch',async(url,options)=>{if(url.includes('authorize=1')){authorization++;return Response.json({cacheScope:'band:user',assetId:'stem',bytes:4,downloadUrl:'https://audio.example/stem.wav'})}downloads++;assert.equal(options.credentials,'omit');assert.equal(options.headers,undefined);return new Response('WAVE')});
 const stem={id:'stem',name:'Drums',bytes:4};await (await authorizePrivateAudio('song',stem)).load();await (await authorizePrivateAudio('song',stem)).load();
 assert.equal(authorization,2);assert.equal(downloads,1);
});


test('worker duration accepts fractional verified audio without broadening upload quotas',async()=>{
 const {workerDurationLimit}=await import('../lib/worker-duration.ts');
 const limit=workerDurationLimit(136,136.008);
 assert.equal(limit,137);assert.ok(136.008<=limit);assert.ok(138>limit);
 assert.equal(workerDurationLimit(136,136),137);
 assert.equal(workerDurationLimit(327,327.6),328);
 assert.equal(workerDurationLimit(600,600),601);
});
