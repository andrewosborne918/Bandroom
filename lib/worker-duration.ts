// Queue reservations use whole seconds, while FFprobe reports fractional seconds.
// Leave a small probe tolerance without changing billing or upload limits.
export function workerDurationLimit(reserved:number,verified:number){
 const duration=Math.max(Number(reserved)||0,Number(verified)||0);
 return Math.ceil(duration+.1);
}
