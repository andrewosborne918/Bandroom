'use client';
import {useEffect,useState} from 'react';

export default function KeepAwake(){
 const [enabled,setEnabled]=useState(false),[status,setStatus]=useState('');
 useEffect(()=>{
  if(!enabled)return;
  let active=true,lock:WakeLockSentinel|undefined;
  async function request(){
   if(document.hidden)return;
   try{
    const next=await navigator.wakeLock.request('screen');
    if(!active){await next.release();return}
    lock=next;
    setStatus('Screen stays awake while this view is visible.');
    next.addEventListener('release',()=>{if(active)setStatus('Screen wake lock released. Return to this view to retry.')});
   }catch{if(active){setStatus('Screen wake lock unavailable. Check your device’s auto-lock settings.');setEnabled(false)}}
  }
  void request();
  document.addEventListener('visibilitychange',request);
  return()=>{active=false;document.removeEventListener('visibilitychange',request);void lock?.release()};
 },[enabled]);
 return <div className="keep-awake"><label><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/> Keep screen awake</label>{status&&<p role="status">{status}</p>}</div>;
}
