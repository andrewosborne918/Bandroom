// Run with: node --env-file=.env.local scripts/setup-billing.mjs
// Writes credentials only to the ignored local environment file.
import Stripe from 'stripe';
import {readFileSync,writeFileSync} from 'node:fs';
import {BILLING_EVENTS} from '../lib/billing-policy.ts';
const key=process.env.STRIPE_SECRET_KEY;
if(!key)throw Error('Pull the connected Stripe environment first.');
if(key.includes('_live_')&&!process.argv.includes('--live'))throw Error('Live setup requires the explicit --live flag.');
const stripe=new Stripe(key);
const origin=process.env.APP_ORIGIN||'https://bndrm.vercel.app';
let product;
try{product=await stripe.products.retrieve('bndrm_plus')}catch(e){if(e.statusCode!==404)throw e;product=await stripe.products.create({id:'bndrm_plus',name:'Bndrm Plus',description:'25 GiB of shared band storage for recordings, stems and temporary exports.'},{idempotencyKey:'bndrm-plus-product-v1'})}
const prices={};
for(const [period,amount] of [['month',800],['year',8000]]){
 const lookup='bndrm_plus_'+period+'_usd_v1';
 const existing=await stripe.prices.list({lookup_keys:[lookup],limit:1});
 prices[period]=existing.data[0]||await stripe.prices.create({product:product.id,currency:'usd',unit_amount:amount,recurring:{interval:period},lookup_key:lookup,tax_behavior:'exclusive'},{idempotencyKey:lookup});
 if(prices[period].unit_amount!==amount||prices[period].currency!=='usd')throw Error('Existing price differs from the chosen plan.');
}
let portal=(await stripe.billingPortal.configurations.list({limit:100})).data.find(p=>p.metadata?.bndrm==='storage-v1');
if(!portal)portal=await stripe.billingPortal.configurations.create({
 business_profile:{headline:'Manage your Bndrm Plus subscription'},default_return_url:origin+'/?billing=return',
 features:{invoice_history:{enabled:true},payment_method_update:{enabled:true},
 subscription_cancel:{enabled:true,mode:'at_period_end'},
 subscription_update:{enabled:true,default_allowed_updates:['price'],products:[{product:product.id,prices:[prices.month.id,prices.year.id]}],proration_behavior:'create_prorations'}},
 metadata:{bndrm:'storage-v1'},
},{idempotencyKey:'bndrm-portal-v1'});
const endpointUrl=origin+'/api/billing/webhook';
let endpoint=(await stripe.webhookEndpoints.list({limit:100})).data.find(e=>e.url===endpointUrl);
let secret=process.env.STRIPE_WEBHOOK_SECRET;
if(endpoint&&process.env.STRIPE_WEBHOOK_ENDPOINT_ID!==endpoint.id)throw Error('Existing webhook signing secret must be paired with its endpoint ID. Do not reuse another environment’s secret.');
if(!endpoint){endpoint=await stripe.webhookEndpoints.create({url:endpointUrl,enabled_events:BILLING_EVENTS,api_version:Stripe.API_VERSION,description:'Bndrm storage subscriptions'},{idempotencyKey:'bndrm-storage-webhook-v1'});secret=endpoint.secret}
if(!secret)throw Error('Webhook already exists; recover its signing secret from Stripe before continuing.');
const values={STRIPE_PLUS_MONTHLY_PRICE:prices.month.id,STRIPE_PLUS_ANNUAL_PRICE:prices.year.id,STRIPE_PORTAL_CONFIGURATION:portal.id,STRIPE_WEBHOOK_SECRET:secret,STRIPE_WEBHOOK_ENDPOINT_ID:endpoint.id};
let env=readFileSync('.env.local','utf8');
for(const [name,value] of Object.entries(values)){env=env.split('\n').filter(line=>!line.startsWith(name+'=')).join('\n').trimEnd()+'\n'+name+'='+JSON.stringify(value)+'\n'}
writeFileSync('.env.local',env,{mode:0o600});
const account=await stripe.accounts.retrieve(),tax=await stripe.tax.settings.retrieve();
console.log(JSON.stringify({product:product.id,monthly:prices.month.id,annual:prices.year.id,portal:portal.id,webhook:endpoint.id,live:key.includes('_live_'),chargesEnabled:account.charges_enabled,taxStatus:tax.status}));
