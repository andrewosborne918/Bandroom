'use client';
import {Headphones,Link2,Radio} from 'lucide-react';
import type {Session} from '../../lib/types';
import type {LiveSession} from '../../lib/live-sessions';

export default function SessionConnection({session,connection,available,canCreate,busy,onJoin,onCode,onCreate,onDetails,onAudio,onLeave}:{
  session:Session|null;connection:string;available:LiveSession[];canCreate:boolean;busy:boolean;
  onJoin:(code:string)=>void;onCode:()=>void;onCreate:()=>void;onDetails:()=>void;onAudio:()=>void;onLeave:()=>void;
}){
  const present=session?.members.filter(m=>Date.now()-m.seen<45000)||[];
  const ready=present.filter(m=>m.ready&&m.songId===session?.songId).length;
  return <section className={'session-connection '+(session?'joined':'solo')} aria-label="Session connection">
    {session?<>
      <div><strong><Radio size={17}/>{connection==='Connection lost'?'Reconnecting to session':session.name}</strong><p>{session.code} · {ready} of {present.length} devices ready · This device follows the shared song and playback.</p></div>
      <button className="button subtle" onClick={onDetails}>Session &amp; devices</button><button className="button subtle" onClick={onLeave}>Leave session</button>
    </>:<>
      <div><strong>Solo practice</strong><p>This device is not connected to a shared session. Signing in alone does not sync playback.</p></div>
      {available.map(s=><button key={s.code} className="button primary" disabled={busy} onClick={()=>onJoin(s.code)}><Link2 size={16}/>Join {s.name}</button>)}
      <button className="button subtle" disabled={busy} onClick={onCode}>Join with code</button>
      {canCreate&&<button className="button subtle" disabled={busy} onClick={onCreate}>Start a session</button>}
    </>}
    <button className="button subtle" onClick={onAudio}><Headphones size={16}/>Sound check</button>
  </section>;
}
