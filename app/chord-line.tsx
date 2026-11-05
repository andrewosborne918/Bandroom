import {transpose} from '../lib/timeline';
export default function ChordLine({line,transposeBy,showChords,showLyrics,onSelectChord,selectedOccurrence}:{line:string;transposeBy:number;showChords:boolean;showLyrics:boolean;onSelectChord?:(occurrenceIndex:number,rawChord:string,displayedChord:string)=>void;selectedOccurrence?:number}){
 const rawChords=[...line.matchAll(/\[([^\]]+)\]/g)].map(m=>m[1]);
 const transposed=transpose(line,transposeBy);const chordOnly=!transposed.replace(/\[[^\]]+\]/g,'').trim();
 if(chordOnly){
  return <div className="chart-line instrumental-chords">{showChords&&[...transposed.matchAll(/\[([^\]]+)\]/g)].map((match,i)=>{
   const raw=rawChords[i]||match[1],disp=match[1];
   return onSelectChord
    ?<button type="button" key={i} className={'chord-badge-btn'+(selectedOccurrence===i?' active':'')} title={'Edit chord '+disp} onClick={e=>{e.stopPropagation();onSelectChord(i,raw,disp)}}>{disp}</button>
    :<strong key={i}>{disp}</strong>;
  })}</div>;
 }
 const parts=transposed.split(/(\[[^\]]+\])/g);const chunks:{chords:{index:number;raw:string;disp:string}[];text:string}[]=[];let pending:{index:number;raw:string;disp:string}[]=[],seen=0;
 for(const part of parts){
  if(part.startsWith('[')){const disp=part.slice(1,-1),idx=seen++;pending.push({index:idx,raw:rawChords[idx]||disp,disp});}
  else if(part){chunks.push({chords:pending,text:part});pending=[];}
 }
 if(pending.length)chunks.push({chords:pending,text:''});
 return <div className="chart-line">{chunks.map((chunk,i)=><span className="chord-word-group" key={i}>{showChords&&(chunk.chords.length?<strong>{chunk.chords.map((c,ci)=>onSelectChord?<button type="button" key={c.index} className={'chord-badge-btn'+(selectedOccurrence===c.index?' active':'')} title={'Edit chord '+c.disp} onClick={e=>{e.stopPropagation();onSelectChord(c.index,c.raw,c.disp)}}>{c.disp}{ci<chunk.chords.length-1?' ':''}</button>:<span key={c.index}>{c.disp}{ci<chunk.chords.length-1?' ':''}</span>)}</strong>:<strong>{'\u00a0'}</strong>)}{showLyrics&&<span>{chunk.text||'\u00a0'}</span>}</span>)}</div>;
}
