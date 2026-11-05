import type {Env} from "./types";

const PREFIX="/wp-content/uploads/";
/** The shared R2 bucket stores writable WordPress content under wp-content/uploads/. */
export const R2_UPLOADS_PREFIX="wp-content/uploads/";
const VALID_EXT=/\.(?:jpg|jpeg|png|gif|webp|avif|ico|pdf|txt|mp3|mp4|webm|ogg|wav)$/i;
const TYPES:Record<string,string>={
 jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",gif:"image/gif",webp:"image/webp",
 avif:"image/avif",ico:"image/x-icon",pdf:"application/pdf",txt:"text/plain",
 mp3:"audio/mpeg",mp4:"video/mp4",webm:"video/webm",ogg:"audio/ogg",wav:"audio/wav"
};
export const MAX_MEDIA_BYTES=10*1024*1024;
export function mediaKey(path:string):string|null{
 if(!path.startsWith(PREFIX))return null;
 const key=path.slice(PREFIX.length);
 if(!key||key.length>512||key.normalize("NFC")!==key||key.includes("\\")||/[\u0000-\u001f\u007f?#%]/.test(key)||key.includes("//")||
    key.split("/").some(p=>!p||p==="."||p===".."||p.startsWith(".")||/[.\s]$/.test(p)))return null;
 return VALID_EXT.test(key)?key:null;
}
/** Only the uploads namespace is writable from the WordPress runtime; never a PHP filename. */
export function r2MediaKey(path:string):string|null{
 const key=mediaKey(path);
 return key===null?null:R2_UPLOADS_PREFIX+key;
}
export function contentTypeFor(key:string):string{
 const ext=key.split(".").at(-1)?.toLowerCase()??"";
 return TYPES[ext]??"application/octet-stream";
}
export async function getMedia(request:Request,env:Env,path:string):Promise<Response>{
 if(request.method!=="GET"&&request.method!=="HEAD")return new Response("Method Not Allowed",{status:405,headers:{Allow:"GET, HEAD"}});
 const key=mediaKey(path);
 if(!key)return new Response("Not Found",{status:404});
 if(!env.MEDIA)return new Response("Media storage is not configured",{status:503});
 try{
  // Legacy lookup is read-only during transition; all new writes use wp-content/uploads/.
  const file=await env.MEDIA.get(R2_UPLOADS_PREFIX+key)??await env.MEDIA.get(key);
  if(!file)return new Response("Not Found",{status:404});
  const headers=new Headers({
   "Content-Type":contentTypeFor(key),"Cache-Control":"public, max-age=3600",
   "ETag":file.etag,"Content-Length":String(file.size),"X-Content-Type-Options":"nosniff"
  });
  if(key.toLowerCase().endsWith(".pdf")||key.toLowerCase().endsWith(".txt"))headers.set("Content-Disposition","attachment");
  if(request.headers.get("if-none-match")===file.etag)return new Response(null,{status:304,headers});
  return new Response(request.method==="HEAD"?null:file.body,{status:200,headers});
 }catch{return new Response("Media storage unavailable",{status:503})}
}
export function validMediaSignature(key:string,bytes:Uint8Array):boolean{
 const ext=key.split(".").at(-1)?.toLowerCase();
 const has=(off:number,list:number[])=>bytes.byteLength>=off+list.length&&list.every((c,i)=>bytes[off+i]===c);
 const str=(off:number,value:string)=>has(off,Array.from(value).map(c=>c.charCodeAt(0)));
 switch(ext){
  case "jpg":case "jpeg":return has(0,[255,216,255]);
  case "png":return has(0,[137,80,78,71,13,10,26,10]);
  case "gif":return str(0,"GIF87a")||str(0,"GIF89a");
  case "webp":return str(0,"RIFF")&&str(8,"WEBP");
  case "avif":return str(4,"ftyp")&&(str(8,"avif")||str(8,"avis"));
  case "ico":return has(0,[0,0,1,0]);
  case "pdf":return str(0,"%PDF-");
  case "mp3":return str(0,"ID3")||(bytes.byteLength>=2&&bytes[0]===255&&(bytes[1]&224)===224);
  case "mp4":return str(4,"ftyp");
  case "webm":return has(0,[26,69,223,163]);
  case "ogg":return str(0,"OggS");
  case "wav":return str(0,"RIFF")&&str(8,"WAVE");
  case "txt":return bytes.byteLength<1024*1024&&!bytes.includes(0);
  default:return false;
 }
}
/** Private runtime helper, never an unauthenticated upload endpoint. */
export async function putMedia(env:Env,path:string,bytes:Uint8Array):Promise<void>{
 const key=r2MediaKey(path);
 if(!key||!env.MEDIA)throw new Error("Invalid media path or storage not configured");
 if(bytes.byteLength>MAX_MEDIA_BYTES)throw new Error("Media exceeds configured limit");
 if(!validMediaSignature(key,bytes))throw new Error("Media signature does not match extension");
 await env.MEDIA.put(key,bytes,{httpMetadata:{contentType:contentTypeFor(key),cacheControl:"public, max-age=3600"}});
}
