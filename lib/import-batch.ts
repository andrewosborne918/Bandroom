export const MAX_BATCH_SONGS=20;
export const fileFingerprint=(file:{name:string;size:number;lastModified:number})=>JSON.stringify([file.name,file.size,file.lastModified]);
export async function processImportBatch<T>(items:T[],work:(item:T)=>Promise<void>,failed:(item:T,error:unknown)=>void,shouldStop:()=>boolean=()=>false){
 for(const item of items){if(shouldStop())break;try{await work(item)}catch(error){failed(item,error)}}
}
