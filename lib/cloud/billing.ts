import Stripe from 'stripe';
import {admin,result,json,problem,workspace,origin} from './clients';
import {subscriptionState} from '../billing-policy';
import {handleBillingWebhook} from '../billing-webhook';
import {closeBillingCustomer} from '../close-billing';
import {createStorageCheckout} from '../storage-checkout';

export function stripeClient(){if(!process.env.STRIPE_SECRET_KEY)problem('Billing is not connected yet',503);return new Stripe(process.env.STRIPE_SECRET_KEY!,{maxNetworkRetries:2,timeout:15000})}
export function billingConfig(){
 const key=process.env.STRIPE_SECRET_KEY||'',live=key.includes('_live_');
 const configured=!!key&&!!process.env.STRIPE_WEBHOOK_SECRET&&!!process.env.STRIPE_PLUS_MONTHLY_PRICE&&!!process.env.STRIPE_PLUS_ANNUAL_PRICE;
 return {live,available:configured&&live&&process.env.BILLING_LIVE_ENABLED==='true',test:!!key&&!live};
}
const priceIds=()=>[process.env.STRIPE_PLUS_MONTHLY_PRICE!,process.env.STRIPE_PLUS_ANNUAL_PRICE!];
export async function syncCustomer(customer:string,event?:{id:string;type:string},review=false){
 const db=admin(),observed=new Date().toISOString();
 const account=await result(db.from('band_billing').select('band_id,livemode').eq('customer_id',customer).maybeSingle());
 if(!account)return;if(account.livemode!==billingConfig().live)throw Error('Billing mode mismatch');
 const subscriptions=await stripeClient().subscriptions.list({customer,status:'all',limit:100,expand:['data.latest_invoice']});
 const state=subscriptionState(subscriptions.data,priceIds());
 await result(db.rpc('sync_band_billing',{customer,...state,observed,event_id:event?.id||null,event_kind:event?.type||'billing.refresh',review}));
}
async function ensureAccount(bandId:string){
 const db=admin();let account=await result(db.from('band_billing').select('*').eq('band_id',bandId).eq('livemode',billingConfig().live).maybeSingle());
 if(!account){
  const customer=await stripeClient().customers.create({description:'Bndrm band subscription'},{idempotencyKey:'bndrm-band-'+bandId+'-'+billingConfig().live});
  await result(db.from('band_billing').upsert({band_id:bandId,livemode:billingConfig().live,customer_id:customer.id},{onConflict:'band_id,livemode',ignoreDuplicates:true}));
  account=await result(db.from('band_billing').select('*').eq('band_id',bandId).eq('livemode',billingConfig().live).single());
 }
 return account;
}
export async function cancelBandBilling(bandId:string){
 await result(admin().from('bands').update({billing_closing:true}).eq('id',bandId));
 const accounts=await result(admin().from('band_billing').select('customer_id,livemode,checkout_session_id').eq('band_id',bandId));
 for(const account of accounts){
  if(account.livemode!==billingConfig().live){
   if(account.livemode)problem('Live billing must be connected before deleting this paid workspace',409);
   continue;
  }
  await closeBillingCustomer(stripeClient(),account.customer_id,account.checkout_session_id);
 }
 await result(admin().from('bands').update({billing_closed:true}).eq('id',bandId));
}
export async function billingApi(req:Request):Promise<Response>{
 try{
  origin(req);if(!['GET','POST'].includes(req.method))return json({error:'Method not allowed'},405);const {db,bandId,role,user}=await workspace(req);
  await result(db.rpc('admit_band_request',{b:bandId,scope:req.method==='GET'?'read':'write'}));
  const config=billingConfig(),service=admin();
  if(req.method==='GET'){
   const account=await result(service.from('band_billing').select('status,period_end,cancel_at_period_end,review_required,checkout_attempt').eq('band_id',bandId).eq('livemode',billingConfig().live).maybeSingle());
   return json({...config,status:account?.status||'none',periodEnd:account?.period_end,cancels:!!account?.cancel_at_period_end,review:!!account?.review_required,pending:!!account?.checkout_attempt,canManage:role==='owner'});
  }
  if(role!=='owner')problem('Only the band owner can manage its subscription',403);
  const action=new URL(req.url).pathname.split('/').at(-1),body:any=await req.json();
  if(action==='refresh'){
   const a=await result(service.from('band_billing').select('customer_id').eq('band_id',bandId).eq('livemode',billingConfig().live).maybeSingle());
   if(a)await syncCustomer(a.customer_id);
   return json({ok:true});
  }
  if(!['checkout','portal','cancel-checkout'].includes(action||''))problem('Unknown billing operation',404);
  const isOwner=(process.env.APPLICATION_OWNER_IDS||'').split(',').includes(user.id);
  if(action==='checkout'&&!config.available&&!(config.test&&isOwner&&process.env.BILLING_SANDBOX_ENABLED==='true'))problem('Paid upgrades are being prepared. Checkout is not open yet.',503);
  const account=action==='checkout'?await ensureAccount(bandId):await result(service.from('band_billing').select('*').eq('band_id',bandId).eq('livemode',config.live).maybeSingle());
  if(!account)problem('No billing account exists for this band yet',409);
  const stripe=stripeClient();
  const appOrigin=process.env.APP_ORIGIN||new URL(req.url).origin;
  if(action==='portal'){
   const session=await stripe.billingPortal.sessions.create({customer:account.customer_id,return_url:appOrigin+'/?billing=return',...(process.env.STRIPE_PORTAL_CONFIGURATION?{configuration:process.env.STRIPE_PORTAL_CONFIGURATION}:{})});
   return json({url:session.url});
  }
  if(action==='cancel-checkout'){
   if(account.checkout_session_id){const session=await stripe.checkout.sessions.retrieve(account.checkout_session_id);if(session.status==='open')await stripe.checkout.sessions.expire(session.id);else if(session.status==='complete')await syncCustomer(account.customer_id)}
   await result(service.from('band_billing').update({checkout_attempt:null,checkout_session_id:null,checkout_interval:null}).eq('band_id',bandId).eq('livemode',config.live).eq('checkout_attempt',account.checkout_attempt));
   return json({ok:true});
  }
  if(action!=='checkout')problem('Unknown billing operation',404);
  if(!['month','year'].includes(body.interval))problem('Choose monthly or annual billing');
  const entitlement=await result(service.from('entitlements').select('storage_limit').eq('band_id',bandId).single());
  if(entitlement.storage_limit===null)problem('Your band already has unlimited storage',409);
  await syncCustomer(account.customer_id);
  const current=await result(service.from('band_billing').select('has_plus,review_required,status').eq('band_id',bandId).eq('livemode',billingConfig().live).single());
  if(current.review_required)problem('Billing needs an account review before upgrading',409);
  if(current.status==='incomplete')problem('An existing subscription needs payment confirmation. Use Manage billing.',409);
  if(current.has_plus)problem('This band already has Plus. Use Manage billing.',409);
  const attempt:string=await result<any>(service.rpc('billing_checkout_attempt',{b:bandId,period:body.interval,live:config.live}));
  const session=await createStorageCheckout(stripe,{customer:account.customer_id,price:body.interval==='year'?priceIds()[1]:priceIds()[0],attempt,origin:appOrigin,tax:process.env.STRIPE_TAX_ENABLED==='true'});
  const stored=await result(service.rpc('store_billing_checkout',{b:bandId,live:config.live,attempt,session:session.id}));
  if(!stored){if(session.status==='open')await stripe.checkout.sessions.expire(session.id);problem('This workspace is closing. Checkout was canceled.',409)}
  if(session.status==='expired')problem('This checkout expired. Cancel the pending checkout and try again.',409);
  if(session.status==='complete')problem('This checkout is complete. Refresh billing status.',409);
  return json({url:session.url,test:config.test});
 }catch(e:any){return json({error:e.status?e.message:'Billing could not be completed. Please try again.'},e.status||502)}
}
export async function billingWebhook(req:Request){
 if(!process.env.STRIPE_SECRET_KEY||!process.env.STRIPE_WEBHOOK_SECRET)return json({error:'Webhook is not configured'},503);
 const db=admin();return handleBillingWebhook(req,{
  stripe:stripeClient(),secret:process.env.STRIPE_WEBHOOK_SECRET,live:billingConfig().live,
  seen:async id=>!!await result(db.from('billing_events').select('id').eq('id',id).maybeSingle()),
  sync:syncCustomer,
  logReview:async event=>{await result(db.from('operation_events').insert({environment:process.env.APP_ENV||'unknown',kind:'billing.review_required',details:{eventId:event.id,eventType:event.type}}))},
  clearCheckout:async(customer,session)=>{await result(db.from('band_billing').update({checkout_attempt:null,checkout_interval:null,checkout_session_id:null}).eq('customer_id',customer).eq('checkout_session_id',session))},
 });
}
