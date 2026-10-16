export const progressStages=['downloading','separating','beats','chords','lyrics','uploading','saving'] as const;
export type JobProgress={stage:typeof progressStages[number];percent?:number;etaSeconds?:number;connectionLost?:boolean;overallPercent?:number;overallStartedAt?:number;recovering?:boolean;startedAt:number;updatedAt:number};
export function safeProgress(value:any,now=Date.now()):JobProgress|undefined{
 if(!value||!progressStages.includes(value.stage))return undefined;
 const finite=(x:any)=>typeof x==='number'&&Number.isFinite(x);
 return {stage:value.stage,connectionLost:!!value.connectionLost,percent:finite(value.percent)?Math.max(0,Math.min(100,value.percent)):undefined,etaSeconds:finite(value.etaSeconds)&&value.etaSeconds>=0?Math.min(86400,value.etaSeconds):undefined,startedAt:finite(value.startedAt)?Math.min(now,Math.max(0,value.startedAt)):now,updatedAt:now};
}
export const progressLabel=(stage:JobProgress['stage'])=>({downloading:'Downloading recording to your Mac',separating:'Separating vocals, drums, bass and other',beats:'Detecting tempo and beat timing',chords:'Estimating chords and key',lyrics:'Transcribing lyrics',uploading:'Uploading separated stems',saving:'Saving results to your song'}[stage]);

// Phases have different costs: separating audio usually takes much longer than
// saving metadata. These weights estimate work, not exact wall-clock time.
export const processingPhases=[
 {key:'downloading',label:'Download recording',weight:5},
 {key:'separating',label:'Separate instruments',weight:45},
 {key:'analysis',label:'Analyze timing, lyrics and chords',weight:30},
 {key:'uploading',label:'Upload four stems',weight:18},
 {key:'saving',label:'Save results',weight:2},
] as const;
export function phaseIndex(stage:JobProgress['stage']){
 return stage==='downloading'?0:stage==='separating'?1:stage==='uploading'?3:stage==='saving'?4:2;
}
export function overallProgress(state:JobProgress){
 const phase=phaseIndex(state.stage),base=processingPhases.slice(0,phase).reduce((n,p)=>n+p.weight,0);
 return Math.min(99,base+processingPhases[phase].weight*(state.percent??0)/100);
}
// Only the server derives these fields. Retain the high-water mark and start
// through stage changes, model passes, delivery retries and page reloads.
export function mergeProgress(previous:JobProgress|undefined,next:JobProgress):JobProgress{
 const prior=previous?.overallPercent??(previous?overallProgress(previous):0);
 const candidate=overallProgress(next);
 return {...next,overallStartedAt:previous?.overallStartedAt??previous?.startedAt??next.startedAt,
  overallPercent:Math.max(prior,candidate),recovering:candidate+0.5<prior};
}
export function overallRemaining(state:JobProgress,now=Date.now()){
 const percent=state.overallPercent??overallProgress(state),elapsed=(state.updatedAt-(state.overallStartedAt??state.startedAt))/1000;
 if(state.connectionLost||state.recovering||now-state.updatedAt>20000||elapsed<15||percent<10||percent>=99)return undefined;
 // A rough projection using observed elapsed time and estimated work completed.
 // Do not include queue wait or claim a known end time before there is a sample.
 const estimate=elapsed*(100-percent)/percent-(now-state.updatedAt)/1000;
 return estimate>0?Math.min(86400,estimate):undefined;
}
