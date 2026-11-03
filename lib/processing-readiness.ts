export function processingReadiness(status:string|undefined,stemCount:number,reviewed:boolean){
 if(status==='queued')return 'Waiting for desktop processing';
 if(status==='processing')return 'Processing on desktop';
 if(status==='expired'&&!stemCount)return 'Upload recording again';
 if(status==='failed')return 'Processing needs attention';
 if(status==='canceled'&&!stemCount)return 'Processing canceled';
 return reviewed?'Timing reviewed':stemCount?'Ready to review':'Upload audio to process';
}

export function processingInput<T extends {source:string;status:string}>(assets:T[]):T|undefined{
 return assets.find(a=>a.source==='original'&&a.status==='verified')
  ||assets.find(a=>a.source==='original'&&a.status==='pending')
  ||assets.find(a=>a.source==='import'&&a.status==='verified');
}
export function processingInputState(assets:{source:string;status:string}[]){
 return processingInput(assets)?'ready':assets.some(a=>a.source==='import'&&a.status==='pending')?'verifying':'missing';
}
