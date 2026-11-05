/**
 * Explicit operator-run PRIVATE Cloudflare CPU/WordPress diagnostic.
 * Requires .wrangler/free-do-cpu.key and MICROWP_CPU_PROBE_URL.
 * Does not deploy, change plan/billing, or log its secret.
 */
import {readFile,writeFile} from "node:fs/promises";
import {CANARY_PATH,CPU_SAMPLES,type CanaryTask} from "../src/probes/free-do-cpu-policy";

const url=new URL(process.env.MICROWP_CPU_PROBE_URL??"https://invalid.example");
if(url.protocol!=="https:"||!/^(?:microwp-free-do-cpu-probe)\.[a-z0-9-]+\.workers\.dev$/.test(url.hostname)
 ||url.pathname!=="/"||url.search||url.hash)throw new Error("Expected the isolated Cloudflare workers.dev canary HTTPS origin");
const key=(await readFile(".wrangler/free-do-cpu.key","utf8")).trim();
if(!/^[A-Za-z0-9_-]{64,128}$/.test(key))throw new Error("Missing strong locally ignored CPU canary secret");
type Report={task:string;httpStatus:number;ok:boolean;scope?:string;clientWallMs:number;diagnostic?:string};
const reports:Report[]=[];
async function run(task:CanaryTask,timeoutMs:number){
 const start=performance.now();
 let response:Response;
 try{
  response=await fetch(url.origin+CANARY_PATH,{method:"POST",headers:{
   "Content-Type":"application/json","X-MicroWP-Probe-Key":key,
  },body:JSON.stringify(task),signal:AbortSignal.timeout(timeoutMs),redirect:"manual"});
 }catch(e){
  reports.push({task:task.mode+(task.mode==="cpu"?":"+task.loops:""),httpStatus:0,ok:false,clientWallMs:Math.round(performance.now()-start),
    diagnostic:e instanceof Error?e.name:"unknown"});
  return;
 }
 const body=await response.text();
 let parsed:Record<string,unknown>={};
 try{parsed=JSON.parse(body)}catch{}
 const label=task.mode+(task.mode==="cpu"?":"+task.loops:"");
 const ok=response.status===200&&parsed.ok===true&&parsed.scope==="durable-object"&&parsed.mode===task.mode;
 reports.push({task:label,httpStatus:response.status,ok,scope:typeof parsed.scope==="string"?parsed.scope:undefined,
  clientWallMs:Math.round(performance.now()-start),diagnostic:ok?undefined:"Remote result was not successful"});
}
for(const loops of CPU_SAMPLES)await run({mode:"cpu",loops},25000);
await run({mode:"php",loops:0},75000);
await run({mode:"wordpress",loops:0},95000);
const result={at:new Date().toISOString(),endpoint:url.origin,
 note:"Client wall time is NOT Cloudflare CPU; correlate each probe with Cloudflare per-invocation outcome/cpuTime logs. No billing change.",
 results:reports};
await writeFile(".wrangler/free-do-cpu-remote-results.json",JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify(result,null,2));
if(reports.some(r=>!r.ok))process.exitCode=1;
