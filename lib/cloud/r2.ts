import {createHash,createHmac} from 'node:crypto';

const encode=(s:string)=>encodeURIComponent(s).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const hmac=(key:string|Buffer,value:string)=>createHmac('sha256',key).update(value).digest();
export type R2Config={endpoint:string;bucket:string;accessKey:string;secretKey:string};
export function r2Config():R2Config {
 const {R2_ENDPOINT:endpoint,R2_BUCKET:bucket,R2_ACCESS_KEY_ID:accessKey,R2_SECRET_ACCESS_KEY:secretKey}=process.env;
 if(!endpoint||!bucket||!accessKey||!secretKey)throw Error('Private audio storage has not been configured');
 return {endpoint,bucket,accessKey,secretKey};
}
// S3 Signature V4. Keys and signatures stay on the server; clients receive one
// operation on one object with a short expiry, never storage credentials.
export function presign(config:R2Config,method:string,key:string,seconds=60,options:{query?:Record<string,string>;headers?:Record<string,string>;now?:Date}={}) {
 if(!key||key.split('/').some(p=>p==='..'||p==='.')||key.startsWith('/'))throw Error('Invalid storage path');
 const url=new URL(config.endpoint);if(url.protocol!=='https:')throw Error('Storage requires HTTPS');
 url.pathname='/'+[config.bucket,...key.split('/')].map(encode).join('/');
 const stamp=(options.now||new Date()).toISOString().replace(/[:-]|\.\d{3}/g,''),date=stamp.slice(0,8),scope=date+'/auto/s3/aws4_request';
 const headers={host:url.host,...options.headers},names=Object.keys(headers).sort();
 const params={'X-Amz-Algorithm':'AWS4-HMAC-SHA256','X-Amz-Credential':config.accessKey+'/'+scope,'X-Amz-Date':stamp,'X-Amz-Expires':String(Math.max(1,Math.min(3600,seconds))),'X-Amz-SignedHeaders':names.join(';'),...options.query};
 const query=Object.entries(params).map(([k,v])=>[encode(k),encode(v)]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:a[1]<b[1]?-1:1).map(([k,v])=>k+'='+v).join('&');
 const canonical=[method,url.pathname,query,names.map(n=>n+':'+headers[n as keyof typeof headers].trim()+'\n').join(''),names.join(';'),'UNSIGNED-PAYLOAD'].join('\n');
 const signing=hmac(hmac(hmac(hmac('AWS4'+config.secretKey,date),'auto'),'s3'),'aws4_request');
 url.search=query+'&X-Amz-Signature='+createHmac('sha256',signing).update('AWS4-HMAC-SHA256\n'+stamp+'\n'+scope+'\n'+digest(canonical)).digest('hex');
 return url.toString();
}
export const r2Key=(bucket:string,key:string)=>{
 if(!['originals','stems','temporary','charts','exports'].includes(bucket))throw Error('Invalid audio bucket');
 return bucket+'/'+key;
};
