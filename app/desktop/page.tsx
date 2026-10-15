import Link from 'next/link';
import {Check, Music2, Users, Laptop} from 'lucide-react';
import DesktopDownloads from './downloads';
export const metadata = {title:'Download Bndrm | Mac & Windows',description:'Download Bndrm for Mac or Windows. Prepare songs on your computer and rehearse together from any device.'};

export default function DesktopPage() {
  return <main className="desktop-download-page">
    <section className="download-hero">
      <p className="eyebrow">A LITTLE LESS SETUP. A LOT MORE MUSIC.</p>
      <h1>Your band.<br/>At home on your computer.</h1>
      <p>Drop in a song. Bndrm prepares the stems on your Mac or PC. Your band joins on phones and tablets through the web app.</p>
      <div className="download-benefits"><span><Check size={16}/> Free desktop beta</span><span><Check size={16}/> No Terminal setup</span><span><Check size={16}/> Your computer does the processing</span></div>
    </section>
    <DesktopDownloads/>
    <section className="download-how" aria-labelledby="download-how-title"><p className="eyebrow">FROM DOWNLOAD TO REHEARSAL</p><h2 id="download-how-title">Make room for the music.</h2><ol>
      <li><Laptop/><div><strong>Install & connect</strong><p>Open Bndrm Desktop, select Connect your band, then sign in and approve the connection code in your band workspace.</p></div></li>
      <li><Music2/><div><strong>Bring in a song</strong><p>Open the library from the desktop app and drop in your audio. Keep the app open while it separates stems and estimates timing, lyrics and chords.</p></div></li>
      <li><Users/><div><strong>Play together</strong><p>Start a session and share the join link. Musicians use the web app on their own devices. Use a separate audience device for backing tracks without click or spoken cues.</p></div></li>
    </ol></section>
    <details className="download-details"><summary>What does Bndrm Desktop need?</summary><p>Python and FFmpeg are included. AI models download on first use. Allow several GB of free space, plus room for your lossless stems. Processing uses your CPU; speed varies by computer. Internet is required for accounts, uploads and shared sessions.</p><p>Musical estimates may need correction. Instrument tabs require a supplied chart. This beta is unsigned; your operating system may ask you to approve opening it. Follow the release installation notes. Install updates from this page.</p></details>
    <div className="download-web"><div><h2>Just joining the session?</h2><p>Open Bndrm in your browser on your phone, tablet or computer.</p></div><Link className="button subtle" href="/">Open web app →</Link></div>
  </main>;
}
