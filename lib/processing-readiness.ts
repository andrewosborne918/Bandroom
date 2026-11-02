export function processingReadiness(status:string|undefined,stemCount:number,reviewed:boolean){
 if(status==='queued')return 'Waiting for desktop processing';
 if(status==='processing')return 'Processing on desktop';
 if(status==='failed')return 'Processing needs attention';
 if(status==='canceled'&&!stemCount)return 'Processing canceled';
 return reviewed?'Timing reviewed':stemCount?'Ready to review':'Upload audio to process';
}
