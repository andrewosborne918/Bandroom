'use client';
import {Headphones,Link2,QrCode,Radio} from 'lucide-react';
import type {Session} from '../../lib/types';
import type {LiveSession} from '../../lib/live-sessions';

export default function SessionConnection({deviceRole,session,connection,available,canCreate,busy,onJoin,onCode,onCreate,onDetails,onShare,onAudio}:{
  deviceRole:string;session:Session|null;connection:string;available:LiveSession[];canCreate:boolean;busy:boolean;
  onJoin:(code:string)=>void;onCode:()=>void;onCreate:()=>void;onDetails:()=>void;onShare?:()=>void;onAudio:()=>void;
}){
  const present=session?.members.filter(m=>Date.now()-m.seen<30000)||[];
  const ready=present.filter(m=>m.ready&&m.songId===session?.songId).length;
  return <section className={'session-connection '+(session?'joined':'solo')} aria-label="Session connection">
    <div>{session?<><strong><Radio size={16}/>{connection==='Connection lost'?'Reconnecting…':session.name}</strong><small>{deviceRole} · {ready}/{present.length} devices ready</small></>:<><strong>Solo practice</strong><small>Only this device</small></>}</div>
    <div className="session-actions">
      {session?<>
        {onShare&&<button className="button subtle" aria-haspopup="dialog" onClick={onShare}><QrCode size={16}/>Share session</button>}
        <button className="button subtle" onClick={onDetails}>Ready &amp; devices</button>
      </>:<>
        {available.map(s=><button key={s.code} className="button primary" disabled={busy} onClick={()=>onJoin(s.code)}><Link2 size={16}/>Join {s.name}</button>)}
        <button className="button subtle" disabled={busy} onClick={onCode}>Join session</button>
        {canCreate&&<button className="button subtle" disabled={busy} onClick={onCreate}>Start session</button>}
      </>}
      <button className="button subtle audio-setup" aria-label="Ready check and audio setup" onClick={onAudio}><Headphones size={16}/><span>Ready check</span></button>
    </div>
  </section>;
}
