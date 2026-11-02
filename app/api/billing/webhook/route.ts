export const runtime='nodejs';
export function POST(){return Response.json({error:'Billing is disabled for this personal-use app.'},{status:410,headers:{'Cache-Control':'no-store'}})}
