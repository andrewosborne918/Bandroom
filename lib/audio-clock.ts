export type ClockSample={at:number;rtt:number;offset:number};
export function clockSample(t0:number,t3:number,received:number,sent:number):ClockSample{
 if(![t0,t3,received,sent].every(Number.isFinite)||t3<t0||sent<received||sent-received>t3-t0+1)throw Error('Invalid clock measurement');
 return {at:t3,rtt:Math.max(0,t3-t0-(sent-received)),offset:((received-t0)+(sent-t3))/2};
}
export function calibratedClock(samples:ClockSample[],at:number){
 const recent=samples.filter(sample=>at-sample.at<=60000&&at>=sample.at).slice(-20);if(!recent.length)return null;
 const best=[...recent].sort((a,b)=>a.rtt-b.rtt)[0],offsets=recent.filter(sample=>sample.rtt<=best.rtt+10).slice(-5).map(sample=>sample.offset).sort((a,b)=>a-b),offset=offsets[Math.floor(offsets.length/2)];
 return {samples:recent,offset,rtt:best.rtt,uncertainty:best.rtt/2+Math.max(...offsets.map(value=>Math.abs(value-offset))),fresh:at-Math.max(...recent.map(sample=>sample.at))<45000};
}
// Maps an audible output timestamp to the device's monotonic clock. This avoids
// treating an audio render quantum or Bluetooth output queue as already heard.
export function outputAudioTime(context:AudioContext,serverMs:number,serverNow:number,performanceNow:number,adjustment=0){
 const stamp=context.getOutputTimestamp?.();if(stamp?.contextTime&&stamp.performanceTime&&Math.abs(performanceNow-stamp.performanceTime)<1000){return stamp.contextTime+(performanceNow-stamp.performanceTime+serverMs-serverNow+adjustment)/1000}
 return context.currentTime+(serverMs-serverNow+adjustment)/1000-(context.outputLatency||context.baseLatency||0);
}
