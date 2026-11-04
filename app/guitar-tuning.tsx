'use client';
import {Guitar} from 'lucide-react';
import {guitarTunings,guitarTuningInfo} from '../lib/guitar-tuning';
import type {GuitarTuning} from '../lib/guitar-tuning';
import type {Song} from '../lib/types';

export function GuitarTuningFields({song,onChange}:{song:Song;onChange:(patch:Partial<Song>)=>void}){
  const info=song.info||{},tuning=guitarTuningInfo(info);
  return <section className="guitar-tuning-fields" aria-label="Guitar tuning">
    <label>Guitar tuning<select value={info.guitarTuning||''} onChange={e=>onChange({info:{...info,guitarTuning:(e.target.value||undefined) as GuitarTuning|undefined}})}>
      <option value="">Not specified</option>
      {guitarTunings.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
      <option value="custom">Custom tuning</option>
    </select></label>
    {info.guitarTuning==='custom'&&<label>Custom guitar tuning<input maxLength={80} value={info.guitarTuningCustom||''} placeholder="e.g. Drop C — C G C F A D" onChange={e=>onChange({info:{...info,guitarTuningCustom:e.target.value}})}/></label>}
    {tuning?.strings&&<p className="tuning-strings"><strong>{tuning.strings}</strong><small>Low string → high string</small></p>}
    <p className="form-hint">Saved for this song and shown to your band. This is a tuning reminder; it does not change the recording’s pitch or transpose charts.</p>
  </section>;
}

export function GuitarTuningBadge({song,compact=false}:{song:Song;compact?:boolean}){
  const tuning=guitarTuningInfo(song.info);
  if(!tuning)return null;
  return <span className={'guitar-tuning-badge'+(compact?' compact':'')} title={tuning.strings?'Low to high: '+tuning.strings:undefined}>
    <Guitar size={14} aria-hidden="true"/><span>Guitar: {tuning.name}{!compact&&tuning.strings&&<span className="tuning-notes"> · {tuning.strings}</span>}{compact&&song.info?.guitarTuning==='custom'&&tuning.strings?' · '+tuning.strings:''}</span>
  </span>;
}
