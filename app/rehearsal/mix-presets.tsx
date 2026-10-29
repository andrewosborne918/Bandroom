'use client';
import {useState} from 'react';
import type {Song} from '../../lib/types';
import {applyPreset,capturePreset} from '../../lib/rehearsal';
export default function MixPresets({song,disabled,onSave}:{song:Song;disabled:boolean;onSave:(song:Song)=>Promise<void>}){
 const [name,setName]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function run(value:Song){setBusy(true);setError('');try{await onSave(value);setName('')}catch(e:any){setError(e.message)}finally{setBusy(false)}}
 return <div className="mix-presets"><label>Arrangement preset<select aria-label="Arrangement preset" value="" disabled={disabled||busy} onChange={e=>{const p=song.presets?.find(p=>p.id===e.target.value);if(p)void run(applyPreset(song,p))}}><option value="">Choose a saved mix…</option>{song.presets?.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><div><input aria-label="New arrangement name" maxLength={60} value={name} placeholder="e.g. No drummer" disabled={disabled||busy} onChange={e=>setName(e.target.value)}/><button className="button subtle" disabled={disabled||busy||!name.trim()||(song.presets?.length||0)>=20} onClick={()=>void run({...song,presets:[...(song.presets||[]),capturePreset(song,name)]})}>Save mix</button></div>{error&&<small role="alert">{error}</small>}</div>
}
