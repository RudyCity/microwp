import type {Env} from "./types";

/**
 * Read-only operator-managed R2 overlay for static WordPress theme and plugin
 * assets. Executable PHP and arbitrary wp-content files are never served.
 * WordPress core/theme PHP code remains pinned in the immutable build archive.
 */
const SUPPORTED=/\.(?:css|js|mjs|json|jpg|jpeg|png|gif|webp|avif|ico|woff|woff2|ttf|otf|eot)$/i;
const PREFIX=/^\/wp-content\/(?:themes|plugins|mu-plugins)\//;
const MIME:Record<string,string>={
 css:"text/css",js:"text/javascript",mjs:"text/javascript",json:"application/json",
 jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",gif:"image/gif",
 webp:"image/webp",avif:"image/avif",ico:"image/x-icon",
 woff:"font/woff",woff2:"font/woff2",ttf:"font/ttf",otf:"font/otf",eot:"application/vnd.ms-fontobject"
};
export function staticWpContentR2Key(path:string):string|null{
 if(!PREFIX.test(path)||!SUPPORTED.test(path)||path.length>512||path.includes("\\")||path.includes("//"))return null;
 const segments=path.split("/").filter(Boolean);
 if(segments.some(s=>!s||s==="."||s===".."||s.startsWith(".")||s.includes("%")))return null;
 return path.slice(1);
}
export async function getR2WpContentStatic(request:Request,env:Env,path:string):Promise<Response|null>{
 if(!env.MEDIA||!["GET","HEAD"].includes(request.method))return null;
 const key=staticWpContentR2Key(path);
 if(!key)return null;
 try{
  const item=await env.MEDIA.get(key);
  if(!item)return null; // immutable ASSETS fallback
  const ext=key.split(".").at(-1)?.toLowerCase()??"";
  const headers=new Headers({"Content-Type":MIME[ext]??"application/octet-stream",
    "Cache-Control":"public, max-age=600","ETag":item.etag,
    "Content-Length":String(item.size),"X-Content-Type-Options":"nosniff"});
  if(request.headers.get("If-None-Match")===item.etag)return new Response(null,{status:304,headers});
  return new Response(request.method==="HEAD"?null:item.body,{status:200,headers});
 }catch{return new Response("R2 content unavailable",{status:503,headers:{"Cache-Control":"no-store"}})}
}
