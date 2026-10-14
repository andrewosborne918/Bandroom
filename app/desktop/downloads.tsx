'use client';
import {useEffect,useState} from 'react';
type Asset={id:number;name:string;browser_download_url:string};
type Release={tag_name:string;draft:boolean;assets:Asset[]};
export default function DesktopDownloads(){
 const [assets,setAssets]=useState<Asset[]>([]),[message,setMessage]=useState('Checking installer availability…');
 useEffect(()=>{const c=new AbortController();fetch('https://api.github.com/repos/andrewosborne918/Bandroom/releases?per_page=20',{signal:c.signal}).then(r=>{if(!r.ok)throw Error();return r.json() as Promise<Release[]>}).then(rows=>{const release=rows.find(r=>r.tag_name.startsWith('desktop-v')&&!r.draft);if(!release){setMessage('Installers are being prepared. This page will show download buttons after the first successful build.');return}setAssets(release.assets.filter(a=>/\.(dmg|exe)$/.test(a.name)));setMessage('Beta release. Choose the installer for your computer.')}).catch(()=>{if(!c.signal.aborted)setMessage('View GitHub releases to check installer availability.')});return()=>c.abort()},[]);
 return <section className="desktop-downloads"><p role="status">{message}</p><div className="stem-actions">{assets.map(a=><a key={a.id} className="button primary" href={a.browser_download_url}>{a.name.includes('aarch64')?'Mac · Apple silicon':a.name.endsWith('.dmg')?'Mac · Intel':'Windows · 64-bit'}</a>)}<a className="button subtle" href="https://github.com/andrewosborne918/Bandroom/releases" target="_blank" rel="noreferrer">Releases & updates</a></div><p className="form-hint">Early beta installers may be unsigned. macOS or Windows may ask you to approve opening the app. Follow the release’s installation notes. Updates are installed from this page.</p></section>
}
