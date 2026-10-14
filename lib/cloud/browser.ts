'use client';
import {createBrowserClient} from '@supabase/ssr';
let singleton:ReturnType<typeof createBrowserClient>|undefined;
export function browser(){return singleton??=createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)}
