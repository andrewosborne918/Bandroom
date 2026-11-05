'use client';
import {processingReadiness} from '../../lib/processing-readiness';
import {useState,useEffect,type ReactNode} from 'react';
import {Plus,Check,Music2,ArrowUp,ArrowDown,X} from 'lucide-react';
import {formatTime} from '../../lib/timeline';
import type {Song} from '../../lib/types';
import {GuitarTuningBadge} from '../guitar-tuning';
export type CatalogSong={id:string;title:string;artist:string;bpm:number;key:string;duration:number;stemCount:number;reviewed:boolean;processingStatus?:string};
export type SavedSet={id:string;name:string;revision:number;ids:string[];isDefault?:boolean};
export default function LibraryWorkspace({processingNotice,localSearch=false,canChoose=true,songs,setSongs,selected,setIds,sets,activeSet,canEdit,hasMore,busy,onSearch,onMore,onChoose,onEdit,onDelete,onMove,onAdd,onToggle,onSet,onCreate,onRename}:{processingNotice?:ReactNode;localSearch?:boolean;canChoose?:boolean;songs:CatalogSong[];setSongs:Song[];selected?:string;setIds:string[];sets:SavedSet[];activeSet:string;canEdit:boolean;hasMore:boolean;busy:boolean;onSearch:(query:string)=>void;onMore:()=>void;onChoose:(s:CatalogSong)=>void;onEdit:(s:CatalogSong)=>void;onDelete:(s:CatalogSong)=>void;onMove:(index:number,delta:number)=>void;onAdd:()=>void;onToggle:(id:string)=>void;onSet:(id:string)=>void;onCreate:(name:string)=>Promise<void>;onRename:(name:string)=>Promise<void>}){
 const [query,setQuery]=useState(''),[draft,setDraft]=useState(''),[error,setError]=useState(''),[tab,setTab]=useState<'songs'|'setlist'>('songs');
 useEffect(()=>{if(localSearch)return;const timer=setTimeout(()=>onSearch(query),300);return()=>clearTimeout(timer)},[query,localSearch]);
 async function save(rename=false){setError('');try{await (rename?onRename(draft):onCreate(draft));setDraft('')}catch(e:any){setError(e.message)}}
 return <section className="library-workspace" aria-label="Song library">
  <div className="workspace-heading"><div><h1>Library</h1><p>Your songs, ready for rehearsal.</p></div>{canEdit&&<button className="button primary" onClick={onAdd}><Plus size={18}/> Add song</button>}</div>
  {processingNotice}
  <nav className="tool-tabs" aria-label="Library view"><button aria-current={tab==='songs'?'page':undefined} onClick={()=>setTab('songs')}>Songs</button><button aria-current={tab==='setlist'?'page':undefined} onClick={()=>setTab('setlist')}>Setlist <span>{setIds.length}</span></button></nav>
  {tab==='songs'?<>
   <div className="library-tools"><label className="library-search"><span className="sr-only">Search songs</span><input type="search" placeholder="Search songs or artists…" value={query} onChange={e=>setQuery(e.target.value)}/></label><span>{songs.length} songs{hasMore?' loaded':''}</span></div>
   <div className="song-list">{songs.filter(s=>!localSearch||(s.title+' '+s.artist).toLowerCase().includes(query.toLowerCase())).map(s=><article className={'song-row '+(selected===s.id?'selected':'')} key={s.id}>
    <button className="song-row-title" onClick={()=>onChoose(s)} disabled={busy||!canChoose}><strong>{s.title}</strong><small>{s.artist||'Your band arrangement'} <span>· {formatTime(s.duration)}</span></small>{(!s.stemCount||['queued','processing','failed','expired'].includes(s.processingStatus||''))&&<small className="mobile-song-state">{processingReadiness(s.processingStatus,s.stemCount,s.reviewed)}</small>}</button>
    <span className="song-row-status">{processingReadiness(s.processingStatus,s.stemCount,s.reviewed)}</span>
    {canEdit&&<button className={'button subtle set-toggle '+(setIds.includes(s.id)?'in-set':'')} aria-label={(setIds.includes(s.id)?'Remove ':'Add ')+s.title+(setIds.includes(s.id)?' from setlist':' to setlist')} aria-pressed={setIds.includes(s.id)} disabled={busy} onClick={()=>onToggle(s.id)}>{setIds.includes(s.id)?<Check size={15}/>:<Plus size={15}/>} Set</button>}
    <details className="song-menu"><summary aria-label={'Actions for '+s.title}>•••</summary><div><button disabled={busy||!canChoose} onClick={e=>{e.currentTarget.closest('details')!.open=false;onChoose(s)}}>Open song</button>{canEdit&&<><button onClick={e=>{e.currentTarget.closest('details')!.open=false;onEdit(s)}}>Edit song</button><button className="delete-song" disabled={busy} onClick={e=>{e.currentTarget.closest('details')!.open=false;onDelete(s)}}>Delete song</button></>}</div></details>
   </article>)}</div>
   {!songs.length&&<div className="library-no-results"><Music2 size={28}/><h3>{query?'No matching songs':'Add your first song'}</h3><p>{query?'Try another title or artist.':'Upload a recording to get started.'}</p></div>}
   {hasMore&&<button className="button subtle load-more" disabled={busy} onClick={onMore}>Load more songs</button>}
  </>:<>
   <div className="setlist-toolbar"><label>Setlist<select value={activeSet} disabled={busy} onChange={e=>onSet(e.target.value)}>{sets.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}{!sets.length&&<option value="">Rehearsal set</option>}</select></label><span>{setIds.length} songs · {formatTime(setSongs.reduce((sum,s)=>sum+s.duration,0))}</span></div>
   {canEdit&&<details className="workspace-tool"><summary>New or rename setlist</summary><div className="set-name-tools"><input aria-label="Setlist name" placeholder="Setlist name" maxLength={80} value={draft} onChange={e=>setDraft(e.target.value)}/><button className="button subtle" disabled={busy||!draft.trim()} onClick={()=>void save()}>New set</button><button className="button subtle" disabled={busy||!draft.trim()||!activeSet} onClick={()=>void save(true)}>Rename</button></div></details>}
   {error&&<p role="alert">{error}</p>}
   <div className="song-list">{setSongs.map((s,i)=><article className="song-row setlist-row" key={s.id}><span className="song-index">{i+1}</span><button className="song-row-title" disabled={busy||!canChoose} onClick={()=>onChoose({...s,stemCount:s.stems.length,reviewed:!!s.info?.playbackConfirmed})}><strong>{s.title}</strong><small>{s.artist}</small><GuitarTuningBadge song={s} compact/></button>{canEdit&&<div className="setlist-order"><button className="icon-button" aria-label={'Move '+s.title+' up'} disabled={busy||i===0} onClick={()=>onMove(i,-1)}><ArrowUp size={16}/></button><button className="icon-button" aria-label={'Move '+s.title+' down'} disabled={busy||i===setSongs.length-1} onClick={()=>onMove(i,1)}><ArrowDown size={16}/></button><button className="icon-button" aria-label={'Remove '+s.title+' from setlist'} disabled={busy} onClick={()=>onToggle(s.id)}><X size={16}/></button></div>}</article>)}</div>
   {!setIds.length&&<div className="library-no-results"><h3>Your setlist is empty</h3><p>Use + Set beside any song to add it here.</p><button className="button subtle" onClick={()=>setTab('songs')}>Choose songs</button></div>}
  </>}
 </section>;
}
