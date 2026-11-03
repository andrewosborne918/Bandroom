'use client';

import Link from 'next/link';
import Image from 'next/image';
import {Download} from 'lucide-react';
import {useSyncExternalStore} from 'react';

const isDesktopApp=()=>{
  if (typeof window === 'undefined') return false;
  if ((window as Window & {__BNDRM_DESKTOP__?:boolean;__TAURI__?:unknown}).__BNDRM_DESKTOP__ || (window as Window & {__TAURI__?:unknown}).__TAURI__) return true;
  const userAgent = navigator.userAgent || '';
  return window.location.protocol === 'tauri:' || userAgent.includes('Tauri');
};

const subscribe=()=>()=>{};
const serverDesktop=()=>false;
export default function SiteHeader() {
  const desktopApp=useSyncExternalStore(subscribe,isDesktopApp,serverDesktop);

  return <header className="site-header">
    <Link className="site-brand" href="/" aria-label="Bndrm home">
      <Image src="/branding/bndrm-icon.png" width={42} height={42} alt="" priority/>
      <span>Bndrm</span><small>Play together.</small>
    </Link>
    <nav aria-label="Main navigation">
      <Link href="/" className="web-app-link">Web app</Link>
      {!desktopApp&&<Link className="button primary download-nav" href="/desktop"><Download size={16}/> Download</Link>}
    </nav>
  </header>;
}
