import {transpose} from '../lib/timeline';
export default function ChordLine({line,transposeBy,showChords,showLyrics}:{line:string;transposeBy:number;showChords:boolean;showLyrics:boolean}){
 const transposed=transpose(line,transposeBy);const chordOnly=!transposed.replace(/\[[^\]]+\]/g,'').trim();
 if(chordOnly)return <div className="chart-line instrumental-chords">{showChords&&[...transposed.matchAll(/\[([^\]]+)\]/g)].map((match,i)=><strong key={i}>{match[1]}</strong>)}</div>;
 const parts=transposed.split(/(\[[^\]]+\])/g);const chunks:{chords:string[];text:string}[]=[];let pending:string[]=[];
 for(const part of parts){if(part.startsWith('['))pending.push(part.slice(1,-1));else if(part){chunks.push({chords:pending,text:part});pending=[]}}if(pending.length)chunks.push({chords:pending,text:''});
 return <div className="chart-line">{chunks.map((chunk,i)=><span className="chord-word-group" key={i}>{showChords&&<strong>{chunk.chords.join(' ')||'\u00a0'}</strong>}{showLyrics&&<span>{chunk.text||'\u00a0'}</span>}</span>)}</div>;
}
