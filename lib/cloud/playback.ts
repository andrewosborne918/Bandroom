import {admin,result,json,problem} from './clients';
import {storage} from './storage';
import {sha} from './platform-api';
import {playbackIndex} from '../packed-audio';
export async function claimPlayback(bandId:string,lease:string){
 const job=await result<any>(admin().rpc('claim_audio_playback',{b:bandId,hash:await sha(lease)}));return job?{...job,lease}:null;
}
export async function playbackOperation(req:Request,p:string[],processor:{bandId:string;id:string}){
 const db=admin(),url=new URL(req.url),id=p[1]==='heartbeat'?url.searchParams.get('job'):p[1],hash=await sha(req.headers.get('x-job-lease')||'');
 const job=await result<any>(db.from('audio_playbacks').select('*').eq('asset_id',id).eq('band_id',processor.bandId).single());
 if(job.lease_hash!==hash)problem('Playback job reassigned',409);
 if(p[2]==='resume'&&job.state==='ready')return json({completed:true});
 if(job.state!=='processing'||new Date(job.lease_expires_at).getTime()<Date.now())problem('Playback job ended',409);
 if(p[1]==='heartbeat'||p[2]==='resume'){await result(db.from('processor_devices').update({last_seen:new Date().toISOString()}).eq('id',processor.id).eq('band_id',processor.bandId));await result(db.from('audio_playbacks').update({lease_expires_at:new Date(Date.now()+600000).toISOString()}).eq('asset_id',job.asset_id).eq('lease_hash',hash).eq('state','processing'));return json({resumed:true})}
 const asset=await result<any>(db.from('audio_assets').select('*').eq('id',id).eq('band_id',processor.bandId).eq('status','verified').single());
 if(p[2]==='input-url'){const link=await result(storage(asset.bucket).createSignedUrl(asset.object_key,300));return json({url:link.signedUrl})}
 if(p[2]==='output-url'&&req.method==='POST'){const b:any=await req.json();if(!Number.isSafeInteger(b.bytes)||b.bytes<=0||b.bytes>job.reserved_bytes)problem('Playback exceeds reservation');await result(db.from('cleanup_jobs').upsert({band_id:processor.bandId,bucket:'stems',object_key:job.object_key,next_attempt_at:new Date(Date.now()+86400000).toISOString()},{onConflict:'bucket,object_key',ignoreDuplicates:true}));return json(await result(storage('stems').createSignedUploadUrl(job.object_key,{upsert:true,bytes:b.bytes})))}
 if(p[2]==='finish'&&req.method==='POST'){const b:any=await req.json();if(!b.error){const info=await result(storage('stems').info(job.object_key));if(Number(info.size)!==b.bytes||b.bytes>job.reserved_bytes)problem('Playback size mismatch');const signed=await result(storage('stems').createSignedUrl(job.object_key,60));const index=await playbackIndex(async(start,end)=>{const response=await fetch(signed.signedUrl,{headers:{Range:`bytes=${start}-${end}`},signal:AbortSignal.timeout(15000)});if(response.status!==206)problem('Playback index unavailable');const data=await response.arrayBuffer();if(data.byteLength!==end-start+1)problem('Invalid playback index');return data},b.bytes);if(Math.abs(index.frames/index.sampleRate-asset.duration)>.15)problem('Playback timing does not match the original');}
 await result(db.rpc('finish_audio_playback',{asset:id,hash,size:b.error?0:b.bytes,job_error:b.error?String(b.error).slice(0,300):null}));return json({ok:true})}
 return json({error:'Unknown playback preparation operation'},404);
}
