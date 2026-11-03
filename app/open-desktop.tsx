'use client';
import {useState} from 'react';
import {useDesktopApp} from '../lib/use-desktop-app';
import {ExternalLink} from 'lucide-react';
export default function OpenDesktop(){
 const [attempted,setAttempted]=useState(false);
 const desktopApp=useDesktopApp();
 if(desktopApp)return null;
 return <div className="open-desktop"><a className="button primary" href="bndrm://open" onClick={()=>setAttempted(true)}><ExternalLink size={15}/> Open Bndrm Desktop</a><a className="button subtle" href="/desktop" target="_blank" rel="noreferrer">Install or update</a>{attempted&&<p role="status" className="form-hint">Allow your browser to open Bndrm. If nothing opens, install Desktop 0.2.3 or newer, then try again. Keep it open on the computer connected to this band.</p>}</div>;
}
