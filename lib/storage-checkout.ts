import type Stripe from 'stripe';
export function createStorageCheckout(stripe:Stripe,options:{customer:string;price:string;attempt:string;origin:string;tax:boolean}){
 const suffix=options.attempt.replaceAll('-','').slice(0,8).split('').map(c=>String.fromCharCode(97+parseInt(c,16))).join('');
 return stripe.checkout.sessions.create({
  mode:'subscription',managed_payments:{enabled:false},customer:options.customer,line_items:[{price:options.price,quantity:1}],
  integration_identifier:'bndrm_storage_'+suffix,
  success_url:options.origin+'/?billing=success',cancel_url:options.origin+'/?billing=cancelled',
  ...(options.tax?{automatic_tax:{enabled:true},customer_update:{address:'auto' as const},billing_address_collection:'required' as const}:{}),
 },{idempotencyKey:'bndrm-checkout-'+options.attempt});
}
