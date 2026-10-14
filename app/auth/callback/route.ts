import {NextResponse} from 'next/server';
import {client} from '../../../lib/cloud/clients';
export async function GET(req:Request){const url=new URL(req.url),code=url.searchParams.get('code');if(code){const db=await client();const {error}=await db.auth.exchangeCodeForSession(code);if(!error)return NextResponse.redirect(new URL(url.searchParams.get('type')==='recovery'?'/?reset=1':'/',process.env.APP_ORIGIN||url.origin));}return NextResponse.redirect(new URL('/?authError=1',process.env.APP_ORIGIN||url.origin));}
