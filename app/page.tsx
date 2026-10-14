import PlatformShell from './platform-shell';
import Bandroom from './bandroom';
export default function Page() { return process.env.APP_PLATFORM==='supabase'?<PlatformShell/>:<Bandroom/>; }

export const dynamic='force-dynamic';
