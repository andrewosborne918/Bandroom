'use client';
import {useState} from 'react';
import type {SongClickStop} from '../../lib/song-info';

type Mode='whole-song'|SongClickStop['mode'];

export default function SongClickDuration({title,duration,value,disabled,onSave}:{
 title:string;
 duration:number;
 value:SongClickStop|undefined;
 disabled:boolean;
 onSave:(value:SongClickStop|undefined)=>void;
}){
 const [mode,setMode]=useState<Mode>(value?.mode??'whole-song');
 const [bars,setBars]=useState(value?.mode==='bars'?String(value.value):'4');
 const [seconds,setSeconds]=useState(value?.mode==='seconds'?String(value.value):String(Math.min(10,Math.floor(duration*100)/100)));
 return <form onSubmit={event=>{
  event.preventDefault();
  if(mode==='whole-song')onSave(undefined);
  else if(mode==='count-in')onSave({mode});
  else onSave({mode,value:Number(mode==='bars'?bars:seconds)});
 }}>
  <p className="modal-intro">{title} · Applies when Click is on.</p>
  <div className="form-grid">
   <label className="span2">Click duration<select value={mode} disabled={disabled} onChange={event=>setMode(event.target.value as Mode)}>
    <option value="whole-song">Whole song</option>
    <option value="count-in">Count-in only</option>
    <option value="bars">Stop after a number of measures</option>
    <option value="seconds">Stop at a song time</option>
   </select></label>
   {mode==='bars'&&<label className="span2">Measures from the first beat<input type="number" min="1" max="36000" step="1" required value={bars} disabled={disabled} onChange={event=>setBars(event.target.value)}/></label>}
   {mode==='seconds'&&<label className="span2">Seconds from the start of the song<input type="number" min=".01" max={duration} step=".01" required value={seconds} disabled={disabled} onChange={event=>setSeconds(event.target.value)}/></label>}
  </div>
  <button type="submit" className="button primary full" disabled={disabled}>Save click duration</button>
 </form>;
}
