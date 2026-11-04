import test from 'node:test';import assert from 'node:assert/strict';
import {stampChartTime,chartTimingProblems} from '../lib/manual-chart-timing.ts';
import {automaticScore,followRows,activeFollowRow} from '../lib/chart-follow.ts';
import {validateSong} from '../lib/cloud/song-validation.ts';
const fixture=()=>({id:'song',title:'Timing sample',artist:'Example',duration:40,bpm:120,key:'D',beats:4,denominator:4,countIn:1,beatOffset:0,revision:3,info:{guitarTuning:'drop-d'},stems:[{id:'audio',name:'Guitar',filename:'guitar.wav',enabled:true,volume:.7,bytes:100,duration:40}],sections:[{id:'verse',name:'Verse 1',start:0,bars:8,manual:true,chords:'[C] [G]\n[C]Words here\n[G]Second words',lyrics:'Words here\nSecond words',tabs:{Guitar:'e|--0--|\n\ne|--0--|\n\ne|--2--|',Bass:'G|--0--|'}},{id:'chorus',name:'Chorus',start:20,bars:8,manual:true,chords:'[D]Chorus words',lyrics:'Chorus words',tabs:{}}]});
const row=(song,view,predicate)=>automaticScore(song,view,'Guitar').find(predicate);
test('section taps store precise starts without changing recording, tuning or the original draft',()=>{
 const song=fixture(),updated=stampChartTime(song,row(song,'chords',r=>r.heading&&r.section===1),'chords','Guitar',24.1234);
 assert.equal(updated.sections[1].start,24.123);assert.equal(song.sections[1].start,20);assert.equal(updated.bpm,120);assert.equal(updated.key,'D');assert.deepEqual(updated.stems,song.stems);assert.deepEqual(updated.info,song.info);assert.deepEqual(chartTimingProblems(updated),[]);
});
test('lyric and chord line taps stay separate when instrumental chord lines change their indices',()=>{
 let song=fixture();song=stampChartTime(song,row(song,'chords',r=>!r.heading&&r.section===0&&r.line===1),'chords','Guitar',5);
 song=stampChartTime(song,row(song,'lyrics',r=>!r.heading&&r.section===0&&r.line===0),'lyrics','Guitar',6);
 assert.equal(followRows(song,0,'chords')[1].at,5);assert.equal(followRows(song,0,'lyrics')[0].at,6);
 assert.equal(followRows(song,0,'chords')[1].manual,true);assert.deepEqual(chartTimingProblems(song),[]);
 const saved=validateSong(song,song.id,fixture());assert.equal(saved.sections[0].lineCues.find(c=>c.view==='lyrics').at,6);assert.equal(saved.info.guitarTuning,'drop-d');
});
test('partially timing repeated tab blocks keeps every block visible and updates only the selected occurrence',()=>{
 let song=fixture();song.sections[0].tabCues=[{id:'bass-cue',instrument:'Bass',at:2,text:'G|--0--|'}];
 song=stampChartTime(song,row(song,'tabs',r=>r.tab&&r.block===1),'tabs','Guitar',8);
 let tabs=automaticScore(song,'tabs','Guitar').filter(r=>r.tab);assert.equal(tabs.length,3);assert.equal(tabs[1].at,8);assert.equal(tabs[1].manual,true);assert.equal(tabs[0].estimated,true);assert.equal(tabs[2].estimated,true);
 const cueId=tabs[1].cueId;song=stampChartTime(song,tabs[1],'tabs','Guitar',10);tabs=automaticScore(song,'tabs','Guitar').filter(r=>r.tab);
 assert.equal(tabs[1].cueId,cueId);assert.equal(tabs[1].at,10);assert.equal(song.sections[0].tabCues.length,2);assert.equal(song.sections[0].tabCues.find(c=>c.id==='bass-cue').at,2);
 const saved=validateSong(song,song.id,fixture());assert.equal(saved.sections[0].tabCues.find(c=>c.instrument==='Guitar').block,1);assert.equal(automaticScore(saved,'tabs','Guitar').filter(r=>r.tab).length,3);
});
test('invalid and backwards marks cannot silently produce a broken follow timeline',()=>{
 const song=fixture(),target=row(song,'chords',r=>!r.heading&&r.line===1);
 for(const at of [-1,40,NaN,Infinity])assert.throws(()=>stampChartTime(song,target,'chords','Guitar',at),/inside/);
 let changed=stampChartTime(song,target,'chords','Guitar',12);changed=stampChartTime(changed,row(changed,'chords',r=>!r.heading&&r.line===2),'chords','Guitar',8);assert.ok(chartTimingProblems(changed).some(p=>p.includes('backwards')));
 changed=stampChartTime(song,target,'chords','Guitar',25);assert.ok(chartTimingProblems(changed).some(p=>p.includes('outside')));
 changed=stampChartTime(song,row(song,'chords',r=>r.heading&&r.section===0),'chords','Guitar',25);assert.ok(chartTimingProblems(changed).some(p=>p.includes('previous section')));
});
test('manual section boundaries supersede automatic lyric matches outside that section',()=>{
 const song=fixture();song.sections[0].start=10;song.chart={source:'import',plainLyrics:'Words here',timedLyrics:[{start:1,end:3,text:'Words here'}],title:'Timing sample',artist:'Example',sourceUrl:'',updated:1};
 const rows=automaticScore(song,'lyrics','Guitar');assert.equal(rows.find(r=>!r.heading).at,10);assert.equal(rows.find(r=>!r.heading).estimated,true);
});
test('saved manual marks select the intended part during follow playback',()=>{
 let song=fixture();song=stampChartTime(song,row(song,'chords',r=>!r.heading&&r.section===0&&r.line===1),'chords','Guitar',5);song=stampChartTime(song,row(song,'chords',r=>!r.heading&&r.section===0&&r.line===2),'chords','Guitar',12);
 const rows=automaticScore(validateSong(song,song.id,fixture()),'chords','Guitar');assert.equal(rows[activeFollowRow(rows,6)].line,1);assert.equal(rows[activeFollowRow(rows,13)].line,2);
});
test('editing a tab block invalidates its old manual timestamp instead of confirming the wrong notes',()=>{
 let song=fixture();song=stampChartTime(song,row(song,'tabs',r=>r.tab&&r.block===1),'tabs','Guitar',8);
 song={...song,sections:song.sections.map((s,i)=>i? s:{...s,tabs:{...s.tabs,Guitar:'e|--0--|\n\ne|--9--|\n\ne|--2--|'}})};
 const changed=automaticScore(song,'tabs','Guitar').find(r=>r.block===1);assert.equal(changed.estimated,true);assert.equal(changed.manual,false);
});
