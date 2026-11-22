import {admin} from './clients';

export const UNLIMITED_SECONDS=2000000000;
export const UNLIMITED_FILE_BYTES=10737418240;
export const UNLIMITED_MEMBERS=1000000;

export function isApplicationOwner(userId:string|undefined|null){
 if(!userId)return false;
 return (process.env.APPLICATION_OWNER_IDS||'').split(',').map(s=>s.trim()).filter(Boolean).includes(userId);
}

export async function grantBandUnlimited(bandId:string,ownerUserId?:string){
 const db=admin();
 if(ownerUserId){
  await db.from('storage_account_overrides').upsert({user_id:ownerUserId,storage_limit:null,plan:'personal'},{onConflict:'user_id'});
 }
 const {data:cfg}=await db.from('platform_config').select('monthly_ai_seconds_cap').eq('id',true).maybeSingle();
 if(cfg&&Number(cfg.monthly_ai_seconds_cap)<UNLIMITED_SECONDS){
  await db.from('platform_config').update({monthly_ai_seconds_cap:UNLIMITED_SECONDS}).eq('id',true);
 }
 // Prefer NULL (= unlimited) if the SQL migration has been applied; otherwise fall back to high numeric ceilings.
 const nulled=await db.from('entitlements').update({
  storage_limit:null,
  file_limit:null,
  ai_seconds_limit:null,
  ai_monthly_seconds:null,
  member_limit:null,
  active_jobs_limit:null,
  plan:'personal',
 }).eq('band_id',bandId);
 if(nulled.error){
  const raised=await db.from('entitlements').update({
   storage_limit:null,
   file_limit:UNLIMITED_FILE_BYTES,
   ai_seconds_limit:UNLIMITED_SECONDS,
   ai_monthly_seconds:UNLIMITED_SECONDS,
   member_limit:UNLIMITED_MEMBERS,
   active_jobs_limit:10,
   plan:'personal',
  }).eq('band_id',bandId);
  if(raised.error)throw raised.error;
 }
}

export async function ensureOwnerUnlimited(bandId:string,userId:string,role:string){
 if(role!=='owner')return;
 const db=admin();
 let isOwner=isApplicationOwner(userId);
 if(!isOwner){
  const {data:inv}=await db.from('invitation_owners').select('user_id').eq('user_id',userId).maybeSingle();
  isOwner=!!inv;
 }
 if(!isOwner)return;
 const [{data:e},{data:c}]=await Promise.all([
  db.from('entitlements').select('plan,storage_limit,ai_monthly_seconds,ai_seconds_limit,file_limit').eq('band_id',bandId).maybeSingle(),
  db.from('platform_config').select('monthly_ai_seconds_cap').eq('id',true).maybeSingle(),
 ]);
 const bandOk=e&&e.plan==='personal'&&e.storage_limit===null
  &&(e.ai_monthly_seconds===null||Number(e.ai_monthly_seconds)>=UNLIMITED_SECONDS)
  &&(e.ai_seconds_limit===null||Number(e.ai_seconds_limit)>=UNLIMITED_SECONDS)
  &&(e.file_limit===null||Number(e.file_limit)>=UNLIMITED_FILE_BYTES);
 const globalOk=!c||Number(c.monthly_ai_seconds_cap)>=UNLIMITED_SECONDS;
 if(bandOk&&globalOk)return;
 await grantBandUnlimited(bandId,userId);
}
