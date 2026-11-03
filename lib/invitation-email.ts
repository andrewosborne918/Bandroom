export function invitationEmail(email:string,url:string){
 const subject='Join my band on Bndrm';
 const body='You are invited to our private band workspace. Use this single-use link to choose your password and join. Please do not forward it. If it has expired, ask me for a new link.\n\n'+url;
 return {subject,body,message:'To: '+email+'\nSubject: '+subject+'\n\n'+body,href:'mailto:'+encodeURIComponent(email)+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body)};
}
