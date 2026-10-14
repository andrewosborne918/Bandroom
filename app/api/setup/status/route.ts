import {admin,json} from '../../../../lib/cloud/clients';
export const dynamic='force-dynamic';
export async function GET(){
 const checks={accounts:!!process.env.NEXT_PUBLIC_SUPABASE_URL&&!!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,serverAccess:!!process.env.SUPABASE_SERVICE_ROLE_KEY,audioStorage:process.env.AUDIO_STORAGE==='r2'&&!!process.env.R2_ENDPOINT&&!!process.env.R2_BUCKET&&!!process.env.R2_ACCESS_KEY_ID&&!!process.env.R2_SECRET_ACCESS_KEY,database:false,workerCredentials:true,workerOnline:false,owner:!!process.env.APPLICATION_OWNER_IDS};
 if(checks.accounts&&checks.serverAccess){try{const {data,error}=await admin().from('processor_devices').select('last_seen').is('revoked_at',null).limit(100);checks.database=!error;checks.workerOnline=!!data?.some(d=>Date.now()-new Date(d.last_seen||0).getTime()<90000)}catch{}}
 return json({ready:checks.accounts&&checks.serverAccess&&checks.audioStorage&&checks.database&&checks.workerCredentials,checks});
}
