import type Stripe from 'stripe';
// Called only after an authenticated owner explicitly deletes the workspace.
// Finish provider cancellation before removing the app's customer mapping.
export async function closeBillingCustomer(stripe:Stripe,customer:string,checkout:string|null){
 if(checkout){const session=await stripe.checkout.sessions.retrieve(checkout);if(session.status==='open')await stripe.checkout.sessions.expire(checkout)}
 for await(const sub of stripe.subscriptions.list({customer,status:'all',limit:100})){
  if(!['canceled','incomplete_expired'].includes(sub.status))await stripe.subscriptions.cancel(sub.id,{invoice_now:false,prorate:false});
 }
}
