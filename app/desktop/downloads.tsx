'use client';
import {useEffect,useState} from 'react';
import {Apple,Monitor,Download,ExternalLink} from 'lucide-react';
type Asset={id:number;name:string;browser_download_url:string};
type Release={tag_name:string;draft:boolean;assets:Asset[]};
const releasesUrl='https://github.com/andrewosborne918/Bandroom/releases';
const allowedAsset=(a:Asset)=>a.browser_download_url.startsWith(releasesUrl+'/download/')&&/\.(dmg|exe)$/.test(a.name);

export default function DesktopDownloads(){
 const [assets,setAssets]=useState<Asset[]>([]),[message,setMessage]=useState('Checking installer availability…');
 const [attempt,setAttempt]=useState(0),[failed,setFailed]=useState(false),[macVerified,setMacVerified]=useState(false);
 useEffect(()=>{
  const c=new AbortController();
  const timer=setTimeout(()=>c.abort(),15000);
  let active=true;
  fetch('https://api.github.com/repos/andrewosborne918/Bandroom/releases?per_page=20',{signal:c.signal})
   .then(r=>{if(!r.ok)throw Error();return r.json() as Promise<Release[]>})
   .then(rows=>{
    // Publish one complete release across all three supported architectures.
    const release=rows.find(r=>r.tag_name.startsWith('desktop-v')&&!r.draft&&r.assets.some(a=>allowedAsset(a)&&a.name.includes('aarch64')&&a.name.endsWith('.dmg'))&&r.assets.some(a=>allowedAsset(a)&&a.name.includes('x64')&&a.name.endsWith('.dmg'))&&r.assets.some(a=>allowedAsset(a)&&a.name.endsWith('.exe')));
    if(!release)throw Error();
    if(active){const version=release.tag_name.match(/^desktop-v(\d+)\.(\d+)\.(\d+)(?:-|$)/)?.slice(1).map(Number);const verified=!!version&&(version[0]>0||version[1]>2||version[1]===2&&version[2]>=2);setMacVerified(verified);setAssets(release.assets.filter(allowedAsset));setMessage(verified?'Choose your computer below. '+release.tag_name.replace('desktop-v','Version ').replace(/-[a-f0-9]+$/,'')+' · Beta':'Windows beta is available. Corrected Mac installers are being verified.');}
   }).catch(()=>{if(active){setFailed(true);setMessage('We couldn’t check installers. Try again or download from GitHub releases.')}})
   .finally(()=>clearTimeout(timer));
  return()=>{active=false;clearTimeout(timer);c.abort()};
 },[attempt]);
 const arm=assets.find(a=>a.name.includes('aarch64')&&a.name.endsWith('.dmg'));
 const intel=assets.find(a=>a.name.includes('x64')&&a.name.endsWith('.dmg'));
 const windows=assets.find(a=>a.name.endsWith('.exe'));
 function download(asset:Asset|undefined,label:string){return asset?<a className="button primary" href={asset.browser_download_url}><Download size={16}/>{label}</a>:<span className="installer-pending">{failed?'Use the releases link below':'Checking download…'}</span>}
 return <section className="desktop-downloads" aria-label="Choose your installer">
  <p className="download-status" role="status">{message}{failed&&<button className="button subtle" onClick={()=>{setFailed(false);setMessage('Checking installer availability…');setAttempt(a=>a+1)}}>Try again</button>}</p>
  <div className="download-platforms">
   <article className="download-card"><div className="platform-icon"><Apple size={30}/></div><h2>Download for Mac</h2><p>macOS 14 or later</p>{assets.length&&!macVerified?<p className="form-hint" role="status">Mac downloads are temporarily paused while a signing correction is verified. Please check back for version 0.2.2 or newer.</p>:download(arm,'Mac · Apple silicon')}<span className="download-caption">For M1, M2, M3, M4 and newer Apple chips.</span>{(!assets.length||macVerified)&&download(intel,'Mac · Intel')}<details><summary>Which Mac do I have?</summary><p>Open the Apple menu → About This Mac. If Chip says Apple M1 or newer, choose Apple silicon. If Processor says Intel, choose Intel.</p></details></article>
   <article className="download-card"><div className="platform-icon"><Monitor size={30}/></div><h2>Download for PC</h2><p>Windows 10 or 11 · 64-bit x64</p>{download(windows,'Windows · 64-bit')}<span className="download-caption">For PCs with Intel or AMD processors.</span><p className="form-hint">Windows on ARM does not have a native installer in this beta.</p><div className="download-card-note"><CheckIcon/> Includes the audio processing tools. No Python installation needed.</div></article>
  </div>
  <a className="release-link" href={releasesUrl} target="_blank" rel="noreferrer">Installation notes & all releases <ExternalLink size={14}/></a>
 </section>;
}
function CheckIcon(){return <span aria-hidden="true">✓</span>}
