import type Stripe from 'stripe';
import {BILLING_EVENTS,stripeId} from './billing-policy.ts';
type Dependencies={
 stripe:Stripe; secret:string; live:boolean;
 seen:(id:string)=>Promise<boolean>;
 sync:(customer:string,event:{id:string;type:string},review:boolean)=>Promise<void>;
 logReview:(event:{id:string;type:string})=>Promise<void>;
 clearCheckout:(customer:string,session:string)=>Promise<void>;
};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function handleBillingWebhook(req:Request,deps:Dependencies){
 if(!deps.secret)return json({error:'Webhook is not configured'},503);
 let event:Stripe.Event;
 try{
  // Bound even chunked requests before retaining the full payload.
  const reader=req.body?.getReader(),chunks:Uint8Array[]=[];let length=0;
  if(reader){while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>1048576){await reader.cancel();return json({error:'Payload too large'},413)}chunks.push(value)}}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  event=deps.stripe.webhooks.constructEvent(new TextDecoder().decode(bytes),req.headers.get('stripe-signature')||'',deps.secret);
 }catch{return json({error:'Invalid webhook signature'},400)}
 if(event.livemode!==deps.live)return json({error:'Wrong billing environment'},400);
 if(!BILLING_EVENTS.includes(event.type))return json({received:true});
 try{
  const object:any=event.data.object;let customer=stripeId(object.customer),review=false;
  if(await deps.seen(event.id)){
   if(event.type==='checkout.session.expired'&&customer)await deps.clearCheckout(customer,object.id);
   return json({received:true});
  }
  if(event.type==='charge.dispute.created'||event.type==='radar.early_fraud_warning.created'){
   const id=stripeId(object.charge);if(!id)throw Error('Missing charge');
   customer=stripeId((await deps.stripe.charges.retrieve(id)).customer);review=true;
  }else if(event.type==='charge.refunded')review=!!object.refunded||object.amount>0&&object.amount_refunded>=object.amount;
  if(customer){
   if(event.type==='checkout.session.completed'&&object.payment_status==='unpaid')return json({received:true});
   await deps.sync(customer,event,review);
   if(review)await deps.logReview(event);
   // Repeated expiry events must be able to finish this harmless cleanup even
   // after subscription sync committed; the adapter also matches session ID.
   if(event.type==='checkout.session.expired')await deps.clearCheckout(customer,object.id);
  }
  return json({received:true});
 }catch{return json({error:'Billing update failed; retry required'},500)}
}
