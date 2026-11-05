import {inflateSync} from "fflate";
import type {PHP} from "@php-wasm/universal";

export interface ZipEntry {name:string;compression:0|8;offset:number;compressed:number;size:number}
const MAX_FILES=4096,MAX_TOTAL=40*1024*1024,MAX_FILE=1024*1024;
function u16(b:DataView,i:number){return b.getUint16(i,true)}
function u32(b:DataView,i:number){return b.getUint32(i,true)}
function validName(name:string):boolean {
  return /\.(?:php|json|css|html|txt|xml)$/.test(name)&&!name.startsWith("/")&&!name.includes("\\")&&!name.includes("//")&&
    name.split("/").every(p=>p && p!==".." && p!=="." && !p.startsWith("."));
}
/** Central directory parser; reads no file payload until PHP includes that file. */
export function indexZip(archive:Uint8Array):ZipEntry[] {
  if(archive.byteLength<22)throw new Error("Invalid PHP ZIP: truncated");
  const view=new DataView(archive.buffer,archive.byteOffset,archive.byteLength);
  let eocd=-1;
  const start=Math.max(0,archive.length-65557);
  for(let i=archive.length-22;i>=start;i--)if(u32(view,i)===0x06054b50){eocd=i;break}
  if(eocd===-1)throw new Error("Missing ZIP end directory");
  const count=u16(view,eocd+10),offset=u32(view,eocd+16);
  if(count>MAX_FILES || count!==u16(view,eocd+8))throw new Error("Unsafe ZIP entry count");
  let pos=offset,total=0;const entries:ZipEntry[]=[];
  const names=new Set<string>();
  for(let n=0;n<count;n++){
    if(pos+46>archive.length || u32(view,pos)!==0x02014b50)throw new Error("Invalid ZIP central entry");
    const compression=u16(view,pos+10);
    const compressed=u32(view,pos+20),size=u32(view,pos+24);
    const nameLength=u16(view,pos+28),extra=u16(view,pos+30),comment=u16(view,pos+32);
    const localOffset=u32(view,pos+42);
    if(pos+46+nameLength+extra+comment>archive.length)throw new Error("ZIP entry escapes archive");
    const name=new TextDecoder().decode(archive.subarray(pos+46,pos+46+nameLength));
    if(!validName(name) || names.has(name)|| (compression!==0 && compression!==8) ||size>MAX_FILE)throw new Error("Unsupported or unsafe PHP ZIP entry");
    names.add(name);total+=size;
    if(total>MAX_TOTAL)throw new Error("PHP ZIP raw memory budget exceeded");
    if(localOffset+30>archive.length||u32(view,localOffset)!==0x04034b50)throw new Error("Invalid ZIP local header");
    const dataStart=localOffset+30+u16(view,localOffset+26)+u16(view,localOffset+28);
    if(dataStart+compressed>archive.length)throw new Error("ZIP compressed data outside archive");
    entries.push({name,compression:compression as 0|8,offset:dataStart,compressed,size});
    pos+=46+nameLength+extra+comment;
  }
  return entries;
}
export function inflateEntry(archive:Uint8Array,entry:ZipEntry):Uint8Array {
  const raw=archive.subarray(entry.offset,entry.offset+entry.compressed);
  const bytes=entry.compression===0?raw:inflateSync(raw);
  if(bytes.byteLength!==entry.size)throw new Error("ZIP entry decoded size mismatch");
  return bytes;
}
export interface MountStats {files:number;bytes:number;elapsedMs:number;loadedFiles:number;loadedBytes:number}
/**
 * Proper Emscripten MEMFS mount with lazy file read streams.
 * Small metadata nodes exist eagerly; PHP and WordPress template/CSS bytes inflate on first FS.read.
 * The archive is immutable; code writes must never modify installed WP sources.
 */
export async function mountWordPress(php:PHP,archive:Uint8Array):Promise<MountStats> {
  const t=Date.now();
  const entries=indexZip(archive);
  const stats:MountStats={files:entries.length,bytes:entries.reduce((n,e)=>n+e.size,0),elapsedMs:0,loadedFiles:0,loadedBytes:0};
  php.mkdir("/www");
  await php.mount("/www",(_php,FS,point)=>{
    FS.mount(FS.filesystems.MEMFS,{},point);
    const directories=new Set<string>([point]);
    for(const entry of entries){
      const segments=entry.name.split("/");
      const filename=segments.pop()!;
      let dir=point;
      for(const segment of segments){
        dir+="/"+segment;
        if(!directories.has(dir)) {FS.mkdir(dir);directories.add(dir);}
      }
      FS.createDataFile(dir,filename,new Uint8Array(),true,false,false);
      const node=FS.lookupPath(dir+"/"+filename).node as any;
      node.usedBytes=entry.size;
      node.contents=null;
      const streamOps=node.stream_ops;
      const origRead=streamOps.read;
      node.stream_ops={
        ...streamOps,
        read(stream:any,buffer:Uint8Array,offset:number,length:number,position:number){
          if(!node.contents) {
            node.contents=inflateEntry(archive,entry);
            stats.loadedFiles++;
            stats.loadedBytes+=entry.size;
          }
          return origRead(stream,buffer,offset,length,position);
        }
      };
    }
    return ()=>FS.unmount(point);
  });
  stats.elapsedMs=Date.now()-t;
  return stats;
}
