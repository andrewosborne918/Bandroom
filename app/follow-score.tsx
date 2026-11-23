'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import type {Song} from '../lib/types';
import type {ScoreRow} from '../lib/chart-follow';
import {automaticScore,activeFollowRow,usesRecordedLineTiming} from '../lib/chart-follow';
import {stampChartTime,chartTimingProblems,resetLineTiming} from '../lib/manual-chart-timing';
import {lyricsOnly} from '../lib/song-charts';
import {formatTime,transpose} from '../lib/timeline';
import {diatonicChordsForKey,chordQualitiesFor,nudgeChordOccurrence,replaceChordInSong,updateSectionLine,splitSectionAtLine,autoSplitAnalyzedSections} from '../lib/chart-edit';
import ChordLine from './chord-line';
type TimingMode='adjust'|'tap'|'record';
export default function FollowScore({song,sectionIndex,view,instrument,position,following,transposeBy,showChords,showLyrics,canEdit,canTime,timingToolsVisible=true,onSave,onStart,onFollow,followReset,readPosition,readRecordingPosition,onDirtyChange,timingReset}:{song:Song;sectionIndex:number;view:string;instrument:string;position:number;following:boolean;transposeBy:number;showChords:boolean;showLyrics:boolean;canEdit:boolean;canTime:boolean;timingToolsVisible?:boolean;onSave:(song:Song)=>Promise<void>;onStart:(at:number,recording?:boolean)=>Promise<void>;onFollow:()=>void;followReset:number;readPosition:()=>number;readRecordingPosition:()=>number|null;onDirtyChange:(dirty:boolean)=>void;timingReset:number}){
 const [draft,setDraft]=useState<Song|null>(null),[history,setHistory]=useState<Song[]>([]),[scope,setScope]=useState('sections'),[next,setNext]=useState(0),[saving,setSaving]=useState(false),[status,setStatus]=useState('');
 const [timingMode,setTimingMode]=useState<TimingMode>('adjust');
 const [adjustment,setAdjustment]=useState<{rowKey:string;seconds:string}|null>(null);
 const [activeChordEdit,setActiveChordEdit]=useState<{rowKey:string;section:number;line:number;occurrence:number;rawChord:string;displayedChord:string;custom:string}|null>(null);
 const [activeLineEdit,setActiveLineEdit]=useState<{rowKey:string;section:number;line:number;text:string;sectionName:string}|null>(null);
 const scoreSong=draft||song,rows=useMemo(()=>automaticScore(scoreSong,view,instrument),[scoreSong,view,instrument]),active=activeFollowRow(rows,position),container=useRef<HTMLDivElement>(null),[browsing,setBrowsing]=useState(false),[error,setError]=useState('');
 const targets=useMemo(()=>rows.filter(r=>scope==='sections'?r.heading:!r.heading),[rows,scope]);
 const adjusting=!!draft&&timingMode==='adjust';
 const recording=!!draft&&timingMode==='record';
 const [recordingStarted,setRecordingStarted]=useState(false);
 const recordingControls=useRef<HTMLElement>(null);
 const markNextRef=useRef<()=>void>(()=>{});
 const nextRef=useRef(next);
 const passComplete=recording&&targets.length>0&&next===targets.length;
 const nextRecordingText=recording?(lyricsOnly(targets[next]?.text||'')||targets[next]?.text):'';
 const starting=useRef(false),lastSection=useRef(sectionIndex);
 const dirty=history.length>0;
 const diatonic=useMemo(()=>diatonicChordsForKey(song.key),[song.key]);
 useEffect(()=>{onDirtyChange(dirty)},[dirty,onDirtyChange]);
 useEffect(()=>{setDraft(null);setHistory([]);setStatus('');setError('');setNext(0);setRecordingStarted(false);setAdjustment(null);setActiveChordEdit(null);setActiveLineEdit(null)},[song.id,timingReset]);
 useEffect(()=>{setNext(0);setAdjustment(null);setActiveChordEdit(null);setActiveLineEdit(null)},[view,instrument,scope]);
 useEffect(()=>{if(!following||browsing||draft||activeChordEdit||activeLineEdit)return;const box=container.current,row=box?.querySelector<HTMLElement>('[data-current="true"]');if(box&&row){const top=row.getBoundingClientRect().top-box.getBoundingClientRect().top+box.scrollTop-box.clientHeight*.28;box.scrollTo({top:Math.max(0,top),behavior:'smooth'})}},[active,following,browsing,view,draft,activeChordEdit,activeLineEdit]);
 useEffect(()=>{if(!following&&lastSection.current!==sectionIndex&&!draft){const box=container.current,row=box?.querySelector<HTMLElement>('[data-section="'+sectionIndex+'"][data-heading="true"]');if(box&&row)box.scrollTo({top:row.getBoundingClientRect().top-box.getBoundingClientRect().top+box.scrollTop,behavior:'smooth'});setBrowsing(true)}lastSection.current=sectionIndex;},[sectionIndex,following,draft]);
 useEffect(()=>{if(following)setBrowsing(false)},[following,song.id,followReset]);
 useEffect(()=>{if(!dirty)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[dirty]);
 useEffect(()=>{
  if(!recording||!recordingStarted||passComplete)return;
  function space(event:KeyboardEvent){
   if(event.code!=='Space'||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||event.defaultPrevented)return;
   if(event.target instanceof Element&&event.target.closest('input, textarea, select, button, a, [contenteditable]:not([contenteditable=false])'))return;
   event.preventDefault();
   if(!event.repeat)markNextRef.current();
  }
  document.addEventListener('keydown',space);
  return()=>document.removeEventListener('keydown',space);
 },[recording,recordingStarted,passComplete]);
 useEffect(()=>{
  if(!recording||!recordingStarted)return;
  const box=container.current,row=box?.querySelector<HTMLElement>('[data-next-recording-line="true"]');
  if(!box||!row)return;
  const viewport=box.getBoundingClientRect(),bounds=row.getBoundingClientRect();
  if(bounds.top<viewport.top||bounds.bottom>viewport.bottom)box.scrollTo({top:box.scrollTop+bounds.top-viewport.top,behavior:'instant'});
 },[recording,recordingStarted,next]);
 async function start(at:number){if(starting.current)return;starting.current=true;setError('');try{await onStart(at);if(!draft)setBrowsing(false)}catch(e:any){setError(e.message)}finally{starting.current=false}}
 function openTiming(mode:TimingMode){
  const box=container.current;
  if(box)box.scrollTo({top:box.scrollTop,behavior:'instant'});
  const copy=structuredClone(song);
  setDraft(mode==='record'&&(view==='chords'||view==='lyrics')?resetLineTiming(copy,view):copy);
  setTimingMode(mode);
  setScope(mode==='tap'&&!usesRecordedLineTiming(song,view)?'sections':'lines');
  setHistory([]);
  setNext(0);
  setRecordingStarted(false);
  setAdjustment(null);
  setStatus('');
  setError('');
  setBrowsing(true);
 }
 function mark(row:ScoreRow,at=readPosition()){
  if(!draft||saving)return;
  try{
   const updated=stampChartTime(draft,row,view,instrument,at);
   setHistory(previous=>[...previous.slice(-49),draft]);
   setDraft(updated);
   setError('');
   if(adjusting){
    const saved=Math.min(draft.duration-.001,Math.round(at*1000)/1000);
    setAdjustment({rowKey:row.key,seconds:saved.toFixed(3)});
   }else if(!recording){
    setNext(Math.min(targets.length,targets.findIndex(r=>r.key===row.key)+1));
    setStatus((row.heading?row.text:view==='tabs'?instrument+' tab block':'Line '+(row.line+1))+' marked at '+at.toFixed(2)+'s.');
   }
  }catch(e:any){setError(e.message)}
 }
 async function startRecording(){
  if(starting.current)return;
  starting.current=true;
  setError('');
  try{
   await onStart(0,true);
   setRecordingStarted(true);
   recordingControls.current?.focus({preventScroll:true});
  }catch(e:any){setError(e.message)}finally{starting.current=false}
 }
 function markNext(){
  const row=targets[next];
  if(!recordingStarted||!draft||saving||!row||nextRef.current!==next)return;
  const at=readRecordingPosition();
  if(at===null)return;
  const previous=targets[next-1]?.at;
  if(previous!==undefined&&Math.round(at*1000)<=Math.round(previous*1000))return;
  try{
   const updated=stampChartTime(draft,row,view,instrument,at);
   nextRef.current=next+1;
   setDraft(updated);
   setHistory(history=>[...history.slice(-49),draft]);
   setNext(next+1);
   setError('');
  }catch(e:any){setError(e.message)}
 }
 nextRef.current=next;
 markNextRef.current=markNext;
 function undoTiming(){
  const previous=history.at(-1);
  if(!previous)return;
  setDraft(previous);
  setHistory(history.slice(0,-1));
  setError('');
  if(adjusting&&adjustment){
   const row=automaticScore(previous,view,instrument).find(candidate=>candidate.key===adjustment.rowKey);
   if(row)setAdjustment({...adjustment,seconds:(row.at??0).toFixed(3)});
  }
  if(!adjusting){
   setNext(Math.max(0,next-1));
   if(recording)recordingControls.current?.focus({preventScroll:true});
   else setStatus('Last mark undone.');
  }
 }
 function cancel(){
  if(dirty&&!window.confirm('Discard your unsaved timing changes?'))return;
  setDraft(null);
  setHistory([]);
  setAdjustment(null);
  setStatus('');
  setError('');
 }
 const problems=useMemo(()=>draft&&(!recording||passComplete)?chartTimingProblems(draft):[],[draft,recording,passComplete]);
 async function save(clear=false){
  if(!draft||saving)return;
  if(clear&&(!recording||recordingStarted||next!==0))return;
  if(!clear&&(!dirty||recording&&!passComplete))return;
  if(song.revision!==draft.revision){setError('This song changed on another device. Your timing marks are still here; reload the song before applying them to the changed chart.');return;}
  if(problems.length){setError(problems.join(' '));return;}
  setSaving(true);setError('');try{await onSave({...song,info:draft.info,sections:draft.sections,revision:draft.revision});setDraft(null);setHistory([]);setAdjustment(null);setStatus(clear?'Saved with line timing cleared.':'Timing saved.');if(adjusting)setBrowsing(true);else{onFollow();setBrowsing(false)}}catch(e:any){setError(e.message)}finally{setSaving(false)}
 }
 async function applyChordChange(nextDisplayedChord:string|null,replaceScope:'one'|'section'|'song'='one'){
  if(!activeChordEdit||saving)return;
  const rawNext=nextDisplayedChord?transpose('['+nextDisplayedChord.trim().replace(/^\[|\]$/g,'')+']',-transposeBy).slice(1,-1):null;
  setSaving(true);setError('');
  try{
   const updated=replaceChordInSong(song,activeChordEdit.section,activeChordEdit.line,activeChordEdit.occurrence,rawNext,replaceScope,activeChordEdit.rawChord);
   await onSave(updated);
   setActiveChordEdit(null);
   setStatus(rawNext?`Updated [${activeChordEdit.displayedChord}] → [${nextDisplayedChord}]${replaceScope==='song'?' across song':replaceScope==='section'?' in section':''}.`:`Removed [${activeChordEdit.displayedChord}].`);
  }catch(e:any){setError(e.message)}finally{setSaving(false)}
 }
 async function applyChordNudge(row:ScoreRow,direction:-1|1){
  if(!activeChordEdit||saving)return;
  setSaving(true);setError('');
  try{
   const nudged=nudgeChordOccurrence(row.text,activeChordEdit.occurrence,direction);
   const updated=updateSectionLine(song,row.section,row.line,'chords',instrument,nudged);
   await onSave(updated);
   setStatus('Moved ['+activeChordEdit.displayedChord+'] '+(direction<0?'left':'right')+'.');
  }catch(e:any){setError(e.message)}finally{setSaving(false)}
 }
 async function applyLineEdit(){
  if(!activeLineEdit||saving)return;
  setSaving(true);setError('');
  try{
   const updated=updateSectionLine(song,activeLineEdit.section,activeLineEdit.line,view,instrument,activeLineEdit.text);
   await onSave(updated);
   setActiveLineEdit(null);
   setStatus('Line updated.');
  }catch(e:any){setError(e.message)}finally{setSaving(false)}
 }
 async function applySectionSplit(row:ScoreRow){
  if(!activeLineEdit||saving)return;
  setSaving(true);setError('');
  try{
   const updated=splitSectionAtLine(song,activeLineEdit.section,activeLineEdit.line,activeLineEdit.sectionName.trim()||undefined,row.at);
   await onSave(updated);
   setActiveLineEdit(null);
   setStatus('Split into a new section: '+(activeLineEdit.sectionName.trim()||'New section')+'.');
  }catch(e:any){setError(e.message)}finally{setSaving(false)}
 }
 const canAutoSplit=canEdit&&!draft&&song.sections.length===1&&rows.filter(r=>!r.heading).length>=4;
 const estimated=rows.some(r=>!r.heading&&r.estimated);
 return <>
  {timingToolsVisible&&canEdit&&!canTime&&<small className="follow-timing-note">To edit timing, leave the shared session and use solo practice.</small>}
  {timingToolsVisible&&canTime&&!draft&&<div className="chart-timing-entry"><button className="button primary" onClick={()=>openTiming('adjust')}>Adjust timing</button><button className="button subtle" onClick={()=>openTiming('tap')}>Tap to sync timing</button>{view!=='tabs'&&<button className="button subtle" disabled={!rows.some(row=>!row.heading)} onClick={()=>openTiming('record')}>Clear or re-record {view==='lyrics'?'lyric':'chart'} sync</button>}{canAutoSplit&&<button className="button subtle" disabled={saving} onClick={async()=>{setSaving(true);try{const split=autoSplitAnalyzedSections(song);await onSave(split);setStatus('Split song into '+split.sections.length+' sections.')}catch(e:any){setError(e.message)}finally{setSaving(false)}}}>Auto-split into sections</button>}<small>Choose a line and edit its start time, or mark it as the song plays.</small></div>}
  {!timingToolsVisible&&canEdit&&!draft&&<div className="chart-quick-hint"><small>Tip: Click any chord badge to change, move, or replace it across the song. Use Edit on any line to tweak lyrics or split sections.</small>{canAutoSplit&&<button type="button" className="button subtle" disabled={saving} onClick={async()=>{setSaving(true);try{const split=autoSplitAnalyzedSections(song);await onSave(split);setStatus('Split song into '+split.sections.length+' sections.')}catch(e:any){setError(e.message)}finally{setSaving(false)}}}>Auto-split into sections</button>}</div>}
  {draft&&<section className="chart-timing-controls" aria-label={recording?'Record line timing':'Manual chart timing'} ref={recordingControls} tabIndex={recording?-1:undefined}>
   <strong>{recording?'Record from scratch':adjusting?'Adjust timing':'Tap to sync'} · {formatTime(position)}</strong>
   <p>{recording?(recordingStarted?'Press Space when each line should appear, including the first. Save timing after you mark the last line.':'Start recording to replace the sync, or save the chart with its timestamps cleared. Both keep the chart text.'):adjusting?'Choose a row’s timestamp to adjust its start. Use Preview to listen from just before it. The chart stays in place.':'Play the song and tap each part when it starts, or use Mark next.'}</p>
   {!recording&&<label>{adjusting?'Adjust':'Mark'}<select aria-label="Timing targets" value={scope} disabled={saving} onChange={e=>setScope(e.target.value)}>{!usesRecordedLineTiming(song,view)&&<option value="sections">Section starts</option>}<option value="lines">{view==='tabs'?'Tab blocks':view==='lyrics'?'Lyric lines':'Chord lines'}</option></select></label>}
   {recording&&<p role="status">{passComplete?'All lines marked.':(next+1)+' of '+targets.length+' · '+nextRecordingText}</p>}
   <div className="timing-actions">
    {recording&&!recordingStarted&&<button type="button" className="button primary" disabled={saving} onClick={()=>void startRecording()}>Start recording</button>}
    {recording&&!recordingStarted&&<button type="button" className="button subtle" disabled={saving} onClick={()=>void save(true)}>Save cleared {view==='lyrics'?'lyric':'chart'} timing</button>}
    {recording&&recordingStarted&&!passComplete&&<button type="button" className="button primary" aria-keyshortcuts="Space" disabled={saving} onClick={markNext}>Mark next line</button>}
    {!recording&&!adjusting&&<button className="button primary" disabled={saving||!targets[next]} onClick={()=>targets[next]&&mark(targets[next])}>{targets[next]?'Mark next: '+(targets[next].heading?targets[next].text:view==='tabs'?'tab '+(targets[next].line+1):'line '+(targets[next].line+1))+(targets[next].heading?'':' · '+scoreSong.sections[targets[next].section].name):'End of list'}</button>}
    <button className="button subtle" disabled={saving||!history.length} onClick={undoTiming}>{adjusting?'Undo last change':'Undo last mark'}</button>
    {(!recording||recordingStarted)&&<button className="button primary" disabled={saving||!dirty||!!problems.length||recording&&!passComplete} onClick={()=>void save()}>{saving?'Saving…':'Save timing'}</button>}
    <button className="button subtle" disabled={saving} onClick={cancel}>Cancel</button>
   </div>
   {!adjusting&&scope==='sections'&&<div className="timing-section-targets">{targets.map(row=><button className="button subtle" key={row.key} disabled={saving} onClick={()=>mark(row)}>Mark {row.text} now{scoreSong.sections[row.section].start!==undefined?' · '+scoreSong.sections[row.section].start!.toFixed(2)+'s':''}</button>)}</div>}
   {!targets.length&&<small>Add content in Edit charts &amp; tabs first.</small>}
   {!!problems.length&&<p className="stem-error" role="alert">{problems.join(' ')}</p>}
  </section>}
  {status&&<p className="follow-timing-note" role="status">{status}</p>}
  {!draft&&(browsing||!following)&&<div className="follow-timing-note">Browsing the full song. {canEdit?'Use Play from here to seek.':''}<button className="button subtle" onClick={()=>{onFollow();setBrowsing(false)}}>Return to current line</button></div>}
  {timingToolsVisible&&!draft&&estimated&&<small className="follow-timing-note">Automatic timing uses matched timestamps where available. Other line and tab positions are estimated.</small>}
  {error&&<p role="alert">{error}</p>}
  <div className={'follow-score-scroll'+(view==='tabs'?' tab-score-view':'')+(draft?' marking-timing':'')} ref={container} style={{fontSize:view==='tabs'?'calc(20px * var(--tab-text-scale,1))':'calc(27px * var(--chart-text-scale,1))'}} onWheel={()=>setBrowsing(true)} onTouchMove={()=>setBrowsing(true)}>{rows.map((row,i)=>{
   const actionable=!!draft&&(scope==='sections'?!!row.heading:!row.heading);
   const tapTarget=actionable&&!adjusting&&!recording;
   const nextRecordingLine=recording&&targets[next]?.key===row.key;
   const part=row.heading?row.text:(row.tab?'tab block ':'line ')+(row.line+1)+' in '+scoreSong.sections[row.section].name;
   const label='Start '+(row.heading?row.text:'line')+' at '+formatTime(row.at??0);
   const selectedTime=adjusting&&actionable&&adjustment?.rowKey===row.key?adjustment:null;
   const chordPopoverOpen=canEdit&&!draft&&activeChordEdit?.rowKey===row.key;
   const lineEditorOpen=canEdit&&!draft&&activeLineEdit?.rowKey===row.key;
   return <div key={row.key} data-section={row.section} data-next-recording-line={nextRecordingLine?true:undefined} data-heading={row.heading?'true':'false'} data-current={active===i?'true':'false'} className={'follow-score-row '+(active===i?'current-line':'')+(row.heading?' score-section-title':'')+((tapTarget&&targets[next]?.key===row.key)||selectedTime||nextRecordingLine?' next-timing-target':'')} role={tapTarget?'button':undefined} tabIndex={tapTarget?0:undefined} aria-label={tapTarget?'Mark '+part+' now':undefined} title={tapTarget?'Tap when you hear this part':undefined} onClick={tapTarget?()=>mark(row):undefined} onDoubleClick={e=>{if(canEdit&&!draft&&!row.heading){e.stopPropagation();setActiveChordEdit(null);setActiveLineEdit({rowKey:row.key,section:row.section,line:row.line,text:row.text,sectionName:'Section '+(song.sections.length+1)})}}} onKeyDown={e=>{if(e.target===e.currentTarget&&tapTarget&&['Enter',' '].includes(e.key)){e.preventDefault();mark(row)}}}>
    {adjusting&&actionable?<button type="button" className="button subtle timing-time-button" aria-expanded={!!selectedTime} aria-label={'Adjust '+part} disabled={saving} onClick={()=>setAdjustment(selectedTime?null:{rowKey:row.key,seconds:(row.at??0).toFixed(3)})}>{(row.at??0).toFixed(2)}s{row.estimated?' · Estimated':''}</button>:draft&&<small className="timing-row-time">{row.manual?'Marked · ':row.estimated?'Estimated · ':''}{recording&&row.at===undefined?'':(row.at??0).toFixed(2)+'s'}</small>}
    <div className="follow-row-main">{canEdit&&!draft&&<button className="button subtle" aria-label={label} onClick={()=>void start(row.at||0)}>Play from here</button>}
     <div className="follow-row-content">
      {row.heading?<h4>{row.text}</h4>:row.tab?<pre className="tab-score" style={{fontSize:'calc(15px * var(--tab-text-scale,1))'}}>{row.text}</pre>:view==='lyrics'?<div className="lyric-line">{lyricsOnly(row.text)}</div>:<ChordLine line={row.text} transposeBy={transposeBy} showChords={showChords} showLyrics={showLyrics} selectedOccurrence={chordPopoverOpen?activeChordEdit?.occurrence:undefined} onSelectChord={canEdit&&!draft?(occ,raw,disp)=>{setActiveLineEdit(null);setActiveChordEdit(prev=>prev?.rowKey===row.key&&prev.occurrence===occ?null:{rowKey:row.key,section:row.section,line:row.line,occurrence:occ,rawChord:raw,displayedChord:disp,custom:disp});}:undefined}/>}
     </div>
     {canEdit&&!draft&&!row.heading&&<button type="button" className="row-inline-edit-btn" aria-label={'Edit '+(row.tab?'tab block':'line '+(row.line+1))} onClick={e=>{e.stopPropagation();setActiveChordEdit(null);setActiveLineEdit(prev=>prev?.rowKey===row.key?null:{rowKey:row.key,section:row.section,line:row.line,text:row.text,sectionName:'Section '+(song.sections.length+1)})}}>Edit</button>}
    </div>
    {selectedTime&&<form className="timing-line-editor" aria-label={'Start time for '+part} onSubmit={event=>{event.preventDefault();mark(row,Number(selectedTime.seconds))}}>
     <label>Start time (seconds)<input type="number" min="0" step=".001" required value={selectedTime.seconds} disabled={saving} onChange={event=>setAdjustment({...selectedTime,seconds:event.target.value})}/></label>
     <button type="submit" className="button subtle" disabled={saving}>Set time</button>
     <button type="button" className="button subtle" disabled={saving||(row.at??0)<=0} onClick={()=>mark(row,Math.max(0,(row.at??0)-.1))}>−0.1s</button>
     <button type="button" className="button subtle" disabled={saving||(row.at??0)+.1>=song.duration} onClick={()=>mark(row,(row.at??0)+.1)}>+0.1s</button>
     <button type="button" className="button subtle" disabled={saving} onClick={()=>mark(row)}>Use playhead</button>
     <button type="button" className="button subtle" disabled={saving} onClick={()=>void start(Math.max(0,(row.at??0)-2))}>Preview</button>
    </form>}
    {chordPopoverOpen&&activeChordEdit&&<div className="chord-quick-popover" onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
     <div className="chord-popover-header">
      <strong>Edit chord [{activeChordEdit.displayedChord}]</strong>
      <div className="chord-nudge-group">
       <button type="button" className="button subtle" disabled={saving} onClick={()=>void applyChordNudge(row,-1)}>← Word</button>
       <button type="button" className="button subtle" disabled={saving} onClick={()=>void applyChordNudge(row,1)}>Word →</button>
       <button type="button" className="button subtle" disabled={saving} onClick={()=>void applyChordChange(null,'one')}>Remove</button>
       <button type="button" className="button subtle" onClick={()=>setActiveChordEdit(null)}>Close</button>
      </div>
     </div>
     <div className="chord-pill-row">
      <small>In key ({song.key||'C'}):</small>
      {diatonic.map(ch=><button type="button" key={ch} className={'chord-pill'+(ch===activeChordEdit.displayedChord?' active':'')} disabled={saving} onClick={()=>void applyChordChange(ch,'one')}>{ch}</button>)}
     </div>
     <div className="chord-pill-row">
      <small>Voicings:</small>
      {chordQualitiesFor(activeChordEdit.displayedChord).map(ch=><button type="button" key={ch} className={'chord-pill'+(ch===activeChordEdit.displayedChord?' active':'')} disabled={saving} onClick={()=>void applyChordChange(ch,'one')}>{ch}</button>)}
     </div>
     <div className="chord-custom-row">
      <input aria-label="Custom chord symbol" value={activeChordEdit.custom} onChange={e=>setActiveChordEdit({...activeChordEdit,custom:e.target.value})} placeholder="e.g. Bm7 or D/F#"/>
      <button type="button" className="button primary" disabled={saving||!activeChordEdit.custom.trim()} onClick={()=>void applyChordChange(activeChordEdit.custom,'one')}>Apply here</button>
      <button type="button" className="button subtle" disabled={saving||!activeChordEdit.custom.trim()} onClick={()=>void applyChordChange(activeChordEdit.custom,'section')}>Replace all [{activeChordEdit.displayedChord}] in section</button>
      <button type="button" className="button subtle" disabled={saving||!activeChordEdit.custom.trim()} onClick={()=>void applyChordChange(activeChordEdit.custom,'song')}>Replace all [{activeChordEdit.displayedChord}] in song</button>
     </div>
    </div>}
    {lineEditorOpen&&activeLineEdit&&<div className="line-inline-editor" onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
     <label>{row.tab?instrument+' tab block':'Edit line (put chords in [brackets] before words)'}
      {row.tab?<textarea rows={6} className="tab-input" value={activeLineEdit.text} onChange={e=>setActiveLineEdit({...activeLineEdit,text:e.target.value})}/>:<input value={activeLineEdit.text} onChange={e=>setActiveLineEdit({...activeLineEdit,text:e.target.value})}/>}
     </label>
     <div className="line-inline-actions">
      <button type="button" className="button primary" disabled={saving} onClick={()=>void applyLineEdit()}>Save line</button>
      {!row.tab&&row.line>0&&<div className="split-section-inline"><input aria-label="New section name" value={activeLineEdit.sectionName} onChange={e=>setActiveLineEdit({...activeLineEdit,sectionName:e.target.value})} placeholder="Chorus"/><button type="button" className="button subtle" disabled={saving} onClick={()=>void applySectionSplit(row)}>Split new section here</button></div>}
      <button type="button" className="button subtle" onClick={()=>setActiveLineEdit(null)}>Cancel</button>
     </div>
    </div>}
   </div>
  })}{view==='tabs'&&!rows.some(r=>r.tab)&&<p>No {instrument.toLowerCase()} tab has been added for this song.</p>}</div>
 </>;
}
