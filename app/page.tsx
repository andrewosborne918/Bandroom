import PlatformShell from './platform-shell';
import Bndrm from './bandroom';
export default function Page() { return process.env.APP_PLATFORM==='supabase'?<PlatformShell/>:<Bndrm/>; }

export const dynamic='force-dynamic';
