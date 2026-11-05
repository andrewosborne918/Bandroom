'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import type {Song} from '../lib/types';
import type {ScoreRow} from '../lib/chart-follow';
import {automaticScore,activeFollowRow} from '../lib/chart-follow';
import {stampChartTime,chartTimingProblems} from '../lib/manual-chart-timing';
import {lyricsOnly} from '../lib/song-charts';
import {formatTime,transpose} from '../lib/timeline';
import {diatonicChordsForKey,chordQualitiesFor,nudgeChordOccurrence,replaceChordInSong,updateSectionLine,splitSectionAtLine,autoSplitAnalyzedSections} from '../lib/chart-edit';
import ChordLine from './chord-line';
export default function FollowScore({song,sectionIndex,view,instrument,position,following,fontSize,transposeBy,showChords,showLyrics,canEdit,canTime,timingToolsVisible=true,onSave,onStart,onFollow,followReset,readPosition,onDirtyChange,timingReset}:{song:Song;sectionIndex:number;view:string;instrument:string;position:number;following:boolean;fontSize:number;transposeBy:number;showChords:boolean;showLyrics:boolean;canEdit:boolean;canTime:boolean;timingToolsVisible?:boolean;onSave:(song:Song)=>Promise<void>;onStart:(at:number)=>Promise<void>;onFollow:()=>void;followReset:number;readPosition:()=>number;onDirtyChange:(dirty:boolean)=>void;timingReset:number}){
 const [draft,setDraft]=useState<Song|null>(null),[history,setHistory]=useState<Song[]>([]),[scope,setScope]=useState('sections'),[next,setNext]=useState(0),[saving,setSaving]=useState(false),[status,setStatus]=useState('');
 const [activeChordEdit,setActiveChordEdit]=useState<{rowKey:string;section:number;line:number;occurrence:number;rawChord:string;displayedChord:string;custom:string}|null>(null);
 const [activeLineEdit,setActiveLineEdit]=useState<{rowKey:string;section:number;line:number;text:string;sectionName:string}|null>(null);
 const scoreSong=draft||song,rows=useMemo(()=>automaticScore(scoreSong,view,instrument),[scoreSong,view,instrument]),active=activeFollowRow(rows,position),container=useRef<HTMLDivElement>(null),[browsing,setBrowsing]=useState(false),[error,setError]=useState('');
 const targets=useMemo(()=>rows.filter(r=>scope==='sections'?r.heading:!r.heading),[rows,scope]);
 const starting=useRef(false),lastSection=useRef(sectionIndex);
 const dirty=history.length>0;
 const diatonic=useMemo(()=>diatonicChordsForKey(song.key),[song.key]);
 useEffect(()=>{onDirtyChange(dirty)},[dirty,onDirtyChange]);
 useEffect(()=>{setDraft(null);setHistory([]);setStatus('');setError('');setNext(0);setActiveChordEdit(null);setActiveLineEdit(null)},[song.id,timingReset]);
 useEffect(()=>{setNext(0);setActiveChordEdit(null);setActiveLineEdit(null)},[view,instrument,scope]);
 useEffect(()=>{if(!following||browsing||draft||activeChordEdit||activeLineEdit)return;const box=container.current,row=box?.querySelector<HTMLElement>('[data-current="true"]');if(box&&row){const top=row.getBoundingClientRect().top-box.getBoundingClientRect().top+box.scrollTop-box.clientHeight*.28;box.scrollTo({top:Math.max(0,top),behavior:'smooth'})}},[active,following,browsing,view,draft,activeChordEdit,activeLineEdit]);
 useEffect(()=>{if(!following&&lastSection.current!==sectionIndex&&!draft){const box=container.current,row=box?.querySelector<HTMLElement>('[data-section="'+sectionIndex+'"][data-heading="true"]');if(box&&row)box.scrollTo({top:row.getBoundingClientRect().top-box.getBoundingClientRect().top+box.scrollTop,behavior:'smooth'});setBrowsing(true)}lastSection.current=sectionIndex;},[sectionIndex,following,draft]);
 useEffect(()=>{if(following)setBrowsing(false)},[following,song.id,followReset]);
 useEffect(()=>{if(!dirty)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[dirty]);
 async function start(at:number){if(starting.current)return;starting.current=true;setError('');try{await onStart(at);setBrowsing(false)}catch(e:any){setError(e.message)}finally{starting.current=false}}
 function mark(row:ScoreRow){
  if(!draft||saving)return;
  try{const at=readPosition(),updated=stampChartTime(draft,row,view,instrument,at);setHistory(previous=>[...previous.slice(-49),draft]);setDraft(updated);setNext(Math.min(targets.length,targets.findIndex(r=>r.key===row.key)+1));setError('');setStatus((row.heading?row.text:view==='tabs'?instrument+' tab block':'Line '+(row.line+1))+' marked at '+at.toFixed(2)+'s.');}
  catch(e:any){setError(e.message)}
 }
 function cancel(){if(dirty&&!window.confirm('Discard your unsaved timing marks?'))return;setDraft(null);setHistory([]);setStatus('Timing pass canceled. Saved timing is unchanged.');setError('')}
 const problems=useMemo(()=>draft?chartTimingProblems(draft):[],[draft]);
 async function save(){
  if(!draft||!dirty||saving)return;
  if(song.revision!==draft.revision){setError('This song changed on another device. Your timing marks are still here; reload the song before applying them to the changed chart.');return;}
  if(problems.length){setError(problems.join(' '));return;}
  setSaving(true);setError('');try{await onSave({...song,sections:draft.sections,revision:draft.revision});setDraft(null);setHistory([]);setStatus('Timing saved. Follow now uses your marked times.');onFollow();setBrowsing(false)}catch(e:any){setError(e.message)}finally{setSaving(false)}
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
  {timingToolsVisible&&canTime&&!draft&&<div className="chart-timing-entry"><button className="button subtle" onClick={()=>{setDraft(structuredClone(song));setHistory([]);setNext(0);setStatus('');setError('');setBrowsing(true)}}>Tap to sync timing</button>{canAutoSplit&&<button className="button subtle" disabled={saving} onClick={async()=>{setSaving(true);try{const split=autoSplitAnalyzedSections(song);await onSave(split);setStatus('Split song into '+split.sections.length+' sections.')}catch(e:any){setError(e.message)}finally{setSaving(false)}}}>Auto-split into sections</button>}<small>Listen and mark when sections, chord lines or tab blocks should appear.</small></div>}
  {!timingToolsVisible&&canEdit&&!draft&&<div className="chart-quick-hint"><small>Tip: Click any chord badge to change, move, or replace it across the song. Use Edit on any line to tweak lyrics or split sections.</small>{canAutoSplit&&<button type="button" className="button subtle" disabled={saving} onClick={async()=>{setSaving(true);try{const split=autoSplitAnalyzedSections(song);await onSave(split);setStatus('Split song into '+split.sections.length+' sections.')}catch(e:any){setError(e.message)}finally{setSaving(false)}}}>Auto-split into sections</button>}</div>}
  {draft&&<section className="chart-timing-controls" aria-label="Manual chart timing">
   <strong>Timing mode · {formatTime(position)}</strong><p>Play the song below. Tap a part at the moment you hear it, or use Mark next. Tapping here records timing and does not restart playback.</p>
   <label>Mark<select aria-label="Timing targets" value={scope} disabled={saving} onChange={e=>setScope(e.target.value)}><option value="sections">Section starts</option><option value="lines">{view==='tabs'?'Tab blocks':view==='lyrics'?'Lyric lines':'Chord lines'}</option></select></label>
   <div className="timing-actions"><button className="button primary" disabled={saving||!targets[next]} onClick={()=>targets[next]&&mark(targets[next])}>{targets[next]?'Mark next: '+(targets[next].heading?targets[next].text:view==='tabs'?'tab '+(targets[next].line+1):'line '+(targets[next].line+1))+(targets[next].heading?'':' · '+scoreSong.sections[targets[next].section].name):'End of list'}</button><button className="button subtle" disabled={saving||!history.length} onClick={()=>{const previous=history[history.length-1];setDraft(previous);setHistory(history.slice(0,-1));setNext(Math.max(0,next-1));setError('');setStatus('Last mark undone.')}}>Undo last mark</button><button className="button primary" disabled={saving||!dirty||!!problems.length} onClick={()=>void save()}>{saving?'Saving…':'Save timing'}</button><button className="button subtle" disabled={saving} onClick={cancel}>Cancel</button></div>
   {scope==='sections'&&<div className="timing-section-targets">{targets.map(row=><button className="button subtle" key={row.key} disabled={saving} onClick={()=>mark(row)}>Mark {row.text} now{scoreSong.sections[row.section].start!==undefined?' · '+scoreSong.sections[row.section].start!.toFixed(2)+'s':''}</button>)}</div>}
   {scope!=='sections'&&<p>Tap the {view==='tabs'?'tab block':'line'} below when it starts. {targets.length?'':'Add content in Edit charts & tabs first.'}</p>}
   <small>Repeated parts need separate sections, such as Verse 1 and Verse 2. Your marks stay unsaved until Save timing. Retap affected lines after changing chart text.</small>
   {!!problems.length&&<p className="stem-error" role="alert">{problems.join(' ')}</p>}
  </section>}
  {status&&<p className="follow-timing-note" role="status">{status}</p>}
  {!draft&&(browsing||!following)&&<div className="follow-timing-note">Browsing the full song. {canEdit?'Click a line to start there.':''}<button className="button subtle" onClick={()=>{onFollow();setBrowsing(false)}}>Return to current line</button></div>}
  {timingToolsVisible&&!draft&&estimated&&<small className="follow-timing-note">Automatic timing uses matched timestamps where available. Other line and tab positions are estimated.</small>}
  {error&&<p role="alert">{error}</p>}
  <div className={'follow-score-scroll'+(draft?' marking-timing':'')} ref={container} style={{fontSize}} onWheel={()=>setBrowsing(true)} onTouchMove={()=>setBrowsing(true)}>{rows.map((row,i)=>{
   const actionable=!!draft?(scope==='sections'?!!row.heading:!row.heading):canEdit;
   const label=draft?'Mark '+(row.heading?row.text:row.tab?'tab block '+(row.line+1)+' in '+scoreSong.sections[row.section].name:'line '+(row.line+1)+' in '+scoreSong.sections[row.section].name)+' now':'Start '+(row.heading?row.text:'line')+' at '+formatTime(row.at||0);
   const click=()=>{if(!actionable||activeChordEdit?.rowKey===row.key||activeLineEdit?.rowKey===row.key)return;if(draft)mark(row);else void start(row.at||0)};
   const chordPopoverOpen=canEdit&&!draft&&activeChordEdit?.rowKey===row.key;
   const lineEditorOpen=canEdit&&!draft&&activeLineEdit?.rowKey===row.key;
   return <div key={row.key} data-section={row.section} data-heading={row.heading?'true':'false'} data-current={active===i?'true':'false'} className={'follow-score-row '+(active===i?'current-line':'')+(row.heading?' score-section-title':'')+(draft&&targets[next]?.key===row.key?' next-timing-target':'')} role={actionable?'button':undefined} tabIndex={actionable?0:undefined} aria-label={actionable?label:undefined} title={actionable?(draft?'Tap when you hear this part':'Click to start here'+(row.estimated?' (estimated timing)':'')):undefined} onClick={click} onDoubleClick={e=>{if(canEdit&&!draft&&!row.heading){e.stopPropagation();setActiveChordEdit(null);setActiveLineEdit({rowKey:row.key,section:row.section,line:row.line,text:row.text,sectionName:'Section '+(song.sections.length+1)})}}} onKeyDown={e=>{if(actionable&&!chordPopoverOpen&&!lineEditorOpen&&['Enter',' '].includes(e.key)){e.preventDefault();click()}}}>
    {draft&&<small className="timing-row-time">{row.manual?'Marked · ':row.estimated?'Estimated · ':''}{(row.at||0).toFixed(2)}s</small>}
    <div className="follow-row-main">
     <div className="follow-row-content">
      {row.heading?<h4>{row.text}</h4>:row.tab?<pre className="tab-score" style={{fontSize:Math.max(14,fontSize-8)}}>{row.text}</pre>:view==='lyrics'?<div className="lyric-line">{lyricsOnly(row.text)}</div>:<ChordLine line={row.text} transposeBy={transposeBy} showChords={showChords} showLyrics={showLyrics} selectedOccurrence={chordPopoverOpen?activeChordEdit?.occurrence:undefined} onSelectChord={canEdit&&!draft?(occ,raw,disp)=>{setActiveLineEdit(null);setActiveChordEdit(prev=>prev?.rowKey===row.key&&prev.occurrence===occ?null:{rowKey:row.key,section:row.section,line:row.line,occurrence:occ,rawChord:raw,displayedChord:disp,custom:disp});}:undefined}/>}
     </div>
     {canEdit&&!draft&&!row.heading&&<button type="button" className="row-inline-edit-btn" aria-label={'Edit '+(row.tab?'tab block':'line '+(row.line+1))} onClick={e=>{e.stopPropagation();setActiveChordEdit(null);setActiveLineEdit(prev=>prev?.rowKey===row.key?null:{rowKey:row.key,section:row.section,line:row.line,text:row.text,sectionName:'Section '+(song.sections.length+1)})}}>Edit</button>}
    </div>
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
