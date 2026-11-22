'use client';
import './global-track-filter.css';
import {Drum,Guitar,Mic2,Music2,Piano,RotateCcw,SlidersHorizontal,VolumeX} from 'lucide-react';
import {
 EMPTY_GLOBAL_TRACK_MIX,
 GLOBAL_TRACK_GROUPS,
 globalTrackSummary,
 hasGlobalTrackFilter,
 isGlobalGroupAudible,
 soloGlobalTrack,
 toggleGlobalTrack,
 type GlobalTrackGroup,
 type GlobalTrackMix,
} from '../../lib/band-practice';

const iconFor=(id:GlobalTrackGroup)=>
 id==='drums'?Drum:id==='keyboards'?Piano:id==='vocals'?Mic2:id==='other'?Music2:Guitar;

export default function GlobalTrackFilter({value,onChange}:{value:GlobalTrackMix;onChange:(next:GlobalTrackMix)=>void}){
 const active=hasGlobalTrackFilter(value);
 const summary=globalTrackSummary(value);
 return <section className={'global-track-filter'+(active?' active':'')} aria-label="Overall track mutes">
  <div className="global-track-header">
   <div className="global-track-title">
    <SlidersHorizontal size={15} aria-hidden="true"/>
    <strong>Tracks across all songs</strong>
    <span className="global-track-badge" role="status">{summary}</span>
   </div>
   {active&&<button type="button" className="button subtle global-track-reset" onClick={()=>onChange(EMPTY_GLOBAL_TRACK_MIX)}><RotateCcw size={13}/> All on</button>}
  </div>
  <div className="global-track-grid" role="group" aria-label="Mute or solo tracks on every song">
   {GLOBAL_TRACK_GROUPS.map(group=>{
    const audible=isGlobalGroupAudible(value,group.id);
    const soloed=value.solo.includes(group.id);
    const Icon=iconFor(group.id);
    return <div className="global-track-pill" key={group.id} data-audible={audible} data-solo={soloed}>
     <button
      type="button"
      className="global-track-toggle"
      aria-pressed={!audible}
      aria-label={(audible?'Mute ':'Unmute ')+group.label+' on every song'}
      title={(audible?'Mute ':'Unmute ')+group.label+' across all songs'}
      onClick={()=>onChange(toggleGlobalTrack(value,group.id))}
     >
      {audible?<Icon size={14} aria-hidden="true"/>:<VolumeX size={14} aria-hidden="true"/>}
      <span>{group.label}</span>
     </button>
     <button
      type="button"
      className="global-track-only"
      aria-pressed={soloed}
      aria-label={soloed&&value.solo.length===1?'Stop soloing '+group.label:'Play only '+group.label+' on every song'}
      title={soloed&&value.solo.length===1?'Restore all tracks':'Play only '+group.label+' across all songs'}
      onClick={()=>onChange(soloGlobalTrack(value,group.id))}
     >
      Only
     </button>
    </div>;
   })}
  </div>
  <small className="global-track-hint">Tap an instrument to mute it on every song, or tap Only to isolate it. Click and cues stay unaffected.</small>
 </section>;
}
