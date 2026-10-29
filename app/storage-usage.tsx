'use client';
import {HardDrive} from 'lucide-react';
import {formatStorage,storageUsage} from '../lib/storage-usage';
type Props={stored:number;reserved:number;limit:number|null;plan:string;compact?:boolean;onClick?:()=>void};
export default function StorageUsage({stored,reserved,limit,plan,compact=false,onClick}:Props){
 const usage=storageUsage(stored,reserved,limit);
 const remaining=usage.unlimited?'Unlimited storage':formatStorage(usage.remaining!)+' left';
 if(compact)return <button className="storage-shortcut" onClick={onClick} aria-label={'Band storage: '+remaining+'. View storage details'}><HardDrive size={15}/><span>{remaining}</span></button>;
 return <section className={'storage-card'+(!usage.unlimited&&usage.percent>=80?' storage-near-limit':'')} aria-label="Band storage">
  <div className="storage-card-heading"><span><HardDrive size={18}/> Band storage</span><small>{plan==='personal'?'Personal':plan==='plus'?'Plus':plan==='custom'?'Custom':'Free'} plan</small></div>
  <div className="storage-card-total"><strong>{remaining}</strong><span>{usage.unlimited?formatStorage(usage.used)+' in use':formatStorage(usage.used)+' of '+formatStorage(limit!)+' in use'}</span></div>
  {!usage.unlimited&&<progress max={100} value={usage.percent} aria-label="Storage in use"/>}
  <p>{formatStorage(stored)} stored · {formatStorage(reserved)} reserved for uploads and processing.</p>
  <p className="form-hint">Storage is shared by this band and includes original recordings, generated stems and temporary exports.</p>
  {!usage.unlimited&&usage.percent>=80&&<p className="storage-warning">{usage.percent>=100?'Your storage allowance is full.':'Your band is running low on storage.'} Remove unused audio to make space. Existing songs remain available.</p>}
 </section>;
}
