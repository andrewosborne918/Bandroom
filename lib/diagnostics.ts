export const diagnosticKinds=['audio.prepare.success','audio.prepare.failure','audio.start.failure','connection.lost'] as const;
export function safeDiagnostic(value:any){
 if(!value||!diagnosticKinds.includes(value.kind))throw Error('Invalid diagnostic event');
 return {kind:value.kind,seconds:Number.isFinite(value.seconds)?Math.max(0,Math.min(3600,value.seconds)):undefined,tracks:Number.isInteger(value.tracks)?Math.max(0,Math.min(24,value.tracks)):undefined};
}
export function reportDiagnostic(kind:typeof diagnosticKinds[number],data:{seconds?:number;tracks?:number}={}){
 if(typeof window==='undefined')return;
 void fetch('/api/band/diagnostics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,...data}),keepalive:true}).catch(()=>{});
}

export function summarizeDiagnostics(events:{kind:string;details?:{seconds?:number}}[]){
 const prepared=events.filter(e=>e.kind==='audio.prepare.success'&&Number.isFinite(e.details?.seconds)).map(e=>e.details!.seconds!).sort((a,b)=>a-b);
 return {samples:prepared.length,prepareFailures:events.filter(e=>e.kind==='audio.prepare.failure').length,startFailures:events.filter(e=>e.kind==='audio.start.failure').length,p95PrepareSeconds:prepared.length?Math.round(prepared[Math.min(prepared.length-1,Math.floor(prepared.length*.95))]*10)/10:null};
}
