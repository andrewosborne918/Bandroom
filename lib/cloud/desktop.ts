import {randomBytes} from 'node:crypto';
import {admin,workspace,result,json,problem,origin} from './clients';
import {sha} from './platform-api';
const codeValue=(v:unknown)=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
export async function processorIdentity(req:Request){
 const token=req.headers.get('authorization')?.replace(/^Bearer /,'')||'';
 if(!/^[a-f0-9]{64}$/.test(token))problem('Connect Bndrm Desktop to your band first',403);
 const db=admin();const {data:d}=await db.from('processor_devices').select('*').eq('token_hash',await sha(token)).is('revoked_at',null).maybeSingle();
 if(!d)problem('Processor connection revoked. Connect again in Bndrm Desktop.',403);
 const [{data:m},{data:b}]=await Promise.all([db.from('band_memberships').select('role').eq('user_id',d.user_id).eq('band_id',d.band_id).maybeSingle(),db.from('bands').select('suspended').eq('id',d.band_id).maybeSingle()]);
 if(!m||!['owner','admin','editor'].includes(m.role)||!b||b.suspended)problem('Processor permission ended',403);
 return {id:d.id,bandId:d.band_id};
}
async function body(req:Request){if(Number(req.headers.get('content-length')||0)>8192)problem('Request too large',413);const raw=await req.text();if(raw.length>8192)problem('Request too large',413);try{return JSON.parse(raw)}catch{problem('Invalid request')}}
export async function desktopApi(req:Request){try{
 const p=new URL(req.url).pathname.split('/').filter(Boolean).slice(2);origin(req);
 if(p[0]==='pair'&&req.method==='POST'){
  const b=await body(req);const secret=randomBytes(32).toString('hex'),code=randomBytes(5).toString('hex').toUpperCase();
  const ip=req.headers.get('x-vercel-forwarded-for')||req.headers.get('x-forwarded-for')||'local';
  const pair=await result<any>(admin().rpc('start_desktop_pair',{ip_hash:await sha(ip.split(',')[0]),device_name:String(b.name||'My computer'),device_platform:String(b.platform||'desktop'),poll_hash:await sha(secret),code_hash:await sha(code)}).single());
  return json({id:pair.id,deviceSecret:secret,userCode:code,verificationUrl:(process.env.APP_ORIGIN||'https://bndrm.vercel.app')+'/?desktop='+code,expiresAt:pair.expires_at},201);
 }
 if(p[0]==='poll'&&req.method==='POST'){
  const b=await body(req);if(!/^[a-f0-9]{64}$/.test(b.deviceSecret||'')||!/^[-a-f0-9]{36}$/.test(b.id||''))problem('Invalid connection',403);
  const {data:pair}=await admin().from('desktop_pairings').select('*').eq('id',b.id).eq('poll_hash',await sha(b.deviceSecret)).maybeSingle();
  if(!pair||new Date(pair.expires_at).getTime()<Date.now())problem('Connection expired. Start again.',410);
  if(!pair.device_id)return json({approved:false});
  const {data:d}=await admin().from('processor_devices').select('id').eq('id',pair.device_id).is('revoked_at',null).maybeSingle();if(!d)problem('Connection revoked',403);
  const band=await result(admin().from('bands').select('name').eq('id',pair.band_id).single());return json({approved:true,bandId:pair.band_id,bandName:band.name});
 }
 const {bandId,user}=await workspace(req,true),db=admin();
 if(p[0]==='approve'&&req.method==='POST'){const b=await body(req),code=codeValue(b.code);if(!/^[A-F0-9]{10}$/.test(code))problem('Enter the 10-character desktop connection code');const id=await result(db.rpc('approve_desktop_pair',{code_hash:await sha(code),b:bandId,actor:user.id}));return json({id})}
 if(p[0]==='devices'&&req.method==='GET'){const devices=await result(db.from('processor_devices').select('id,name,platform,last_seen,health,created_at').eq('band_id',bandId).is('revoked_at',null).order('created_at',{ascending:false}));return json({devices})}
 if(p[0]==='revoke'&&req.method==='POST'){const b=await body(req);await result(db.from('processor_devices').update({revoked_at:new Date().toISOString()}).eq('band_id',bandId).eq('id',b.id));return json({ok:true})}
 return json({error:'Unknown desktop operation'},404);
}catch(e:any){return json({error:e.status?e.message:'Desktop connection failed. Try again.'},e.status||500)}}
