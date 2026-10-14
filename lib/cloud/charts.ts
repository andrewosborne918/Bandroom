import {chartApi} from '../chart-api';
import {result,problem} from './clients';

export async function cloudCharts(req:Request,ctx:any):Promise<Response|null>{
 const p=new URL(req.url).pathname.split('/').filter(Boolean).slice(2);if(p[0]!=='charts')return null;
 if(!['owner','admin','editor'].includes(ctx.role))problem('Editor permission required',403);
 const row=await result(ctx.db.from('songs').select('data,revision').eq('id',p[1]).eq('band_id',ctx.bandId).single());
 // The chart lookup/parser is shared with rehearsal hosting; this adapter gives
 // it a revision-checked database record rather than a platform object bucket.
 const key='songs/'+p[1]+'.json';const store={
  get:async(k:string)=>k===key?{etag:String(row.revision),json:async()=>row.data}:null,
  put:async(k:string,value:string,options:any)=>{if(k!==key)return {};if(options?.onlyIf?.etagMatches!==String(row.revision))return null;
   const rows=await result(ctx.db.from('songs').update({data:JSON.parse(value),revision:Number(row.revision)+1,updated_at:new Date().toISOString()}).eq('id',p[1]).eq('band_id',ctx.bandId).eq('revision',row.revision).select('id'));
   return rows.length?{}:null;
  },
 };
 return chartApi(req,store as unknown as R2Bucket,'');
}
