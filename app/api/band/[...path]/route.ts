import {handleBand} from '../../../../lib/band-api';
import {cloudBand} from '../../../../lib/cloud/band';
export const dynamic='force-dynamic';
export const maxDuration=60;
const handler=async(request:Request)=>{
 if(process.env.APP_PLATFORM==='supabase')return cloudBand(request);
 // Webpack ignores this platform-specific module on the Vercel path. Vite resolves it on Sites.
 const {env}=await import(/* webpackIgnore: true */ 'cloudflare:workers');
 return handleBand(request,(env as unknown as {BUCKET:R2Bucket}).BUCKET,env as any);
};
export const GET=handler;export const POST=handler;export const PUT=handler;export const DELETE=handler;
