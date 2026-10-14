import {countInSeconds} from './timeline.ts';
import {chartApi} from './chart-api.ts';
import {safeChart,expandImportedSections} from './song-charts.ts';
import {safeAnalysis} from './analysis.ts';
import {sanitizeInfo} from './song-info.ts';
import {legacyRecognition} from './recognition-legacy.ts';
import { separationApi } from './separation-api.ts';
import { audioStream, limits, listObjects, categories, restricted, suggest, type ProcessingConfig } from './stems.ts';
import type { Song, Session } from './types';
type StoredSession = Session & { owner: string; hostToken: string; memberTokens: Record<string,string> };
const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' };
const reply = (body: unknown, status=200) => new Response(JSON.stringify(body), {status,headers});
const fail = (message: string, status=400) => { throw Object.assign(new Error(message),{status}); };
const id = (v: string) => { if(!/^[a-zA-Z0-9_-]{1,80}$/.test(v)) fail('Invalid identifier'); return v; };
const text = (v: unknown, max=100) => typeof v === 'string' ? v.slice(0,max) : '';
const num = (v: unknown, lo: number, hi: number, fallback: number) => typeof v === 'number' && Number.isFinite(v) ? Math.min(hi,Math.max(lo,v)) : fallback;
const sanitize = (s: StoredSession): Session => { const {owner,hostToken,memberTokens,...publicData}=s; return publicData; };
function song(input: any, songId: string): Song {
  if(!input.title?.trim()) fail('Give the song a title');
  return { id:songId,chart:safeChart(input.chart,num(input.duration,1,7200,120)),analysis:safeAnalysis(input.analysis,num(input.duration,1,7200,120)),info:sanitizeInfo(input.info),title:text(input.title),artist:text(input.artist),key:text(input.key,12)||'C',bpm:num(input.bpm,30,300,120),beats:Math.round(num(input.beats,1,12,4)),denominator:[2,4,8,16].includes(input.denominator)?input.denominator:4,countIn:Math.round(num(input.countIn,0,4,1)),beatOffset:num(input.beatOffset,0,3600,0),duration:num(input.duration,1,7200,120),stems:Array.isArray(input.stems)?input.stems.slice(0,24).map((s:any)=>({id:id(s.id),audioVersion:text(s.audioVersion,80)||undefined,name:text(s.name),filename:text(s.filename),enabled:!!s.enabled,volume:num(s.volume,0,1,.7),category:categories.includes(s.category)?s.category:suggest(s.name).category,sampleRate:num(s.sampleRate,8000,192000,44100),source:s.source==='ai'?'ai':'import',status:'completed' as const,pan:num(s.pan,-1,1,0),solo:!!s.solo,bandOnly:!!s.bandOnly,offset:num(s.offset,-7200,7200,0),duration:num(s.duration,0,7200,0),bytes:num(s.bytes,0,1024*1024*1024,0)})):[],sections:Array.isArray(input.sections)?input.sections.slice(0,100).map((s:any)=>({id:id(s.id),name:text(s.name,60)||'Section',manual:!!s.manual,lineCues:Array.isArray(s.lineCues)?s.lineCues.slice(0,2000).filter((c:any)=>c&&Number.isInteger(c.line)&&c.line>=0&&c.line<4000&&Number.isFinite(c.at)&&c.at>=0&&c.at<=7200).map((c:any)=>({line:c.line,at:c.at})):[],start:typeof s.start==='number'&&Number.isFinite(s.start)?num(s.start,0,7200,0):undefined,tabCues:Array.isArray(s.tabCues)?s.tabCues.slice(0,500).filter((c:any)=>c&&Number.isFinite(c.at)&&c.at>=0&&c.at<=7200).map((c:any)=>({id:id(c.id),at:c.at,instrument:text(c.instrument,30),text:text(c.text,10000)})).sort((a:any,b:any)=>a.at-b.at):[],bars:Math.round(num(s.bars,1,256,8)),lyrics:text(s.lyrics,20000),chords:text(s.chords,20000),tabs:Object.fromEntries(Object.entries(s.tabs||{}).slice(0,8).map(([k,v])=>[text(k,30),text(v,20000)]))})):[],demo:!!input.demo };
}
export async function handleBand(request: Request, bucket: R2Bucket, env:ProcessingConfig={}): Promise<Response> {
  try {
    const received=Date.now(), url=new URL(request.url), parts=url.pathname.split('/').filter(Boolean).slice(2), method=request.method;
    const user=request.headers.get('oai-authenticated-user-id');
    const separated=await separationApi(request,bucket,env,user);if(separated)return separated;
    if(!user) return reply({error:'Sign in to use Bandroom.'},401);
    if(method!=='GET' && request.headers.get('Origin') && request.headers.get('Origin')!==url.origin) return reply({error:'Invalid request origin'},403);
    const prefix='library/'+encodeURIComponent(user)+'/', key=(sid:string)=>prefix+'songs/'+id(sid)+'.json';
    if(parts[0]==='mac-setup'&&method==='GET'){
      const code=url.searchParams.get('code')||'';
      if(!env.MAC_SETUP_CODE||code.length<40||code!==env.MAC_SETUP_CODE||!env.BACKGROUND_SECRET||!env.SITES_WORKER_TOKEN)fail('Mac setup link unavailable or expired.',403);
      const claim=await bucket.put('processing/mac-setup/'+code,JSON.stringify({owner:user,used:Date.now()}),{onlyIf:{etagDoesNotMatch:'*'}});
      if(!claim)fail('This setup link was already used. Request a new connection file.',410);
      return new Response(JSON.stringify({BANDROOM_URL:url.origin,BACKGROUND_SECRET:env.BACKGROUND_SECRET,SITES_SERVICE_TOKEN:env.SITES_WORKER_TOKEN},null,2),{headers:{'Content-Type':'application/json','Content-Disposition':'attachment; filename="'+(url.searchParams.get('refresh')==='1'?'worker-config-refresh.json':'worker-config.json')+'"','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});
    }
    const charts=await chartApi(request,bucket,prefix);if(charts)return charts;
    const recognized=await legacyRecognition(request,bucket,env,prefix);if(recognized)return recognized;
    const read=async <T,>(k:string):Promise<T>=>{ const o=await bucket.get(k); if(!o) fail('Not found',404); const value=await o!.json<T>();if(k.includes('/songs/')){const updated=expandImportedSections(value as unknown as Song);if(updated!==value){const saved=await bucket.put(k,JSON.stringify(updated),{onlyIf:{etagMatches:o!.etag}});if(saved)return updated as unknown as T;const current=await bucket.get(k);return await current!.json<T>()}}return value; };
    const body=async()=>{ const raw=await request.text(); if(raw.length>500000) fail('Request too large',413); return JSON.parse(raw); };
    if(parts[0]==='clock') return reply({received,sent:Date.now()});
    if(parts[0]==='setlist') {
      if(method==='GET'){const o=await bucket.get(prefix+'setlist.json');return reply(o?await o.json():{ids:[]});}
      if(method==='PUT'){const b=await body();if(!Array.isArray(b.ids)||b.ids.length>100)fail('Invalid setlist');const ids=[...new Set<string>(b.ids.map((x:string)=>id(x)))];await bucket.put(prefix+'setlist.json',JSON.stringify({ids}));return reply({ids});}
    }
    if(parts[0]==='songs' && parts.length===1 && method==='GET') {
      const list=await bucket.list({prefix:prefix+'songs/',limit:500});
      return reply({songs:await Promise.all(list.objects.map(o=>read<Song>(o.key)))});
    }
    if(parts[0]==='songs' && method==='POST' && parts.length===1) {
      const data=await body(), s=song({...data,stems:data.demo?['Drums','Bass','Keys'].map((name,i)=>({id:'demo-'+crypto.randomUUID(),name,filename:'Generated rehearsal audio',enabled:true,volume:.7,duration:data.duration,bytes:0})):[]},crypto.randomUUID()); await bucket.put(key(s.id),JSON.stringify(s)); return reply(s,201);
    }
    if(parts[0]==='songs' && parts[1] && parts.length===2) {
      const old=await read<Song>(key(parts[1]));
      if(method==='GET') return reply(old);
      if(method==='PUT') {
        const data=await body();
        const manualSections=(data.sections||[]).map((section:any)=>({...section,manual:section.manual||JSON.stringify(section)!==JSON.stringify(old.sections.find(x=>x.id===section.id))}));
        const s=song({...data,sections:manualSections,stems:old.stems.map(st=>({...st,...(data.stems||[]).find((x:any)=>x.id===st.id),id:st.id,filename:st.filename,bytes:st.bytes,duration:st.duration,sampleRate:st.sampleRate,source:st.source,audioVersion:st.audioVersion}))},old.id);
        s.duration=Math.max(s.duration,...s.stems.map(st=>st.duration+(st.offset||0)));await bucket.put(key(s.id),JSON.stringify(s)); return reply(s);
      }
      if(method==='DELETE') { const setKey=prefix+'setlist.json';for(let attempt=0;attempt<4;attempt++){const set=await bucket.get(setKey);if(!set)break;const saved=await set.json<{ids:string[]}>();if(!saved.ids.includes(old.id))break;const updated=await bucket.put(setKey,JSON.stringify({ids:saved.ids.filter(sid=>sid!==old.id)}),{onlyIf:{etagMatches:set.etag}});if(updated)break;if(attempt===3)fail('Setlist changed. Try deleting again.',409);}const jobs=await listObjects(bucket,'jobs/');for(const object of jobs){const j:any=await (await bucket.get(object.key))!.json();if(j.owner===user&&j.songId===old.id)await bucket.delete([object.key,'processing/progress/'+j.id+'.json',prefix+'originals/'+j.id,...j.stems.map((st:any)=>prefix+'audio/'+old.id+'/'+st.id)]);}await bucket.delete([...old.stems.map(s=>prefix+'audio/'+old.id+'/'+s.id),prefix+'recognition/'+old.id+'.json',prefix+'charts/'+old.id+'.json',key(old.id)]); return reply({ok:true}); }
    }
    if(parts[0]==='stems' && method==='POST') {
      const sid=id(url.searchParams.get('song')||''), existing=await bucket.get(key(sid));if(!existing)fail('Song not found',404);const old=await existing!.json<Song>();
      if(old.demo){old.demo=false;old.stems=old.stems.filter(st=>!st.id.startsWith('demo-'));}
      if(old.stems.length>=24) fail('A song supports up to 24 stems');
      const upload=await audioStream(request,limits(env).bytes);
      const duration=Number(url.searchParams.get('duration'));if(!duration||duration>limits(env).seconds)fail('Audio exceeds the duration limit');
      const stemId=crypto.randomUUID(),meta=suggest(url.searchParams.get('name')||url.searchParams.get('filename')||'Track');
      await bucket.put(prefix+'audio/'+sid+'/'+stemId,upload.stream as any,{httpMetadata:{contentType:request.headers.get('Content-Type')||'application/octet-stream'}});
      old.stems.push({id:stemId,...meta,filename:text(url.searchParams.get('filename')),enabled:true,volume:.7,pan:0,offset:0,source:'import',status:'completed',sampleRate:Number(url.searchParams.get('sampleRate'))||44100,duration,bytes:upload.size});
      old.duration=Math.max(...old.stems.map(s=>s.duration+(s.offset||0)),1); const saved=await bucket.put(key(sid),JSON.stringify(old),{onlyIf:{etagMatches:existing!.etag}});if(!saved){await bucket.delete(prefix+'audio/'+sid+'/'+stemId);fail('Song changed during upload. Try again.',409)}
      if(url.searchParams.get('auto')==='1'&&env.AUTO_PROCESS_UPLOADS==='true'&&env.BACKGROUND_SECRET){const queue=new Request(url.origin+'/api/band/separation/from-song/'+sid,{method:'POST',headers:{'oai-authenticated-user-id':user}});await separationApi(queue,bucket,env,user);}
      return reply(old,201);
    }
    if(parts[0]==='stems'&&parts.length===3&&method==='DELETE'){
      const old=await read<Song>(key(parts[1]));const st=old.stems.find(x=>x.id===parts[2]);if(!st)fail('Stem not found',404);old.stems=old.stems.filter(x=>x.id!==parts[2]);await bucket.put(key(old.id),JSON.stringify(old));await bucket.delete(prefix+'audio/'+old.id+'/'+id(parts[2]));return reply(old);
    }
    const loadSession=async(code:string)=>{ const s=await read<StoredSession>('sessions/'+id(code)+'.json'); if(s.expires<Date.now()) fail('This session has expired. Create a new session.',410); return s; };
    const token=request.headers.get('x-band-token')||'';
    const authorize=(s:StoredSession,host=false)=>{ if(host ? token!==s.hostToken : token!==s.hostToken && !s.memberTokens[token]) fail('Session access denied. Join again.',403); };
    if(parts[0]==='audio' && parts.length===3 && method==='GET') {
      let audioPrefix=prefix;const code=url.searchParams.get('session');
      if(code) {const s=await loadSession(code);authorize(s);if(!s.songs.some(x=>x.id===parts[1]&&x.stems.some(st=>st.id===parts[2]))) fail('Track unavailable',404);const st=s.songs.find(x=>x.id===parts[1])!.stems.find(x=>x.id===parts[2])!;const member=s.members.find(m=>m.id===s.memberTokens[token]);if(member?.role==='audience'&&restricted(st))fail('Band-only audio is not available to audience devices',403);audioPrefix='library/'+encodeURIComponent(s.owner)+'/';}
      const o=await bucket.get(audioPrefix+'audio/'+id(parts[1])+'/'+id(parts[2]));if(!o) fail('Track unavailable',404);
      return new Response(o!.body as any,{headers:{'Content-Type':o!.httpMetadata?.contentType||'audio/wav','Cache-Control':'private, no-store','Vary':'x-band-token'}});
    }
    if(parts[0]==='sessions' && parts.length===1 && method==='POST') {
      const b=await body(); if(!Array.isArray(b.songIds)||!b.songIds.length||b.songIds.length>100) fail('Add at least one song to your setlist');
      const songs=await Promise.all(b.songIds.map((sid:string)=>read<Song>(key(sid))));
      const code=crypto.randomUUID().replaceAll('-','').slice(0,8).toUpperCase(), hostToken=crypto.randomUUID();
      const s:StoredSession={code,name:text(b.name)||'Band practice',owner:user,hostToken,memberTokens:{},songs,songId:songs[0].id,members:[],transport:{status:'stopped',run:crypto.randomUUID(),startAt:0,offset:0,countIn:0},revision:1,expires:Date.now()+24*3600000};
      await bucket.put('sessions/'+code+'.json',JSON.stringify(s),{onlyIf:{etagDoesNotMatch:'*'}}); return reply({session:sanitize(s),token:hostToken},201);
    }
    if(parts[0]==='sessions' && parts[1]) {
      const code=id(parts[1].toUpperCase()), sessionKey='sessions/'+code+'.json';
      if(parts.length===2 && method==='GET') {for(let attempt=0;attempt<4;attempt++){const obj=await bucket.get(sessionKey);if(!obj)fail('Session not found',404);const s=await obj!.json<StoredSession>();authorize(s);if(s.expires<Date.now())fail('Session expired',410);let changed=false;for(const entry of s.songs){const item=await bucket.get('library/'+encodeURIComponent(s.owner)+'/songs/'+entry.id+'.json');if(!item)continue;const latest=await read<Song>('library/'+encodeURIComponent(s.owner)+'/songs/'+entry.id+'.json');const patch={sections:latest.sections,chart:latest.chart,title:latest.title,artist:latest.artist,countIn:latest.countIn};if(JSON.stringify({...entry,...patch})!==JSON.stringify(entry)){Object.assign(entry,patch);changed=true}}if(!changed)return reply(sanitize(s));s.revision++;const saved=await bucket.put(sessionKey,JSON.stringify(s),{onlyIf:{etagMatches:obj!.etag}});if(saved)return reply(sanitize(s));}fail('Session changed, retry',409); }
      if(method==='POST') {
        const b=await body();
        for(let attempt=0;attempt<5;attempt++) {
          const obj=await bucket.get(sessionKey); if(!obj) fail('Session code not found',404);
          const s=await obj!.json<StoredSession>();if(s.expires<Date.now()) fail('Session expired',410);
          let newToken:string|undefined;
          if(parts[2]==='join') {
            if(s.members.length>=20) fail('This session is full');
            newToken=crypto.randomUUID();const memberId=crypto.randomUUID();s.memberTokens[newToken]=memberId;
            const role=b.role==='audience'?'audience':'musician';
            s.members.push({id:memberId,name:text(b.name,40)||(role==='audience'?'Audience output':'Musician'),instrument:role==='audience'?'Audience output':text(b.instrument,30)||'Guitar',role,ready:false,seen:Date.now()});
          } else if(parts[2]==='leave') {
            authorize(s);const memberId=s.memberTokens[token];if(!memberId)fail('The leader must leave locally');s.members=s.members.filter(m=>m.id!==memberId);delete s.memberTokens[token];
          } else if(parts[2]==='ready') {
            authorize(s);const member=s.members.find(m=>m.id===s.memberTokens[token]);if(member){member.ready=!!b.ready;member.songId=text(b.songId,80);member.seen=Date.now();}
          } else if(parts[2]==='action') {
            authorize(s,true);const current=s.songs.find(x=>x.id===s.songId)!;
            if(b.action==='select') {if(!s.songs.some(x=>x.id===b.songId)) fail('Song outside this set');s.songId=b.songId;s.transport={status:'stopped',run:crypto.randomUUID(),startAt:0,offset:0,countIn:0};s.members.forEach(m=>m.ready=false);}
            else if(b.action==='play') {if(s.members.some(m=>m.role==='audience'&&Date.now()-m.seen<30000&&(!m.ready||m.songId!==s.songId)))fail('The audience device is still loading. Enable its audio and wait for Ready.');const offset=num(b.offset,0,current.duration,0), countIn=countInSeconds(current,offset);s.transport={status:'playing',run:crypto.randomUUID(),startAt:Date.now()+3000+countIn*1000,offset,countIn};}
            else if(b.action==='stop') s.transport={status:'stopped',run:crypto.randomUUID(),startAt:0,offset:num(b.offset,0,current.duration,0),countIn:0};
            else if(b.action==='mix') { current.stems=current.stems.map(st=>({...st,enabled:!!b.stems?.find((x:any)=>x.id===st.id)?.enabled,volume:num(b.stems?.find((x:any)=>x.id===st.id)?.volume,0,1,st.volume),pan:num(b.stems?.find((x:any)=>x.id===st.id)?.pan,-1,1,st.pan||0),solo:!!b.stems?.find((x:any)=>x.id===st.id)?.solo}));const libraryKey='library/'+encodeURIComponent(s.owner)+'/songs/'+current.id+'.json';const library=await read<Song>(libraryKey);library.stems=library.stems.map(st=>({...st,...current.stems.find(x=>x.id===st.id)}));await bucket.put(libraryKey,JSON.stringify(library)); }
            else fail('Unknown action');
          } else fail('Unknown endpoint',404);
          s.revision++;const result=await bucket.put(sessionKey,JSON.stringify(s),{onlyIf:{etagMatches:obj!.etag}});
          if(result) return reply({session:sanitize(s),...(newToken?{token:newToken}:{})});
        }
        fail('Session changed. Try again.',409);
      }
    }
    return reply({error:'Unknown endpoint'},404);
  } catch(e:any) {return reply({error:e.status?e.message:'Unable to complete the request. Please try again.'},e.status||500);}
}
