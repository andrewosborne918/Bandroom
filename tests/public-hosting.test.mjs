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
