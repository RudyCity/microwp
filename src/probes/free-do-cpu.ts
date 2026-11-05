/**
 * Standalone, token-protected Worker -> Durable Object CPU/PHP/WP canary.
 * No D1/R2, public WordPress route, billing settings, or user data.
 *
 * IMPORTANT: Successful responses show that a request completed, NOT its
 * precise Cloudflare CPU usage; inspect CPU traces with Cloudflare logs.
 */
import {DurableObject} from "cloudflare:workers";
import {runNativeStagingProbe} from "../php/native";
import {
  authorizeToken,boundedWork,CANARY_BODY_MAX,CANARY_PATH,INTERNAL_PATH,
  validateTask,type CanaryTask
} from "./free-do-cpu-policy";
import {readBoundedRequestBody} from "../php/bounded-body";

interface Env {
 CPU_PROBE_DO:DurableObjectNamespace<MicroWPFreeCpuDO>;
 STAGING_PROBE_KEY?:string;
 MICROWP_STAGING_MODE?:string;
}
function closed():Response{
 return new Response("Not Found",{status:404,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
}
function unavailable():Response{
 return Response.json({error:"CANARY_UNAVAILABLE"},{status:503,headers:{"Cache-Control":"no-store"}});
}
async function getTask(request:Request):Promise<CanaryTask|null>{
 try{
  const body=await readBoundedRequestBody(request,CANARY_BODY_MAX);
  if(!body||body.byteLength===0)return null;
  return validateTask(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(body)));
 }catch{return null}
}
export class MicroWPFreeCpuDO extends DurableObject<Env> {
 async fetch(request:Request):Promise<Response>{
  if(request.method!=="POST"||new URL(request.url).pathname!==INTERNAL_PATH)return closed();
  if(!await authorizeToken(request.headers.get("X-MicroWP-Internal-Key"),this.env.STAGING_PROBE_KEY))return closed();
  if(this.env.MICROWP_STAGING_MODE!=="isolated-probe-only")return unavailable();
  const task=await getTask(request);
  if(!task)return new Response("Bad Request",{status:400});
  if(task.mode==="cpu"){
   const checksum=boundedWork(task.loops);
   console.info("microwp-free-do-canary",JSON.stringify({mode:task.mode,loops:task.loops,scope:"durable-object",completed:true}));
   return Response.json({ok:true,scope:"durable-object",mode:task.mode,loops:task.loops,checksum},{headers:{"Cache-Control":"no-store"}});
  }
  // WordPress loads and executes as PHP inside the Durable Object, not ingress.
  const probe=await runNativeStagingProbe(this.env,task.mode==="wordpress"?"wordpress":"runtime");
  const report={ok:probe.ok,scope:"durable-object",mode:task.mode,
    phpVersion:probe.phpVersion,sqlite:probe.sqlite,
    installerStatus:probe.installerStatus,installerForm:probe.installerForm,
    requestMs:probe.requestMs,stats:probe.stats};
  console.info("microwp-free-do-canary",JSON.stringify({mode:task.mode,scope:"durable-object",completed:probe.ok}));
  return Response.json(report,{status:probe.ok?200:503,headers:{"Cache-Control":"no-store"}});
 }
}
export default {
 async fetch(request:Request,env:Env):Promise<Response>{
  const url=new URL(request.url);
  if(url.pathname!==CANARY_PATH||request.method!=="POST")return closed();
  if(!await authorizeToken(request.headers.get("X-MicroWP-Probe-Key"),env.STAGING_PROBE_KEY))return closed();
  if(env.MICROWP_STAGING_MODE!=="isolated-probe-only")return unavailable();
  const task=await getTask(request);
  if(!task)return new Response("Bad Request",{status:400});
  try{
   // A fixed, isolated Durable Object identity, separate from production WordPress.
   const stub=env.CPU_PROBE_DO.get(env.CPU_PROBE_DO.idFromName("free-do-cpu-private-v1"));
   return await stub.fetch(new Request("https://microwp-private.invalid"+INTERNAL_PATH,{
     method:"POST",headers:{
       "Content-Type":"application/json",
       "X-MicroWP-Internal-Key":env.STAGING_PROBE_KEY!,
     },body:JSON.stringify(task)
   }));
  }catch(e){
   console.error("microWP CPU probe failed",e instanceof Error?e.name:"unknown");
   return unavailable();
  }
 }
};
