/**
 * Experimental Free-tier public delivery path.
 *
 * NEVER boots PHP/WordPress, executes user SQL, publishes content, or writes D1/R2.
 * It is not wired into the deployed staging or public Worker.
 */
import {blockedPath, safePathname, withSafetyHeaders} from "../security";
import {contentTypeFor, MAX_MEDIA_BYTES, r2MediaKey} from "../media";
import {getR2WpContentStatic, staticWpContentR2Key} from "../wp-content-static";
import type {Env} from "../types";

export interface FreePreviewEnv extends Env {
  /** Server-controlled opt-in. Never set this flag on the existing staging Worker. */
  MICROWP_FREE_PREVIEW_MODE?: string;
}

const API_PATH="/__microwp/free/posts";
const encoder=new TextEncoder();
const SLUG=/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/;
const MAX_RESULTS=20;
const MAX_BODY=64*1024;
const NO_STORE={"Cache-Control":"no-store"};

function result(status:number,message:string):Response {
  return withSafetyHeaders(new Response(message,{status,headers:NO_STORE}));
}
function deniedRoute(path:string):boolean {
  return path.startsWith("/wp-admin") || path.startsWith("/wp-json") ||
    path.startsWith("/wp-login") || path.startsWith("/xmlrpc") ||
    path.endsWith(".php") || path.startsWith("/__microwp/") ||
    path.startsWith("/wp-content/uploads/.") || path.startsWith("/wp-content/upgrade/");
}
function rowValid(row:unknown):row is {slug:string;title:string;excerpt:string;published_at:string} {
  if(row===null||typeof row!=="object"||Array.isArray(row))return false;
  const v=row as Record<string,unknown>;
  return typeof v.slug==="string"&&SLUG.test(v.slug) &&
    typeof v.title==="string"&&encoder.encode(v.title).length<=400 &&
    typeof v.excerpt==="string"&&encoder.encode(v.excerpt).length<=1400 &&
    typeof v.published_at==="string"&&v.published_at.length<=40;
}

/** Read-only D1 public post index. Only a fixed SQL query; never accept SQL input. */
async function publicPostIndex(env:FreePreviewEnv):Promise<Response> {
  if(!env.DB)return result(503,"Public index unavailable");
  try {
    // The publishing system, NOT an HTTP request, owns the table and write process.
    const query="SELECT slug, title, excerpt, published_at FROM microwp_free_posts WHERE status = ? ORDER BY published_at DESC LIMIT ?";
    const dbResponse=await env.DB.prepare(query).bind("published",MAX_RESULTS).all();
    if(!dbResponse.success||!Array.isArray(dbResponse.results)||
      dbResponse.results.length>MAX_RESULTS||!dbResponse.results.every(rowValid))
      return result(503,"Public index unavailable");
    const payload=JSON.stringify({posts:dbResponse.results}).replace(/</g,"\\u003c");
    if(encoder.encode(payload).length>MAX_BODY)return result(503,"Public index unavailable");
    return withSafetyHeaders(new Response(payload,{status:200,headers:{
      "Content-Type":"application/json; charset=utf-8",...NO_STORE,
    }}));
  }catch {
    return result(503,"Public index unavailable");
  }
}
async function media(request:Request,env:FreePreviewEnv,path:string):Promise<Response> {
  const key=r2MediaKey(path);
  if(!key)return result(404,"Not Found");
  if(!env.MEDIA)return result(503,"Media unavailable");
  try {
    // Never use the legacy unprefixed R2 fallback in the public Free preview.
    const object=await env.MEDIA.get(key);
    if(!object)return result(404,"Not Found");
    if(!Number.isSafeInteger(object.size)||object.size<0||object.size>MAX_MEDIA_BYTES)
      return result(503,"Media unavailable");
    const headers=new Headers({
      "Content-Type":contentTypeFor(key),
      "Content-Length":String(object.size),
      "Cache-Control":"public, max-age=3600",
      "ETag":object.etag,
      "X-Content-Type-Options":"nosniff",
    });
    if(key.endsWith(".pdf")||key.endsWith(".txt"))headers.set("Content-Disposition","attachment");
    if(request.headers.get("If-None-Match")===object.etag)
      return withSafetyHeaders(new Response(null,{status:304,headers}));
    return withSafetyHeaders(new Response(request.method==="HEAD"?null:object.body,{status:200,headers}));
  }catch {
    return result(503,"Media unavailable");
  }
}

/**
 * Optional, read-only public renderer for prerendered WordPress pages.
 * No live WordPress PHP routes, writes or free-tier CPU fitness claims.
 */
export async function handleFreePublicRequest(request:Request,env:FreePreviewEnv):Promise<Response> {
  if(env.MICROWP_FREE_PREVIEW_MODE!=="enabled")return result(503,"Free preview disabled");
  if(request.method!=="GET"&&request.method!=="HEAD")
    return withSafetyHeaders(new Response("Method Not Allowed",{status:405,headers:{Allow:"GET, HEAD",...NO_STORE}}));
  let url:URL;
  try{url=new URL(request.url)}catch{return result(400,"Bad Request")}
  const path=safePathname(url);
  if(path===null||blockedPath(path))return result(404,"Not Found");
  if(path===API_PATH){
    if(request.method==="HEAD")return result(405,"Method Not Allowed");
    return publicPostIndex(env);
  }
  if(deniedRoute(path))return result(404,"Not Found");
  if(path.startsWith("/wp-content/uploads/"))return media(request,env,path);
  if(staticWpContentR2Key(path)){
    const overlay=await getR2WpContentStatic(request,env,path);
    if(overlay&&overlay.status!==404)return withSafetyHeaders(overlay);
  }
  if(!env.ASSETS)return result(503,"Static assets unavailable");
  try {
    // The trusted publishing build places HTML/JS/CSS under the ASSETS directory.
    const res=await env.ASSETS.fetch(request);
    if(res.status>=500)return result(503,"Static assets unavailable");
    return withSafetyHeaders(res);
  }catch {return result(503,"Static assets unavailable")}
}
