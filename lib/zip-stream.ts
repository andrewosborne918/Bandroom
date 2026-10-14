// ZIP data descriptors allow streaming audio without buffering it in server memory.
export function streamZip(files:{name:string;size:number;body:ReadableStream<Uint8Array>}[]){
 const enc=new TextEncoder(),table=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0});
 const stream=new TransformStream<Uint8Array,Uint8Array>(),writer=stream.writable.getWriter();
 void(async()=>{let offset=0;const central:Uint8Array[]=[];for(const file of files){const name=enc.encode(file.name),start=offset,h=new Uint8Array(30+name.length),v=new DataView(h.buffer);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x808,true);v.setUint16(26,name.length,true);h.set(name,30);await writer.write(h);offset+=h.length;
 let crc=0xffffffff,size=0;const reader=file.body.getReader();while(true){const r=await reader.read();if(r.done)break;for(const b of r.value)crc=table[(crc^b)&255]^(crc>>>8);size+=r.value.length;await writer.write(r.value);offset+=r.value.length;}crc=(crc^0xffffffff)>>>0;
 const desc=new Uint8Array(16),d=new DataView(desc.buffer);d.setUint32(0,0x08074b50,true);d.setUint32(4,crc,true);d.setUint32(8,size,true);d.setUint32(12,size,true);await writer.write(desc);offset+=16;
 const c=new Uint8Array(46+name.length),cv=new DataView(c.buffer);cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x808,true);cv.setUint32(16,crc,true);cv.setUint32(20,size,true);cv.setUint32(24,size,true);cv.setUint16(28,name.length,true);cv.setUint32(42,start,true);c.set(name,46);central.push(c);
 }let total=0;for(const c of central){await writer.write(c);total+=c.length}const end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,total,true);v.setUint32(16,offset,true);await writer.write(end);await writer.close();})().catch(e=>writer.abort(e));return stream.readable;
}
