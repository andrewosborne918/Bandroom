import {lookupLyrics} from './chart-api.ts';
import {applyChart} from './song-charts.ts';
import {safeProgress,mergeProgress} from './job-progress.ts';
import {safeAnalysis,applyAnalysis} from './analysis.ts';
import {streamZip} from './zip-stream.ts';
import type {Song,Stem} from './types';
import {audioStream,limits,listObjects,type ProcessingConfig,type SeparationJob} from './stems.ts';
export async function separationApi(req:Request,bucket:R2Bucket,env:ProcessingConfig,user:string|null):Promise<Response|null>{
 const url=new URL(req.url),p=url.pathname.split('/').filter(Boolean).slice(2),method=req.method;
 if(!['separation','processing'].includes(p[0]))return null;
 const json=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 const error=(s:string,status=400)=>{throw Object.assign(new Error(s),{status})};
 const safe=(s:string)=>{if(!/^[\w-]{1,80}$/.test(s))error('Invalid identifier');return s};
 if(method!=='GET'&&req.headers.get('origin')&&req.headers.get('origin')!==url.origin)return json({error:'Invalid origin'},403);
 const worker=p[0]==='processing';if(worker){if(!env.BACKGROUND_SECRET||req.headers.get('authorization')!=='Bearer '+env.BACKGROUND_SECRET)return json({error:'Denied'},403);}else if(!user)return json({error:'Sign in'},401);
 const prefix='library/'+encodeURIComponent(user||'')+'/';const jobkey=(id:string)=>'jobs/'+safe(id)+'.json';
 const load=async(id:string)=>{const o=await bucket.get(jobkey(id));if(!o)error('Job not found',404);const job=await o!.json<SeparationJob>();if(!worker&&job.owner!==user)error('Job not found',404);return {o:o!,job}};
 const write=async(j:SeparationJob)=>bucket.put(jobkey(j.id),JSON.stringify(j));
 try{
 if(p[1]==='config') {const heartbeat=await bucket.get('processing/heartbeat');const time=heartbeat?Number(await heartbeat.text()):0;return json({autoQueue:env.AUTO_PROCESS_UPLOADS==='true'&&!!env.BACKGROUND_SECRET,enabled:!!env.BACKGROUND_SECRET&&Date.now()-time<90000,price:env.SEPARATION_PRICE||'Worker hosting costs apply. No per-song credits; cost depends on your worker plan.',...limits(env),model:'Demucs htdemucs',categories:['vocals','drums','bass','other']});}
 if(worker&&p[1]==='heartbeat'){await bucket.put('processing/heartbeat',String(Date.now()));const jid=url.searchParams.get('job');if(jid){const {job,o}=await load(jid);if(job.status==='processing'&&job.lease===req.headers.get('x-job-lease')){job.leaseUntil=Date.now()+3600000;await bucket.put(jobkey(job.id),JSON.stringify(job),{onlyIf:{etagMatches:o.etag}});}}return json({ok:true});}
 if(worker&&p[1]==='queue'){
 await bucket.put('processing/heartbeat',String(Date.now()));const list={objects:await listObjects(bucket,'jobs/')};const jobs=await Promise.all(list.objects.map(async x=>(await bucket.get(x.key))!.json<SeparationJob>()));
 for(const j of jobs.filter(j=>j.status==='uploading'&&Date.now()-j.created>86400000)){await bucket.delete(['library/'+encodeURIComponent(j.owner!)+'/originals/'+j.id,jobkey(j.id)]);}
 const pending=jobs.filter(j=>j.status==='queued'||j.status==='processing'&&(j.leaseUntil||0)<Date.now()).sort((a,b)=>a.created-b.created);
 for(const j of pending){const {o,job}=await load(j.id);job.status='processing';job.processingStarted=job.processingStarted||Date.now();job.lease=crypto.randomUUID();job.leaseUntil=Date.now()+3600000;job.updated=Date.now();const ok=await bucket.put(jobkey(job.id),JSON.stringify(job),{onlyIf:{etagMatches:o.etag}});if(ok)return json({job,limits:limits(env)});}return json({job:null});
 }
 if(!worker&&p.length===1&&method==='GET'){const list={objects:await listObjects(bucket,'jobs/')};const jobs=await Promise.all(list.objects.map(async x=>(await bucket.get(x.key))!.json<SeparationJob>()));return json({jobs:await Promise.all(jobs.filter(j=>j.owner===user&&j.songId===url.searchParams.get('song')).map(async({owner,lease,...j})=>{const record=await bucket.get('processing/progress/'+j.id+'.json');const state:any=record?await record.json():null;return {...j,progress:state&&state.lease===lease?state.progress:undefined}}))});}
 if(!worker&&p.length===1&&method==='POST'){
 const sid=safe(url.searchParams.get('song')||'');if(!await bucket.get(prefix+'songs/'+sid+'.json'))error('Song not found',404);
 const duration=Number(url.searchParams.get('duration'));if(!duration||duration>limits(env).seconds)error('Recording exceeds duration limit');
 const idem=safe(req.headers.get('x-upload-id')||'');const jid=idem;const old=await bucket.get(jobkey(jid));if(old){const j=await old.json<SeparationJob>();if(j.owner!==user)error('Conflict',409);return json(j);}
 const upload=await audioStream(req,limits(env).bytes);const j:SeparationJob={id:jid,owner:user!,songId:sid,filename:(url.searchParams.get('filename')||'Original.wav').slice(0,100),duration,sampleRate:Number(url.searchParams.get('sampleRate'))||44100,bytes:upload.size,status:'uploading',attempt:1,created:Date.now(),updated:Date.now(),stems:[]};
 const reserved=await bucket.put(jobkey(jid),JSON.stringify(j),{onlyIf:{etagDoesNotMatch:'*'}});if(!reserved){const {job}=await load(jid);return json(job);}
 try{await bucket.put(prefix+'originals/'+jid,upload.stream as any,{httpMetadata:{contentType:'audio/'+(j.filename.toLowerCase().endsWith('.wav')?'wav':'mpeg')}});j.status='queued';await write(j);}catch(e){await bucket.delete([prefix+'originals/'+jid,jobkey(jid)]);throw e;}return json(j,201);
 }
 if(!worker&&p[1]==='from-song'&&method==='POST'){
 const sid=safe(p[2]||'');const songObject=await bucket.get(prefix+'songs/'+sid+'.json');if(!songObject)error('Song not found',404);const song=await songObject!.json<Song>();const stem=song.stems.find(st=>st.source==='import'&&st.name==='Full recording')||song.stems.find(st=>st.source==='import');if(!stem)error('Upload a mixed recording first');if(stem!.duration>limits(env).seconds)error('Recording exceeds processing duration limit');const jid=safe('auto-'+sid+'-'+stem!.id.slice(0,24));const previous=await bucket.get(jobkey(jid));if(previous){const old=await previous.json<SeparationJob>();if(old.owner!==user)error('Job access denied',403);return json(old)}const file=await bucket.get(prefix+'audio/'+sid+'/'+stem!.id);if(!file)error('Recording missing',404);const job:SeparationJob={id:jid,owner:user!,songId:sid,filename:stem!.filename,duration:stem!.duration,sampleRate:stem!.sampleRate||44100,bytes:stem!.bytes,status:'uploading',attempt:1,created:Date.now(),updated:Date.now(),stems:[]};const reserved=await bucket.put(jobkey(jid),JSON.stringify(job),{onlyIf:{etagDoesNotMatch:'*'}});if(!reserved)return json((await load(jid)).job);try{await bucket.put(prefix+'originals/'+jid,file!.body,{httpMetadata:file!.httpMetadata});job.status='queued';await write(job)}catch{await bucket.delete(jobkey(jid));throw Error('Could not queue recording')}return json(job,201);
 }
 const {job,o}=await load(p[1]);const base='library/'+encodeURIComponent(job.owner!)+'/';
 if(worker&&p[2]==='resume'&&method==='POST'){
   if(!await bucket.get(base+'songs/'+job.songId+'.json'))return json({deleted:true});
   if(job.status==='completed'&&(job.saved||!job.analysis))return json({completed:true});
   if(job.status==='failed')return json({failed:true});
   if(job.status==='uploading')error('Original still uploading',409);
   const supplied=req.headers.get('x-job-lease');
   if(job.status==='processing'&&job.lease!==supplied&&(job.leaseUntil||0)>Date.now())error('Another worker holds this job',409);
   job.status='processing';job.lease=job.lease===supplied?job.lease:crypto.randomUUID();job.leaseUntil=Date.now()+3600000;job.updated=Date.now();
   const resumed=await bucket.put(jobkey(job.id),JSON.stringify(job),{onlyIf:{etagMatches:o.etag}});if(!resumed)error('Job changed',409);
   return json({job});
 }

 if(worker&&req.headers.get('x-job-lease')!==job.lease)error('Stale job lease',409);
 if(worker&&p[2]==='lyrics'&&method==='GET'){
 const obj=await bucket.get(base+'songs/'+job.songId+'.json');if(!obj)error('Song not found',404);let song=await obj!.json<Song>();
 if(!song.chart){try{const found=await lookupLyrics(song);if(found.chart){const next=applyChart(song,found.chart);const saved=await bucket.put(base+'songs/'+song.id+'.json',JSON.stringify(next),{onlyIf:{etagMatches:obj!.etag}});if(saved)song=next}}catch{}}
 return json({found:!!song.chart?.plainLyrics,lyrics:song.chart?.timedLyrics||[],source:song.chart?.source});
 }
 if(worker&&p[2]==='progress'&&method==='POST'){if(job.status!=='processing')error('Job is not processing',409);const raw:any=await req.json();const progress=safeProgress(raw);if(!progress)error('Invalid progress');const old=await bucket.get('processing/progress/'+job.id+'.json');const prior:any=old?await old.json():null;await bucket.put('processing/progress/'+job.id+'.json',JSON.stringify({lease:job.lease,progress:mergeProgress(prior?.lease===job.lease?prior.progress:undefined,progress!)}));return json({ok:true})}
 if(p[2]==='original'&&method==='GET'){const f=await bucket.get(base+'originals/'+job.id);if(!f)error('Original unavailable',404);return new Response(f!.body as any,{headers:{'Content-Type':f!.httpMetadata?.contentType||'audio/wav','Cache-Control':'private, no-store'}});}
 if(worker&&p[2]==='result'&&method==='PUT'){
 const cat=url.searchParams.get('category')||'';if(!['vocals','drums','bass','other'].includes(cat))error('Invalid model stem');const stid=job.id+'-'+cat;const upload=await audioStream(req,Math.ceil(limits(env).seconds*44100*8+1024*1024));
 await bucket.put(base+'audio/'+job.songId+'/'+stid,upload.stream as any,{httpMetadata:{contentType:'audio/wav'}});
 const st:Stem={id:stid,audioVersion:crypto.randomUUID(),name:cat,category:cat,filename:cat+'.wav',enabled:true,volume:.7,pan:0,offset:0,duration:Number(url.searchParams.get('duration')),sampleRate:Number(url.searchParams.get('sampleRate')),bytes:upload.size,source:'ai',status:'completed'};
 job.stems=[...job.stems.filter(s=>s.id!==stid),st];job.updated=Date.now();await write(job);return json({ok:true});
 }
 if(worker&&p[2]==='finish'&&method==='POST'){const b:any=await req.json();if(b.error){job.status='failed';job.error=String(b.error).slice(0,500)}else{if(job.stems.length!==4)error('Expected four stems');job.analysis=safeAnalysis(b.analysis,job.duration);if(b.analysis&&!job.analysis)error('Audio analysis invalid');job.status='completed';job.error=undefined;}if(job.analysis&&job.status==='completed'){for(let retry=0;retry<4;retry++){const obj=await bucket.get(base+'songs/'+job.songId+'.json');if(!obj)break;let song=applyAnalysis(await obj.json<Song>(),job.analysis);song.stems=[...song.stems.filter(st=>!job.stems.some(x=>x.id===st.id)).map(st=>st.source==='import'&&(st.name==='Full recording'||st.filename===job.filename)?{...st,enabled:false}:st),...job.stems];if(song.stems.length>24)break;const saved=await bucket.put(base+'songs/'+song.id+'.json',JSON.stringify(song),{onlyIf:{etagMatches:obj.etag}});if(saved){job.saved=true;break}}}job.updated=Date.now();await write(job);return json({ok:true});}
 if(!worker&&p[2]==='retry'&&method==='POST'){if(job.status!=='failed')error('Only failed jobs can be retried',409);job.status='queued';job.processingStarted=undefined;job.error=undefined;job.attempt++;job.updated=Date.now();job.lease=undefined;const ok=await bucket.put(jobkey(job.id),JSON.stringify(job),{onlyIf:{etagMatches:o.etag}});if(!ok)error('Job changed, refresh',409);return json(job);}
 if(!worker&&p[2]==='zip'&&method==='GET'){if(job.status!=='completed')error('Processing incomplete');const files=await Promise.all(job.stems.map(async st=>{const f=await bucket.get(base+'audio/'+job.songId+'/'+st.id);if(!f)error('Stem missing',404);return {name:st.filename,size:st.bytes,body:f!.body as ReadableStream<Uint8Array>}}));return new Response(streamZip(files),{headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename=stems.zip','Cache-Control':'private, no-store'}});}
 if(!worker&&p[2]==='audio'&&method==='GET'){const stem=job.stems.find(s=>s.id===url.searchParams.get('stem'));if(!stem)error('Stem unavailable',404);const f=await bucket.get(base+'audio/'+job.songId+'/'+stem!.id);return new Response(f!.body as any,{headers:{'Content-Type':'audio/wav','Cache-Control':'private, no-store'}});}
 if(!worker&&p[2]==='save'&&method==='POST'){if(job.status!=='completed')error('Processing incomplete');const obj=await bucket.get(base+'songs/'+job.songId+'.json');if(!obj)error('Song deleted',404);let s=await obj!.json<Song>();if(job.analysis)s=applyAnalysis(s,job.analysis);if(s.demo){s.demo=false;s.stems=s.stems.filter(st=>!st.id.startsWith('demo-'));}if(s.stems.length+job.stems.filter(st=>!s.stems.some(x=>x.id===st.id)).length>24)error('Maximum 24 stems');const input:any=await req.json();const selected=job.stems.map(st=>{const x=input.stems?.find((x:any)=>x.id===st.id)||st;return {...st,name:String(x.name||st.name).slice(0,100),category:['vocals','drums','bass','guitar','keyboards','backing vocals','other','click','spoken cues'].includes(x.category)?x.category:st.category,enabled:!!x.enabled,solo:!!x.solo,volume:Math.max(0,Math.min(1,Number(x.volume)||0)),pan:Math.max(-1,Math.min(1,Number(x.pan)||0)),offset:Math.max(-7200,Math.min(7200,Number(x.offset)||0))}});s.stems=[...s.stems.filter(st=>!selected.some(x=>x.id===st.id)).map(st=>st.source==='import'&&(st.name==='Full recording'||st.filename===job.filename)?{...st,enabled:false}:st),...selected];s.duration=Math.max(s.duration,...job.stems.map(st=>st.duration));const ok=await bucket.put(base+'songs/'+s.id+'.json',JSON.stringify(s),{onlyIf:{etagMatches:obj!.etag}});if(!ok)error('Song changed. Try again.',409);job.saved=true;job.stems=selected;await write(job);return json(s);}
 return json({error:'Unknown operation'},404);
 }catch(e:any){return json({error:e.message},e.status||500)}
}
