export const PLUS_STORAGE_BYTES=25*1024**3;
export const BILLING_EVENTS=[
 'checkout.session.completed','checkout.session.async_payment_succeeded',
 'checkout.session.async_payment_failed','checkout.session.expired',
 'customer.subscription.created','customer.subscription.updated','customer.subscription.deleted',
 'customer.subscription.paused','customer.subscription.resumed','invoice.paid','invoice.payment_failed',
 'charge.dispute.created','charge.refunded','radar.early_fraud_warning.created',
];
export function subscriptionState(subscriptions:any[],prices:string[],now=Date.now()){
 const permitted=new Set(prices.filter(Boolean));
 const candidates=subscriptions.map(sub=>{
  const item=sub.items?.data?.find((i:any)=>permitted.has(i.price?.id)&&i.quantity===1);
  const end=Number(item?.current_period_end)||0;
  return {subscription:sub.id,state:sub.status,price:item?.price?.id||null,
   through:end?new Date(end*1000).toISOString():null,cancels:!!sub.cancel_at_period_end,
   plus:!!item&&(sub.status==='trialing'||sub.status==='active'&&sub.latest_invoice?.status==='paid')&&!sub.pause_collection&&end*1000>now};
 });
 candidates.sort((a,b)=>Number(b.plus)-Number(a.plus)||String(b.through).localeCompare(String(a.through)));
 return candidates[0]||{subscription:null,state:'none',price:null,through:null,cancels:false,plus:false};
}
export const stripeId=(value:any):string|null=>typeof value==='string'?value:typeof value?.id==='string'?value.id:null;
