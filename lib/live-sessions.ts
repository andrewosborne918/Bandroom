export type LiveSession = {code:string;name:string;status:string;devices:number};

// Uses the signed-in member's client; both queries retain existing session RLS.
export async function liveSessions(db:any,bandId:string,now=Date.now()):Promise<LiveSession[]>{
  const {data:sessions,error}=await db.from('playback_sessions')
    .select('id,code,data').eq('band_id',bandId).gt('expires_at',new Date(now).toISOString())
    .order('created_at',{ascending:false}).limit(20);
  if(error)throw error;
  if(!sessions?.length)return [];
  const {data:devices,error:deviceError}=await db.from('session_devices')
    .select('session_id').in('session_id',sessions.map((s:any)=>s.id))
    .gt('last_seen',new Date(now-45000).toISOString());
  if(deviceError)throw deviceError;
  const counts=new Map<string,number>();
  for(const device of devices||[])counts.set(device.session_id,(counts.get(device.session_id)||0)+1);
  return sessions.filter((s:any)=>counts.has(s.id)).map((s:any)=>({
    code:s.code,name:s.data.name||'Band rehearsal',status:s.data.transport?.status||'stopped',devices:counts.get(s.id)!
  }));
}
