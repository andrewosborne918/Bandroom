import type {Song,Section} from './types';
export type TimedLine={start:number;end:number;text:string};
export type SongChart={plainLyrics:string;timedLyrics:TimedLine[];source:'lrclib'|'import';sourceUrl:string;title:string;artist:string;chordpro?:string;updated:number};
const clean=(v:unknown,max=200)=>typeof v==='string'?v.trim().slice(0,max):'';
export function safeChart(v:any,duration:number):SongChart|undefined{
 if(!v||!['lrclib','import'].includes(v.source))return;
 return {plainLyrics:clean(v.plainLyrics,20000)||((Array.isArray(v.timedLyrics)?v.timedLyrics:[]).map((l:any)=>clean(l?.text,1000)).join("\n").slice(0,20000)),timedLyrics:(Array.isArray(v.timedLyrics)?v.timedLyrics:[]).slice(0,2000).filter((l:any)=>l&&Number.isFinite(l.start)&&Number.isFinite(l.end)&&l.start>=0&&l.end>l.start&&l.end<=duration+1).map((l:any)=>({start:l.start,end:l.end,text:clean(l.text,1000)})).sort((a:TimedLine,b:TimedLine)=>a.start-b.start),source:v.source,sourceUrl:typeof v.sourceUrl==='string'&&/^https:\/\/lrclib.net\/api\/get\/\d+$/.test(v.sourceUrl)?v.sourceUrl:'',title:clean(v.title),artist:clean(v.artist),chordpro:clean(v.chordpro,40000)||undefined,updated:Number.isFinite(v.updated)?v.updated:Date.now()};
}
export function parseLrc(lrc:string,duration:number,sourceDuration?:number):TimedLine[]{
 const scale=sourceDuration&&Number.isFinite(sourceDuration)&&sourceDuration>10&&Math.abs(sourceDuration-duration)>3?Math.min(2,Math.max(0.5,duration/sourceDuration)):1;
 const lines:{start:number;text:string}[]=[];
 for(const line of lrc.split('\n')){const stamps=[...line.matchAll(/\[(\d{1,3}):(\d{2}(?:\.\d+)?)\]/g)];const text=line.replace(/\[[^\]]+\]/g,'').trim();if(!text)continue;for(const m of stamps){const start=Math.round((Number(m[1])*60+Number(m[2]))*scale*100)/100;if(start<duration)lines.push({start,text:text.slice(0,1000)})}}
 lines.sort((a,b)=>a.start-b.start);return lines.map((l,i)=>({...l,end:Math.min(duration,lines.slice(i+1).find(n=>n.start>l.start)?.start??duration)})).filter(l=>l.end>l.start);
}
export function lookupIdentity(song:Song){
 let title=song.title.replace(/\.(mp3|wav|m4a|aac|flac|ogg)$/i,'').replace(/^\d{1,2}\s*[-.]\s+(?=[A-Za-z])/,'').replace(/\s*[/|]\s*lyrics.*$/i,'').replace(/\s*[\(\[](?:official.*|lyrics.*|audio.*|remaster(?:ed)?.*|live.*|hd|hq|\d{4}\s*remaster.*)[\)\]]\s*/ig,'').trim(),artist=song.artist;
 const parts=title.split(/\s+-\s+/);
 if(song.info?.identifiedBy!=='audd'&&parts.length===2){artist=parts[0].trim();title=parts[1].replace(/^\d{1,2}\s*[-.]?\s+(?=[A-Za-z])/,'').trim()}
 return {title,artist};
}
const normal=(s:string)=>s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function exactLyricsMatch(song:Song,r:any){const identity=lookupIdentity(song);return normal(r.trackName||'')===normal(identity.title)&&normal(r.artistName||'')===normal(identity.artist)&&Math.abs(Number(r.duration)-song.duration)<=3;}
export function recordChart(r:any,duration:number):SongChart|undefined{return safeChart({plainLyrics:r.plainLyrics,timedLyrics:parseLrc(clean(r.syncedLyrics,100000),duration,Number(r.duration)),source:'lrclib',sourceUrl:'https://lrclib.net/api/get/'+Number(r.id),title:r.trackName,artist:r.artistName,updated:Date.now()},duration);}
export function chartLines(song:Song):string{
 if(song.chart?.chordpro)return song.chart.chordpro;
 const allChords=(song.analysis?.chords||[]).filter(c=>c.chord&&c.chord!=='N');
 const dedupedChords=allChords.filter((c,i)=>i===0||c.chord!==allChords[i-1].chord);
 const lyrics=song.chart?.timedLyrics.length?song.chart.timedLyrics:song.chart?.plainLyrics?[]:song.analysis?.lyrics||[];
 if(!lyrics.length){
  if(song.chart?.plainLyrics)return song.chart.plainLyrics;
  if(!dedupedChords.length)return '';
  const rows:string[]=[];
  for(let i=0;i<dedupedChords.length;i+=4)rows.push(dedupedChords.slice(i,i+4).map(c=>'['+c.chord+']').join(' '));
  return rows.join('\n');
 }
 return lyrics.map(line=>{
  const events=dedupedChords.filter(c=>c.time>=line.start&&c.time<line.end);const before=dedupedChords.filter(c=>c.time<=line.start).at(-1);if(before&&!events.some(c=>c.time===line.start))events.unshift({...before,time:line.start});
  const words=line.text.split(/\s+/);const slots=new Map<number,string>();let last='';for(const c of events){if(c.chord===last)continue;last=c.chord;const i=Math.min(words.length-1,Math.max(0,Math.round((c.time-line.start)/Math.max(.01,line.end-line.start)*words.length)));if(!slots.has(i))slots.set(i,c.chord)}
  let prevSlot='';
  return words.map((w,i)=>{const ch=slots.get(i);if(ch&&ch!==prevSlot){prevSlot=ch;return '['+ch+']'+w;}return w;}).join(' ');
 }).join('\n');
}
export function displaySection(song:Song,section:Section|undefined){if(!section)return section;if(section.manual)return section;const generated=section.name==='Analyzed song'||section.name==='Online lyrics'||/\]\s*@\s*\d+(?:\.\d+)?s/.test(section.chords);if(!generated)return section;const tabs=Object.keys(section.tabs||{}).length?section.tabs:(song.analysis?.tabs||{});const tabCues=section.tabCues?.length?section.tabCues:song.analysis?.tabCues;return {...section,lyrics:song.chart?.plainLyrics||song.analysis?.lyrics.map(l=>l.text).join('\n')||section.lyrics,chords:chartLines(song)||section.chords.replace(/\s*@\s*\d+(?:\.\d+)?s/g,''),tabs,...(tabCues?.length?{tabCues}:{})};}
export function applyChart(song:Song,chart:SongChart):Song{const next={...song,chart};const old=chart.source==='import'?[]:song.sections;return {...next,sections:old.some(s=>s.lyrics||s.chords)?old.map(s=>displaySection(next,s)!):[{id:crypto.randomUUID(),name:chart.source==='import'?'Imported chart':'Online lyrics',bars:Math.max(1,Math.ceil(song.duration*song.bpm/60/song.beats)),lyrics:chart.plainLyrics,chords:chartLines(next),tabs:song.analysis?.tabs||{},...(song.analysis?.tabCues?.length?{tabCues:song.analysis.tabCues}:{})}]};}
const TAB_LINE_RE=/^\s*(?:[eEBGDAb#]{1,2}|[1-6])\s*[|:][-0-9hHpPbBrRsS/\\~xXvV^()|\s]{4,}\s*$/;
const WEB_NOISE_RE=/^(?:\[\/?tab\]|\[\/?ch\]|ultimate-guitar\.com.*|(?:tuning|capo|author|difficulty|key|time signature)\s*:.*|x+\s*|\d+\s+contributors?.*)$/i;
export function isAsciiTabLine(line:string){return TAB_LINE_RE.test(line)}
export function normalizeChordChart(input:string){
 const cleaned=input.replace(/\r/g,'').replace(/\[ch\](.*?)\[\/ch\]/gi,'$1').replace(/\[\/?tab\]/gi,'');
 const lines=cleaned.split('\n'),out:string[]=[];
 const chord=/^[A-G](?:#|b)?(?:m|maj|min|dim|aug|sus|add)?\d*(?:\/[A-G](?:#|b)?)?$/;
 for(let i=0;i<lines.length;i++){
  const line=lines[i],trimmed=line.trim();
  if(WEB_NOISE_RE.test(trimmed))continue;
  if(/^\[[^\]]+\]$/.test(trimmed)&&!chord.test(trimmed.slice(1,-1))){out.push('{section: '+trimmed.slice(1,-1)+'}');continue}
  const tokens=[...line.matchAll(/\S+/g)];
  if(tokens.length&&tokens.every(t=>chord.test(t[0]))){
   const following=lines[i+1]||'';
   if(following.trim()&&!/^\[|^\{/.test(following.trim())&&!isAsciiTabLine(following)&&!following.trim().split(/\s+/).every(w=>chord.test(w))){
    let lyric=following;
    for(const t of tokens.reverse()){let at=Math.min(t.index!,lyric.length);while(at>0&&at<lyric.length&&lyric[at]!==' '&&lyric[at-1]!==' ')at--;lyric=lyric.slice(0,at)+'['+t[0]+']'+lyric.slice(at)}
    out.push(lyric);i++;
   }else out.push(tokens.map(t=>'['+t[0]+']').join(' '));
  }else out.push(line);
 }
 return out.join('\n');
}
export function importedSections(chordpro:string):Section[]{const sections:Section[]=[];let name='Imported chart',content:string[]=[];const flush=()=>{if(content.some(l=>l.trim())){const chords=content.join('\n').trim();sections.push({id:crypto.randomUUID(),name,bars:8,manual:true,lyrics:lyricsOnly(chords),chords,tabs:{},tabCues:[]})}content=[]};for(const line of chordpro.split('\n')){const m=line.match(/^\{(?:section|start_of_chorus|soc):?\s*(.*?)\}$/i);if(m){flush();name=m[1]||'Chorus'}else if(!/^\{/.test(line))content.push(line)}flush();return sections;}
export function extractPastedChartAndTabs(input:string,instrument='Guitar'):{chordpro:string;sections:Section[];hasTabs:boolean;hasChords:boolean;tabText:string}{
 const cleaned=input.replace(/\r/g,'').replace(/\[ch\](.*?)\[\/ch\]/gi,'$1').replace(/\[\/?tab\]/gi,'');
 const chord=/^[A-G](?:#|b)?(?:m|maj|min|dim|aug|sus|add)?\d*(?:\/[A-G](?:#|b)?)?$/;
 type RawBucket={name:string;chartLines:string[];tabBlocks:string[][];currentTab:string[]};
 const buckets:RawBucket[]=[];
 let current:RawBucket={name:'Imported chart',chartLines:[],tabBlocks:[],currentTab:[]};
 const flushTab=()=>{if(current.currentTab.length>=2)current.tabBlocks.push(current.currentTab);else if(current.currentTab.length===1)current.chartLines.push(current.currentTab[0]);current.currentTab=[]};
 const flushBucket=()=>{flushTab();if(current.chartLines.some(l=>l.trim())||current.tabBlocks.length)buckets.push(current)};
 for(const line of cleaned.split('\n')){
  const trimmed=line.trim();
  if(WEB_NOISE_RE.test(trimmed))continue;
  const secBracket=/^\[([^\]]+)\]$/.exec(trimmed);
  const secBrace=/^\{(?:section|start_of_chorus|soc):?\s*(.*?)\}$/i.exec(trimmed);
  if((secBracket&&!chord.test(secBracket[1]))||secBrace){
   flushBucket();
   current={name:(secBracket?secBracket[1]:secBrace![1])||'Section',chartLines:[],tabBlocks:[],currentTab:[]};
   continue;
  }
  if(isAsciiTabLine(line)){current.currentTab.push(line.trimEnd());continue}
  if(current.currentTab.length&&!trimmed){flushTab();continue}
  if(current.currentTab.length)flushTab();
  current.chartLines.push(line);
 }
 flushBucket();
 const allTabs:string[]=[];
 const sections:Section[]=[];
 const chordproParts:string[]=[];
 for(const b of buckets){
  const norm=normalizeChordChart(b.chartLines.join('\n')).trim();
  const tabStr=b.tabBlocks.map(block=>block.join('\n')).join('\n\n').trim();
  if(tabStr)allTabs.push((b.name!=='Imported chart'?`[${b.name}]\n`:'')+tabStr);
  if(norm||tabStr){
   if(b.name!=='Imported chart'||buckets.length>1)chordproParts.push(`{section: ${b.name}}`);
   if(norm)chordproParts.push(norm);
   sections.push({
    id:crypto.randomUUID(),
    name:b.name,
    bars:8,
    manual:true,
    lyrics:norm?lyricsOnly(norm):'',
    chords:norm,
    tabs:tabStr?{[instrument]:tabStr}:{},
    tabCues:[]
   });
  }
 }
 const chordpro=chordproParts.join('\n').trim();
 const hasTabs=allTabs.length>0;
 const hasChords=/\[[A-G](?:#|b)?(?:m|maj|min|dim|aug|sus|add)?\d*(?:\/[A-G](?:#|b)?)?\]/.test(chordpro);
 return {chordpro,sections,hasTabs,hasChords,tabText:allTabs.join('\n\n')};
}
export function lyricsOnly(input:string){
 const chord=/^[A-G](?:#|b)?(?:(?:maj|min|dim|aug|sus|add|m)\d*|\d+)?(?:\([^)]*\))?(?:\/[A-G](?:#|b)?)?$/;
 return input.replace(/\r/g,'').split('\n').map(line=>{
  const text=line.replace(/\[([^\]]+)\]/g,(_,value:string)=>chord.test(value.trim())?'':value).replace(/^\{(?:section|title|subtitle):\s*(.*?)\}\s*$/i,'$1');
  const tokens=text.trim().split(/\s+/).filter(Boolean);if(tokens.length&&tokens.every(t=>chord.test(t))&&(tokens.length>1||tokens[0]!=='A'))return '';
  return text.trimEnd();
 }).join('\n').replace(/\n[ \t]*\n(?:[ \t]*\n)+/g,'\n\n').trim();
}
export function expandImportedSections(song:Song):Song{
 if(song.chart?.source!=='import'||song.sections.length!==1)return song;const original=song.sections[0];if(!['Imported chart','Analyzed song','Online lyrics'].includes(original.name))return song;
 const text=normalizeChordChart(original.chords||song.chart.chordpro||'');if(!/^\{section:/m.test(text))return song;const parts=importedSections(text);if(parts.length<2)return song;
 const originalLines=text.split('\n').filter(l=>l.trim());let offset=0;
 const sections=parts.map((part,i)=>{const count=part.chords.split('\n').filter(l=>l.trim()).length;while(offset<originalLines.length&&originalLines[offset].startsWith('{'))offset++;const start=offset;offset+=count;return {...part,id:original.id+'-part-'+i,tabs:{...original.tabs},tabCues:original.tabCues,lineCues:original.lineCues?.filter(c=>c.line>=start&&c.line<offset).map(c=>({...c,line:c.line-start})),start:i===0?0:undefined}});
 return {...song,sections};
}
