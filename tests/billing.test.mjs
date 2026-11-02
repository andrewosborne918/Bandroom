import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import Stripe from 'stripe';
import {PGlite} from '@electric-sql/pglite';
import {subscriptionState,BILLING_EVENTS,PLUS_STORAGE_BYTES} from '../lib/billing-policy.ts';
import {handleBillingWebhook} from '../lib/billing-webhook.ts';
import {closeBillingCustomer} from '../lib/close-billing.ts';
import {createStorageCheckout} from '../lib/storage-checkout.ts';
const now=Date.now(),future=Math.floor(now/1000)+86400;
const subscription=(patch={})=>({id:'sub_current',status:'active',latest_invoice:{status:'paid'},items:{data:[{price:{id:'price_plus'},quantity:1,current_period_end:future}]},...patch});
test('Plus requires an approved price, paid invoice, unpaused subscription and remaining period',()=>{
 assert.equal(subscriptionState([subscription()],['price_plus'],now).plus,true);
 for(const patch of [{status:'past_due'},{status:'canceled'},{status:'incomplete'},{pause_collection:{behavior:'void'}},{latest_invoice:{status:'open'}},{items:{data:[{price:{id:'price_foreign'},quantity:1,current_period_end:future}]}},{items:{data:[{price:{id:'price_plus'},quantity:2,current_period_end:future}]}},{items:{data:[{price:{id:'price_plus'},quantity:1,current_period_end:1}]}}])assert.equal(subscriptionState([subscription(patch)],['price_plus'],now).plus,false);
 assert.equal(subscriptionState([subscription({cancel_at_period_end:true})],['price_plus'],now).plus,true);
 assert.equal(subscriptionState([subscription({status:'canceled'}),subscription({id:'sub_new'})],['price_plus'],now).subscription,'sub_new');
});
const stripe=new Stripe('sk_test_unit_only'),secret='whsec_unit_only';
function event(type,object,extra={}){return {id:'evt_'+crypto.randomUUID(),object:'event',type,livemode:false,data:{object},...extra}}
function request(event,signature=true){const payload=JSON.stringify(event);return new Request('https://bndrm.test/api/billing/webhook',{method:'POST',body:payload,headers:{'stripe-signature':signature?stripe.webhooks.generateTestHeaderString({payload,secret}):'invalid'}})}
function dependencies(patch={}){return {stripe,secret,live:false,seen:async()=>false,sync:async()=>{},logReview:async()=>{},clearCheckout:async()=>{},...patch}}
test('webhook rejects forged signatures and wrong modes before touching billing data',async()=>{
 let called=false;const deps=dependencies({seen:async()=>{called=true;return false}});
 assert.equal((await handleBillingWebhook(request(event('invoice.paid',{customer:'cus_test'}),false),deps)).status,400);
 assert.equal((await handleBillingWebhook(request(event('invoice.paid',{customer:'cus_test'},{livemode:true})),deps)).status,400);
 assert.equal(called,false);
 assert.equal((await handleBillingWebhook(new Request('https://bndrm.test/',{method:'POST',body:'x'.repeat(1048577)}),deps)).status,413);
});
test('unpaid checkout never grants access and later async success resolves the Stripe customer',async()=>{
 const calls=[],deps=dependencies({sync:async(...args)=>calls.push(args)});
 await handleBillingWebhook(request(event('checkout.session.completed',{customer:'cus_band',payment_status:'unpaid'})),deps);assert.equal(calls.length,0);
 const success=event('checkout.session.async_payment_succeeded',{customer:{id:'cus_band'},payment_status:'paid'});
 assert.equal((await handleBillingWebhook(request(success),deps)).status,200);assert.equal(calls[0][0],'cus_band');assert.equal(calls[0][1].id,success.id);
});
test('renewal, failure and cancellation events resync authoritative state; retries survive partial expiry cleanup',async()=>{
 const calls=[],deps=dependencies({sync:async(customer,e)=>calls.push(e.type)});
 for(const type of ['invoice.paid','invoice.payment_failed','customer.subscription.deleted'])assert.equal((await handleBillingWebhook(request(event(type,{customer:'cus_band'})),deps)).status,200);
 assert.deepEqual(calls,['invoice.paid','invoice.payment_failed','customer.subscription.deleted']);
 assert.equal((await handleBillingWebhook(request(event('invoice.paid',{customer:'cus_band'})),dependencies({sync:async()=>{throw Error('database offline')}}))).status,500);
 let cleared=0;await handleBillingWebhook(request(event('checkout.session.expired',{id:'cs_old',customer:'cus_band'})),dependencies({seen:async()=>true,clearCheckout:async(c,s)=>{assert.equal(s,'cs_old');cleared++}}));assert.equal(cleared,1);
});
test('risk events use charge ownership, hold full refunds and retain partial refunds',async t=>{
 const holds=[];t.mock.method(stripe.charges,'retrieve',async id=>{assert.equal(id,'ch_owned');return {customer:'cus_band'}});
 const deps=dependencies({sync:async(c,e,review)=>holds.push([c,review])});
 for(const type of ['charge.dispute.created','radar.early_fraud_warning.created'])await handleBillingWebhook(request(event(type,{charge:'ch_owned',metadata:{band_id:'forged'}})),deps);
 await handleBillingWebhook(request(event('charge.refunded',{customer:'cus_band',amount:800,amount_refunded:800})),deps);
 await handleBillingWebhook(request(event('charge.refunded',{customer:'cus_band',amount:800,amount_refunded:100})),deps);
 assert.deepEqual(holds,[['cus_band',true],['cus_band',true],['cus_band',true],['cus_band',false]]);
 assert.ok(BILLING_EVENTS.includes('charge.dispute.created'));
});
test('workspace deletion expires checkout and cancels every renewable subscription without extra charges',async t=>{
 const calls=[];
 t.mock.method(stripe.checkout.sessions,'retrieve',async()=>({status:'open'}));
 t.mock.method(stripe.checkout.sessions,'expire',async id=>{calls.push(['expire',id])});
 t.mock.method(stripe.subscriptions,'list',()=>({async *[Symbol.asyncIterator](){yield {id:'sub_active',status:'active'};yield {id:'sub_old',status:'canceled'};yield {id:'sub_incomplete',status:'incomplete'}}}));
 t.mock.method(stripe.subscriptions,'cancel',async(id,options)=>{calls.push(['cancel',id,options])});
 await closeBillingCustomer(stripe,'cus_band','cs_pending');
 assert.deepEqual(calls,[['expire','cs_pending'],['cancel','sub_active',{invoice_now:false,prorate:false}],['cancel','sub_incomplete',{invoice_now:false,prorate:false}]]);
});
test('Checkout uses the server price and stable attempt key, with hosted subscription payment methods',async t=>{
 const calls=[];t.mock.method(stripe.checkout.sessions,'create',async(...args)=>{calls.push(args);return {id:'cs_test',url:'https://checkout.stripe.com/test'}});
 const options={customer:'cus_band',price:'price_plus',attempt:crypto.randomUUID(),origin:'https://bndrm.test',tax:false};
 await createStorageCheckout(stripe,options);await createStorageCheckout(stripe,options);
 assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0][0].mode,'subscription');assert.equal(calls[0][0].line_items[0].price,'price_plus');
 assert.equal('payment_method_types' in calls[0][0],false);assert.equal('automatic_tax' in calls[0][0],false);
 assert.match(calls[0][0].integration_identifier,/bndrm_storage_[a-z]{8}$/);
});
const db=new PGlite();await db.exec(readFileSync('tests/supabase-stubs.sql','utf8'));
for(const f of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));
const owner=crypto.randomUUID();await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[owner,'owner@billing.test']);
async function user(q,p=[]){await db.exec("reset role;select set_config('request.jwt.claim.sub','"+owner+"',false);set role authenticated");return db.query(q,p)}
async function service(q,p=[]){await db.exec('reset role');return db.query(q,p)}
const band=(await user("select create_band('Billing test') id")).rows[0].id;
async function sync(customer,state='active',plus=true,review=false,observed=new Date(),id=crypto.randomUUID()){
 return service("select sync_band_billing($1,'sub_test',$2,'price_plus',$3,false,$4,$5,$6,'invoice.paid',$7)",[customer,state,new Date(Date.now()+86400000).toISOString(),plus,observed.toISOString(),id,review]);
}
async function limit(){return (await service('select storage_limit,plan from entitlements where band_id=$1',[band])).rows[0]}
test('only service can manage billing; sandbox subscriptions cannot enlarge production storage',async()=>{
 await service("insert into band_billing(band_id,livemode,customer_id) values($1,false,'cus_sandbox'),($1,true,'cus_live')",[band]);
 await assert.rejects(user('select * from band_billing'),/permission denied/);
 await assert.rejects(user("select billing_checkout_attempt($1,'month',true)",[band]),/permission denied/);
 await assert.rejects(user("select sync_band_billing('cus_live','forged','active','price_plus',now()+interval '1 year',false,true,now(),'forged','invoice.paid',false)"),/permission denied/);
 await sync('cus_sandbox');assert.equal(Number((await limit()).storage_limit),2*1024**3);
 await sync('cus_live');assert.equal(Number((await limit()).storage_limit),PLUS_STORAGE_BYTES);
});
test('checkout retries reuse one attempt and cannot open two billing intervals',async()=>{
 const first=(await service("select billing_checkout_attempt($1,'month',true) id",[band])).rows[0].id;
 assert.equal((await service("select billing_checkout_attempt($1,'month',true) id",[band])).rows[0].id,first);
 await assert.rejects(service("select billing_checkout_attempt($1,'year',true)",[band]),/Cancel the pending/);
 assert.notEqual((await service("select billing_checkout_attempt($1,'year',false) id",[band])).rows[0].id,first);
});
test('stale and duplicate events cannot overwrite newer state; payment failure preserves audio and personal overrides',async()=>{
 const newest=new Date(Date.now()+5000),older=new Date(Date.now()-5000),id='evt_idempotent';
 await service('update band_usage set stored_bytes=$2 where band_id=$1',[band,3*1024**3]);
 await sync('cus_live','past_due',false,false,newest,id);assert.equal(Number((await limit()).storage_limit),2*1024**3);
 await sync('cus_live','active',true,false,older);assert.equal((await limit()).plan,'free');
 await sync('cus_live','active',true,false,new Date(Date.now()+10000),id);assert.equal((await limit()).plan,'free');
 assert.equal(Number((await service('select stored_bytes from band_usage where band_id=$1',[band])).rows[0].stored_bytes),3*1024**3);
 await service("insert into storage_account_overrides(user_id,storage_limit,plan) values($1,null,'personal')",[owner]);
 await sync('cus_live','canceled',false);assert.equal((await limit()).storage_limit,null);
 await service('delete from storage_account_overrides where user_id=$1',[owner]);
});
test('risk holds persist through renewals and expired periods fall back to free',async()=>{
 await sync('cus_live','active',true,true,new Date(Date.now()+15000));assert.equal((await limit()).plan,'free');
 await sync('cus_live','active',true,false,new Date(Date.now()+20000));assert.equal((await limit()).plan,'free');
 await service("update band_billing set review_required=false,period_end=now()-interval '1 second' where customer_id='cus_live'");
 await service('select apply_account_storage($1)',[band]);assert.equal((await limit()).plan,'free');
});
test('expired paid allowance cannot be used for new uploads even before daily maintenance',async()=>{
 await service("update band_billing set has_plus=true,review_required=false,period_end=now()-interval '1 second' where customer_id='cus_live'");
 await service("update entitlements set storage_limit=$2,plan='plus' where band_id=$1",[band,PLUS_STORAGE_BYTES]);
 const song=crypto.randomUUID();await user('insert into songs(id,band_id,data,created_by) values($1,$2,$3,$4)',[song,band,JSON.stringify({id:song,title:'Expiry check',stems:[],sections:[]}),owner]);
 await assert.rejects(user("select reserve_upload($1,$2,$3,$4,'new.mp3',1000,2,44100,'original')",[band,song,crypto.randomUUID(),crypto.randomUUID()]),/Storage allowance exceeded/);
});
test('an operator can clear only the exact risk event reviewed, and ordinary users cannot clear holds',async()=>{
 const risk='evt_risk_latest';await sync('cus_live','active',true,true,new Date(Date.now()+30000),risk);
 await assert.rejects(user('select resolve_billing_review($1,true,$2)',[band,risk]),/permission denied/);
 await assert.rejects(service("select resolve_billing_review($1,true,'older_event')",[band]),/review changed/);
 await service('select resolve_billing_review($1,true,$2)',[band,risk]);assert.equal((await limit()).plan,'plus');
});
test('closing a workspace blocks in-flight checkout and direct deletion until provider cancellation is confirmed',async()=>{
 const attempt=(await service("select billing_checkout_attempt($1,'month',true) id",[band])).rows[0].id;
 assert.equal((await service("select store_billing_checkout($1,true,$2,'cs_before') stored",[band,attempt])).rows[0].stored,true);
 await service('update bands set billing_closing=true where id=$1',[band]);
 await assert.rejects(service("select billing_checkout_attempt($1,'month',true)",[band]),/Workspace is closing/);
 assert.equal((await service("select store_billing_checkout($1,true,$2,'cs_after') stored",[band,attempt])).rows[0].stored,false);
 await assert.rejects(user('select delete_band($1)',[band]),/Cancel billing through the app/);
 assert.equal((await user('update bands set billing_closed=true where id=$1 returning id',[band])).rows.length,0);assert.equal((await service('select billing_closed from bands where id=$1',[band])).rows[0].billing_closed,false);
 await service('update bands set billing_closed=true where id=$1',[band]);await user('select delete_band($1)',[band]);
 assert.equal((await service('select * from band_billing where band_id=$1',[band])).rows.length,0);
});
test.after(()=>db.close());
