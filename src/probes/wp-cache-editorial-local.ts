/**
 * LOCAL-ONLY editorial E2E facade over the real WordPress Durable Object.
 * A fixed-key cache diagnostic lets tests prove post-commit invalidation.
 * Never deploy or expose via external DNS.
 */
import originalWorker,{MicroWPSite} from "../index-durable";
import {WorkerRedisClient} from "../worker-cache/client";
import type {Env,ExecutionCtx} from "../types";
export {MicroWPSite};
interface LocalEnv extends Env {SITE_DO:DurableObjectNamespace<MicroWPSite>}
const FIXED_KEY="home:v0123456789abcdef";
const FIXED_VALUE="verified-public-data";
function testRoute(request:Request):"seed"|"check"|null{
 const url=new URL(request.url);
 if(url.hostname!=="127.0.0.1"||request.method!=="POST"||url.search||url.hash)return null;
 if(url.pathname==="/__local/public-cache-seed")return "seed";
 if(url.pathname==="/__local/public-cache-check")return "check";
 return null;
}
export default {
 async fetch(request:Request,env:LocalEnv,ctx:ExecutionCtx):Promise<Response>{
  const mode=testRoute(request);
  if(mode){
   if(env.MICROWP_WORKER_CACHE_ENABLED!=="yes"||!env.REDIS_WORKER)
    return new Response("Not Found",{status:404});
   try{
    const client=new WorkerRedisClient(env.REDIS_WORKER,"microwp_single_site");
    if(mode==="seed"){
     const stored=await client.set("microwp_public",FIXED_KEY,FIXED_VALUE,300);
     return Response.json({ok:stored,stored},{status:stored?200:503,headers:{"Cache-Control":"no-store"}});
    }
    const value=await client.get("microwp_public",FIXED_KEY);
    return Response.json({ok:true,found:value!==null,valid:value===FIXED_VALUE},
     {headers:{"Cache-Control":"no-store"}});
   }catch{return Response.json({ok:false},{status:503})}
  }
  return originalWorker.fetch(request,env,ctx);
 }
};
