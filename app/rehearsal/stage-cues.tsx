'use client';
import {useMemo} from 'react';
import type {Song} from '../../lib/types';
import {practiceParts,chartApproved} from '../../lib/band-practice';
import {guitarTuningInfo} from '../../lib/guitar-tuning';
import {GuitarTuningBadge} from '../guitar-tuning';
export default function StageCues({playing,song,next,position,locked,onLock,privateNote,practice}:{playing:boolean;song:Song;next?:Song;position:number;locked:boolean;onLock:()=>void;privateNote:string;practice?:string}){
 const approved=useMemo(()=>chartApproved(song),[song]),parts=useMemo(()=>practiceParts(song),[song]),current=parts.filter(p=>p.start<=position).at(-1),upcoming=parts.find(p=>p.start>position),tuning=next?guitarTuningInfo(next.info):undefined;
 return <section className="stage-cues" aria-label="Performance cues"><div className="stage-current"><h2>{song.title}</h2><GuitarTuningBadge song={song} compact/><small>{current?.name||'Intro'}{playing&&upcoming?' · Next section: '+upcoming.name+' in '+Math.max(0,Math.ceil(upcoming.start-position))+'s':!playing?' · Stand by':''}{practice?' · '+practice:''}</small></div><div className="stage-tools"><button className={'button '+(locked?'primary':'subtle')} aria-pressed={locked} onClick={onLock}>{locked?'Stage locked':'Lock stage'}</button><small className="stage-review">{approved?'Band-approved':'Draft chart'}</small>{(song.rehearsal?.bandNotes||privateNote)&&<details className="stage-notes"><summary>Notes</summary>{song.rehearsal?.bandNotes&&<p>{song.rehearsal.bandNotes}</p>}{privateNote&&<p><strong>My notes:</strong> {privateNote}</p>}</details>}</div><div className="stage-next"><small>NEXT SONG</small><strong>{next?.title||'End of set'}</strong>{next&&<span>{tuning?'Guitar: '+tuning.name+(tuning.strings?' · '+tuning.strings:''):'Guitar tuning not specified'} · {next.bpm} BPM · {next.countIn} bar count-in</span>}</div></section>;
}
