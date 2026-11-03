'use client';

import Link from 'next/link';
import Image from 'next/image';
import {Download} from 'lucide-react';
import {useDesktopApp} from '../lib/use-desktop-app';

export default function SiteHeader() {
  const desktopApp=useDesktopApp();

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
