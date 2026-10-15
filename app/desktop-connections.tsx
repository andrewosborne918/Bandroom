'use client';
import {useCallback,useEffect,useState} from 'react';
type Device={id:string;name:string;platform:string;last_seen:string|null;online?:boolean};
type Reply={devices?:Device[];error?:string};
const markOnline=(devices:Device[]=[])=>devices.map(d=>({...d,online:Date.now()-new Date(d.last_seen||0).getTime()<90000}));
export default function DesktopConnections({bandId}:{bandId:string}){
 const [devices,setDevices]=useState<Device[]>([]),[code,setCode]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const call=useCallback(async(path:string,body?:unknown)=>{
  const r=await fetch('/api/desktop/'+path,{method:body?'POST':'GET',headers:{'x-band-id':bandId,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const b=await r.json() as Reply;if(!r.ok)throw Error(b.error||'Connection failed');return b;
 },[bandId]);
 useEffect(()=>{let active=true;async function refresh(initial=false){try{const b=await call('devices');if(active){setDevices(markOnline(b.devices));if(initial)setCode(new URLSearchParams(location.search).get('desktop')||sessionStorage.getItem('bndrm-desktop-code')||'')}}catch(e){if(active)setMessage(e instanceof Error?e.message:'Unable to load processors')}}void refresh(true);const t=setInterval(()=>void refresh(),10000);return()=>{active=false;clearInterval(t)}},[call]);
 async function act(fn:()=>Promise<void>){setBusy(true);setMessage('');try{await fn();setDevices(markOnline((await call('devices')).devices))}catch(e){setMessage(e instanceof Error?e.message:'Connection failed')}finally{setBusy(false)}}
 return <section className="desktop-connections">
  <h3>Your band’s desktop processors</h3>
  <p className="form-hint">Install Bndrm on a Mac or Windows PC. Connect it once, then just drop songs into the library. Separation and analysis queue automatically. That computer processes this band’s uploads while Bndrm Desktop is open.</p>
  <a className="button subtle" href="/desktop" target="_blank" rel="noreferrer">Get Bndrm Desktop</a>
  <label>Connection code from the desktop app<input value={code} onChange={e=>setCode(e.target.value.toUpperCase())} maxLength={14} autoComplete="off" placeholder="AB12C DE345"/></label>
  <button className="button primary" disabled={busy||code.replace(/[^A-Z0-9]/g,'').length!==10} onClick={()=>void act(async()=>{await call('approve',{code});setCode('');sessionStorage.removeItem('bndrm-desktop-code');setMessage('Computer connected. Bndrm Desktop starts automatically and picks up queued songs. Keep it open while processing.');const url=new URL(location.href);url.searchParams.delete('desktop');history.replaceState({},'',url)})}>Connect to this band</button>
  {devices.map(d=><div className="member-row" key={d.id}><span>{d.name}<small>{d.platform} · {d.online?'Online':'Offline'}</small></span><button className="button subtle" disabled={busy} onClick={()=>void act(async()=>{await call('revoke',{id:d.id});setMessage('Connection revoked. This computer can no longer access the queue.')})}>Revoke</button></div>)}
  {!devices.length&&<p className="form-hint">No computers connected yet. Uploads can queue until your processor is online.</p>}
  {message&&<p role="status">{message}</p>}
 </section>
}
