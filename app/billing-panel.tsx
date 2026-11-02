'use client';
import {useEffect,useState} from 'react';
import {ArrowUpRight,Check} from 'lucide-react';
export default function BillingPanel({plan,processingMinutes}:{plan:string;processingMinutes:number}){
 const [billing,setBilling]=useState<any>(null),[interval,setInterval]=useState<'month'|'year'>('month'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function request(action='',body?:unknown){const response=await fetch('/api/platform/billing'+(action?'/'+action:''),{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const data:any=await response.json();if(!response.ok)throw Error(data.error||'Billing unavailable');return data}
 useEffect(()=>{let stopped=false,timer:ReturnType<typeof setTimeout>|undefined,attempts=0;const returning=new URLSearchParams(location.search).has('billing');
  const load=async()=>{try{if(returning)await request('refresh',{});const data=await request();if(stopped)return;setBilling(data);if(returning){window.dispatchEvent(new Event('bndrm-storage-changed'));if(!['active','trialing','canceled','past_due','unpaid'].includes(data.status)&&++attempts<5)timer=setTimeout(()=>void load(),2000)}}catch{if(!stopped)setError('Billing details are unavailable. Close and reopen Band settings to retry.')}};
  void load();return()=>{stopped=true;if(timer)clearTimeout(timer)}},[]);
 async function run(action:string){
  setBusy(true);setError('');
  try{
   const result=await request(action,{interval});
   if(result.url){const url=new URL(result.url);if(url.protocol!=='https:'||!url.hostname.endsWith('.stripe.com'))throw Error('Unexpected checkout address');location.assign(url.href)}
   else{setBilling(await request());window.dispatchEvent(new Event('bndrm-storage-changed'))}
  }catch(e:any){setError(e.message)}finally{setBusy(false)}
 }
 if(plan==='personal')return <p className="form-hint">Your personal account has unlimited storage. No subscription is needed.</p>;
 return <section className="billing-card" aria-label="Storage upgrade">
  <div className="billing-card-heading"><div><small>ROOM FOR YOUR WHOLE REPERTOIRE</small><h3>Bndrm Plus</h3></div><span className="billing-storage">25 GiB</span></div>
  <p>More room for recordings, stems and the songs you play together.</p>
  <ul><li><Check size={15}/> Shared by your whole band</li><li><Check size={15}/> Approximately 100 typical songs</li><li><Check size={15}/> Cancel any time; access lasts through your paid period</li></ul>
  {plan==='plus'||['active','trialing','past_due','unpaid','incomplete'].includes(billing?.status)?<>
   <p>{billing?.review?'Your billing account needs a review. Existing songs remain available.':billing?.cancels?'Your subscription will end after the current paid period.':billing?.status==='past_due'?'Your payment needs attention. Update your payment details to restore Plus.':'Your band has a subscription.'}</p>
   {billing?.periodEnd&&<p className="form-hint">Current period ends {new Date(billing.periodEnd).toLocaleDateString()}.</p>}
   <button className="button primary" disabled={busy||!billing?.canManage} onClick={()=>void run('portal')}>Manage billing <ArrowUpRight size={15}/></button>
  </>:<>
   <div className="billing-interval" role="group" aria-label="Billing interval"><button aria-pressed={interval==='month'} onClick={()=>setInterval('month')}>Monthly</button><button aria-pressed={interval==='year'} onClick={()=>setInterval('year')}>Annual · save $16</button></div>
   <div className="billing-price"><strong>{interval==='month'?'$8':'$80'}</strong><span> / {interval==='month'?'month':'year'} per band</span></div>
   <button className="button primary" disabled={busy||!billing?.available||!billing.canManage} onClick={()=>void run('checkout')}>{busy?'Opening checkout…':billing?.available?'Upgrade to Plus':'Paid upgrades opening soon'}<ArrowUpRight size={15}/></button>
   {!billing?.available&&<p className="form-hint">Pricing is set. Secure checkout is being prepared; no payment is taken here.</p>}
  </>}
  {billing&&!billing.canManage&&<p className="form-hint">Only the band owner can change the subscription.</p>}
  {billing?.pending&&billing.canManage&&<button className="button subtle" disabled={busy} onClick={()=>void run('cancel-checkout')}>Cancel pending checkout</button>}
  {billing?.canManage&&<button className="button subtle" disabled={busy} onClick={()=>void run('refresh')}>Refresh billing status</button>}
  <p className="form-hint">Prices in USD, plus applicable taxes. Processing uses Bndrm Desktop; your band’s {processingMinutes} processing minutes per month and existing file limit apply. Downgrading keeps your songs available but pauses new uploads if storage is full.</p>
  {error&&<p role="alert" className="stem-error">{error}</p>}
 </section>;
}
