export const FREE_STORAGE_BYTES=2*1024**3;
export function formatStorage(bytes:number){
 const value=Math.max(0,Number(bytes)||0);
 return value>=1024**3?(value/1024**3).toFixed(2)+' GiB':(value/1024**2).toFixed(1)+' MiB';
}
export function storageUsage(stored:number,reserved:number,limit:number|null){
 const used=Math.max(0,Number(stored)||0)+Math.max(0,Number(reserved)||0);
 const unlimited=limit===null,cap=Math.max(0,Number(limit)||0);
 return {used,unlimited,remaining:unlimited?null:Math.max(0,cap-used),percent:unlimited?0:cap?Math.min(100,used/cap*100):100};
}
