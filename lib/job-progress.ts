export const progressStages=['downloading','separating','beats','chords','lyrics','uploading','saving'] as const;
export type JobProgress={stage:typeof progressStages[number];percent?:number;etaSeconds?:number;connectionLost?:boolean;startedAt:number;updatedAt:number};
export function safeProgress(value:any,now=Date.now()):JobProgress|undefined{
 if(!value||!progressStages.includes(value.stage))return undefined;
 const finite=(x:any)=>typeof x==='number'&&Number.isFinite(x);
 return {stage:value.stage,connectionLost:!!value.connectionLost,percent:finite(value.percent)?Math.max(0,Math.min(100,value.percent)):undefined,etaSeconds:finite(value.etaSeconds)&&value.etaSeconds>=0?Math.min(86400,value.etaSeconds):undefined,startedAt:finite(value.startedAt)?Math.min(now,Math.max(0,value.startedAt)):now,updatedAt:now};
}
export const progressLabel=(stage:JobProgress['stage'])=>({downloading:'Downloading recording to your Mac',separating:'Separating vocals, drums, bass and other',beats:'Detecting tempo and beat timing',chords:'Estimating chords and key',lyrics:'Transcribing lyrics',uploading:'Uploading separated stems',saving:'Saving results to your song'}[stage]);
