/**
 * Standalone token-protected Worker -> SQLite-backed Durable Object canary.
 * No D1/R2, public WordPress route, account/billing changes, or user data.
 *
 * Each log includes an opaque correlation ID and the execution scope.
 * Platform invocation cpuTime/outcome (not application clocks) is required
 * to assess the separate Free ingress and SQLite DO CPU budgets.
 */
import {DurableObject} from "cloudflare:workers";
import {runNativeStagingProbe} from "../php/native";
import {
  authorizeToken,boundedWork,CANARY_BODY_MAX,CANARY_PATH,CANARY_PROTOCOL,
  INTERNAL_PATH,PROBE_ID_HEADER,validProbeId,validateTask,type CanaryTask
} from "./free-do-cpu-policy";
import {readBoundedRequestBody} from "../php/bounded-body";

interface Env {
  CPU_PROBE_DO:DurableObjectNamespace<MicroWPFreeCpuDO>;
  STAGING_PROBE_KEY?:string;
  MICROWP_STAGING_MODE?:string;
}
const SAFE_HEADERS={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
function closed():Response{
  return new Response("Not Found",{status:404,headers:SAFE_HEADERS});
}
function json(data:unknown,status=200,id?:string):Response{
  return Response.json(data,{status,headers:{...SAFE_HEADERS,...(id?{[PROBE_ID_HEADER]:id}:{})}});
}
function unavailable():Response{
  return json({error:"CANARY_UNAVAILABLE"},503);
}
function trace(scope:"ingress-worker"|"sqlite-durable-object",stage:"begin"|"completed"|"failed",
  requestId:string,task:CanaryTask,extra?:Record<string,unknown>):void{
  // Never log headers, tokens, body, PHP output, or any account-specific data.
  console.info("microwp-free-do-cpu-trace",JSON.stringify({
    protocol:CANARY_PROTOCOL,requestId,scope,stage,mode:task.mode,
    ...(task.mode==="cpu"?{loops:task.loops}:{}),...extra
  }));
}
async function getTask(request:Request):Promise<CanaryTask|null>{
  if(request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase()!=="application/json")return null;
  try{
    const body=await readBoundedRequestBody(request,CANARY_BODY_MAX);
    if(!body||body.byteLength===0)return null;
    return validateTask(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(body)));
  }catch{return null}
}
export class MicroWPFreeCpuDO extends DurableObject<Env> {
  private busy=false;
  async fetch(request:Request):Promise<Response>{
    if(request.method!=="POST"||new URL(request.url).pathname!==INTERNAL_PATH)return closed();
    if(!await authorizeToken(request.headers.get("X-MicroWP-Internal-Key"),this.env.STAGING_PROBE_KEY))return closed();
    if(this.env.MICROWP_STAGING_MODE!=="isolated-probe-only")return unavailable();
    const requestId=request.headers.get(PROBE_ID_HEADER);
    if(!validProbeId(requestId))return json({error:"INVALID_PROBE_ID"},400);
    const task=await getTask(request);
    if(!task)return json({error:"INVALID_TASK"},400,requestId);
    if(this.busy)return json({error:"CANARY_BUSY"},429,requestId);
    this.busy=true;
    trace("sqlite-durable-object","begin",requestId,task);
    try{
      if(task.mode==="cpu"){
        const checksum=boundedWork(task.loops);
        trace("sqlite-durable-object","completed",requestId,task,{ok:true});
        return json({ok:true,protocol:CANARY_PROTOCOL,requestId,scope:"durable-object",
          mode:task.mode,loops:task.loops,checksum},200,requestId);
      }
      // PHP-WASM and the fixed WordPress installer GET execute INSIDE this DO.
      const probe=await runNativeStagingProbe(this.env,task.mode==="wordpress"?"wordpress":"runtime");
      trace("sqlite-durable-object","completed",requestId,task,{ok:probe.ok});
      return json({ok:probe.ok,protocol:CANARY_PROTOCOL,requestId,scope:"durable-object",
        mode:task.mode,phpVersion:probe.phpVersion,sqlite:probe.sqlite,
        installerStatus:probe.installerStatus,installerForm:probe.installerForm,
        // Application timing is diagnostic only, not Cloudflare CPU time.
        requestMs:probe.requestMs,stats:probe.stats},probe.ok?200:503,requestId);
    }catch{
      trace("sqlite-durable-object","failed",requestId,task);
      return unavailable();
    }finally{
      this.busy=false;
    }
  }
}
export default {
  async fetch(request:Request,env:Env):Promise<Response>{
    const url=new URL(request.url);
    if(url.pathname!==CANARY_PATH||request.method!=="POST")return closed();
    if(!await authorizeToken(request.headers.get("X-MicroWP-Probe-Key"),env.STAGING_PROBE_KEY))return closed();
    if(env.MICROWP_STAGING_MODE!=="isolated-probe-only")return unavailable();
    const requestedId=request.headers.get(PROBE_ID_HEADER);
    if(requestedId!==null&&!validProbeId(requestedId))return json({error:"INVALID_PROBE_ID"},400);
    const requestId=requestedId??crypto.randomUUID();
    const task=await getTask(request);
    if(!task)return json({error:"INVALID_TASK"},400,requestId);
    trace("ingress-worker","begin",requestId,task);
    try{
      // A fixed, isolated SQLite Durable Object identity, not a production site.
      const stub=env.CPU_PROBE_DO.get(env.CPU_PROBE_DO.idFromName("free-do-cpu-private-v1"));
      const result=await stub.fetch(new Request("https://microwp-private.invalid"+INTERNAL_PATH,{
        method:"POST",headers:{
          "Content-Type":"application/json",
          "X-MicroWP-Internal-Key":env.STAGING_PROBE_KEY!,
          [PROBE_ID_HEADER]:requestId
        },body:JSON.stringify(task)
      }));
      trace("ingress-worker","completed",requestId,task,{httpStatus:result.status});
      return result;
    }catch{
      trace("ingress-worker","failed",requestId,task);
      return unavailable();
    }
  }
};
