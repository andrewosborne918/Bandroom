import {createHash} from 'node:crypto';
import {admin,client,json,problem,result} from './clients';
const hash=(token:string)=>createHash('sha256').update(token).digest('hex');
export async function makeInvitation(db:any,bandId:string,emailInput:unknown,role:unknown){
 const email=String(emailInput||'').trim().toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)problem('Enter a valid email');
 const token=crypto.randomUUID()+crypto.randomUUID();
 const id=await result(db.rpc('invite_member',{b:bandId,invite_email:email,invite_role:role||'member',hash:hash(token)}));
 const service=admin();let link=await service.auth.admin.generateLink({type:'invite',email});
 if(link.error&&(link.error.code==='email_exists'||/already.*registered/i.test(link.error.message)))link=await service.auth.admin.generateLink({type:'magiclink',email});
 if(link.error||!link.data.properties?.hashed_token){
  await service.from('invitations').update({declined_at:new Date().toISOString()}).eq('id',id);
  problem('Could not create the invitation link. Please try again.',502);
 }
 const url=new URL('/',process.env.APP_ORIGIN!);
 url.searchParams.set('invite',token);url.searchParams.set('invite_hash',link.data.properties.hashed_token);url.searchParams.set('invite_type',link.data.properties.verification_type);
 return {id,url:url.href,email};
}
export async function acceptInvitation(req:Request){
 const body:any=await req.json(),token=String(body.token||''),tokenHash=String(body.tokenHash||'');
 if(token.length!==72||!/^[a-f0-9]{64}$/i.test(tokenHash)||!['invite','magiclink','signup'].includes(body.type))problem('This invitation link is invalid. Ask for a new link.');
 if(typeof body.password!=='string'||body.password.length<12||body.password.length>256)problem('Choose a password with at least 12 characters.');
 const invite=await result(admin().from('invitations').select('email,expires_at,accepted_at,declined_at').eq('token_hash',hash(token)).maybeSingle());
 if(!invite||invite.accepted_at||invite.declined_at||Date.parse(invite.expires_at)<=Date.now())problem('This invitation has expired or was used. Ask for a new link.',409);
 const db=await client();
 const verified=await db.auth.verifyOtp({token_hash:tokenHash,type:body.type});
 if(verified.error||!verified.data.user)problem('This invitation link has expired or was used. Ask for a new link.',409);
 if(verified.data.user.email?.trim().toLowerCase()!==invite.email){await db.auth.signOut();problem('This link does not match the invited email.',403)}
 const {error}=await db.auth.updateUser({password:body.password,data:{display_name:String(body.displayName||'').slice(0,80)}});
 if(error)problem('Could not set your password. Please request a new invitation link.',409);
 await result(db.from('profiles').update({display_name:String(body.displayName||'').slice(0,80),updated_at:new Date().toISOString()}).eq('id',verified.data.user.id));
 const bandId=await result(db.rpc('respond_invitation',{hash:hash(token),accept:true}));
 return json({ok:true,bandId});
}
