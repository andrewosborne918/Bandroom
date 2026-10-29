// Read-only load harness. Use staging accounts, never a member's personal browser session.
import {readFileSync,statSync} from 'node:fs';
import {parseArgs} from 'node:util';
const {values}=parseArgs({options:{url:{type:'string'},path:{type:'string',default:'/api/health'},clients:{type:'string',default:'10'},requests:{type:'string',default:'20'},'cookie-file':{type:'string'},'allow-production':{type:'boolean',default:false}}});
if(!values.url)throw Error('--url is required');
const origin=new URL(values.url);if(!['http:','https:'].includes(origin.protocol))throw Error('HTTP URL required');
if(origin.hostname==='bndrm.vercel.app'&&!values['allow-production'])throw Error('Use staging. Production requires explicit --allow-production.');
if(!values.path.startsWith('/api/')||values.path.startsWith('//'))throw Error('An /api/ path is required');
const clients=Number(values.clients),requests=Number(values.requests);if(!Number.isInteger(clients)||clients<1||clients>100||!Number.isInteger(requests)||requests<1||requests>1000)throw Error('Use 1–100 clients and 1–1000 requests per client');
let cookie='';if(values['cookie-file']){if((statSync(values['cookie-file']).mode&0o077)!==0)throw Error('Cookie file must be private (chmod 600).');cookie=readFileSync(values['cookie-file'],'utf8').trim();if(/[\r\n]/.test(cookie))throw Error('Cookie file must contain a single Cookie header value.');}
const durations=[],statuses={},started=performance.now();let bytes=0,failures=0;
await Promise.all(Array.from({length:clients},async()=>{for(let i=0;i<requests;i++){const start=performance.now();try{const response=await fetch(new URL(values.path,origin),{headers:cookie?{Cookie:cookie}:{},redirect:'manual',signal:AbortSignal.timeout(15000)});const data=await response.arrayBuffer();bytes+=data.byteLength;statuses[response.status]=(statuses[response.status]||0)+1;if(!response.ok)failures++;}catch{failures++}finally{durations.push(performance.now()-start)}}}));
durations.sort((a,b)=>a-b);const percentile=p=>Math.round(durations[Math.min(durations.length-1,Math.floor(durations.length*p))]);
console.log(JSON.stringify({clients,requests:durations.length,failures,statuses,p50Ms:percentile(.5),p95Ms:percentile(.95),p99Ms:percentile(.99),responseBytes:bytes,elapsedSeconds:Math.round((performance.now()-started)/100)/10},null,2));
if(failures)process.exitCode=1;
