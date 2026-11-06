/**
 * LOCAL-ONLY editorial E2E facade over the real WordPress Durable Object.
 * A fixed-key cache diagnostic lets tests prove post-commit invalidation.
 * Never deploy or expose via external DNS.
 */
import originalWorker,{MicroWPSite as BaseMicroWPSite} from "../index-durable";
import {getPHP} from "../php/native";
import {WORDPRESS_TRANSIENT_PROOF_PHP} from "./wp-transients-local-plugin";
import {WorkerRedisClient} from "../worker-cache/client";
import type {Env,ExecutionCtx} from "../types";
/** Inject one fixed authenticated transient test route in LOCAL Workerd only. */
export class MicroWPSite extends BaseMicroWPSite {
 private localPluginReady?:Promise<void>;
 override async fetch(request:Request):Promise<Response>{
  const url=new URL(request.url);
  const env=this.env as Env & {MICROWP_LOCAL_TRANSIENT_PROOF?:string};
  // The base DO must restore its persisted WordPress auth secret and D1 first.
  // Preparing PHP before super.fetch() would construct wp-config with a
  // different auth secret and break login across Durable Object restarts.
  const response=await super.fetch(request);
  if(url.hostname==="127.0.0.1"&&env.MICROWP_LOCAL_TRANSIENT_PROOF==="yes"){
   if(!this.localPluginReady)this.localPluginReady=(async()=>{
    const php=await getPHP(url.origin,env);
    if(!php.fileExists("/www/wp-content/mu-plugins"))
     php.mkdir("/www/wp-content/mu-plugins");
    php.writeFile("/www/wp-content/mu-plugins/microwp-transient-local-only.php",
     WORDPRESS_TRANSIENT_PROOF_PHP);
   })();
   try{await this.localPluginReady}
   catch{
    return Response.json({error:"LOCAL_TRANSIENT_PROOF_UNAVAILABLE"},{status:503});
   }
  }
  return response;
 }
}
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
