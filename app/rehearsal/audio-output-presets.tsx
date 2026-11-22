'use client';
import './audio-output-presets.css';

export type AudioOutputPreset='performance'|'practice'|'no-click';
export default function AudioOutputPresets({value,routingLocked,clickAvailable=true,onChange}:{value:AudioOutputPreset|null;routingLocked:boolean;clickAvailable?:boolean;onChange:(preset:AudioOutputPreset)=>void}){
 return <section className="audio-output-presets" aria-label="Audio output presets">
  <div className="audio-preset-buttons" role="group" aria-label="Choose audio output">
   <button type="button" aria-pressed={value==='performance'} disabled={routingLocked||!clickAvailable} onClick={()=>onChange('performance')}><strong>Split output</strong><small>Music left · click and cues right</small></button>
   <button type="button" aria-pressed={value==='practice'} disabled={routingLocked||!clickAvailable} onClick={()=>onChange('practice')}><strong>Mono output</strong><small>Music + click on both sides</small></button>
   <button type="button" aria-pressed={value==='no-click'} onClick={()=>onChange('no-click')}><strong>Click off</strong><small>Music · cues unchanged</small></button>
  </div>
  {routingLocked&&<small>Stop playback to change split or mono routing. You can turn click off now.</small>}
  {!clickAvailable&&<small>Confirm the song’s timing before enabling click.</small>}
 </section>;
}
