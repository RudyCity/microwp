/**
 * Explicit operator-run, authenticated Cloudflare Free CPU/WordPress canary.
 * Reads a locally ignored token only when deliberately invoked by an operator.
 * Never deploys, changes billing, reads remote databases, or prints the token.
 *
 * IMPORTANT: HTTP response latency and runtime requestMs are NOT cpuTime.
 * Correlate both execution scopes with actual Cloudflare invocation telemetry.
 */
import {randomUUID} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
import {
  CANARY_PATH,CPU_SAMPLES,PROBE_ID_HEADER,parseRemoteProbeOrigin,
  validTokenFormat,verifyRemoteCanaryResponse,type CanaryTask
} from "../src/probes/free-do-cpu-policy";

const origin=parseRemoteProbeOrigin(process.env.MICROWP_CPU_PROBE_URL);
const key=(await readFile(".wrangler/free-do-cpu.key","utf8")).trim();
if(!validTokenFormat(key))throw new Error("Missing strong locally ignored CPU canary secret");
const MAX_RESPONSE_BYTES=8192;
type Report={
  task:string;requestId:string;httpStatus:number;httpVerified:boolean;
  clientWallMs:number;diagnostic?:string;
};
const reports:Report[]=[];

/** A hostile/error response is never allowed to allocate an unbounded body. */
async function readBoundedJson(response:Response):Promise<unknown>{
  const len=response.headers.get("Content-Length");
  if(len!==null&&(/^\d+$/.test(len)===false||Number(len)>MAX_RESPONSE_BYTES))
    throw new Error("BAD_RESPONSE_SIZE");
  if(!response.body)throw new Error("EMPTY_RESPONSE");
  const reader=response.body.getReader();
  const chunks:Uint8Array[]=[];
  let total=0;
  let completed=false;
  try{
    while(true){
      const next=await reader.read();
      if(next.done){completed=true;break}
      total+=next.value.byteLength;
      if(total>MAX_RESPONSE_BYTES)throw new Error("BAD_RESPONSE_SIZE");
      chunks.push(next.value);
    }
  }finally{
    if(!completed)await reader.cancel().catch(()=>undefined);
    reader.releaseLock();
  }
  const bytes=new Uint8Array(total);
  let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
  return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
}

async function run(task:CanaryTask,timeoutMs:number):Promise<void>{
  const requestId=randomUUID();
  const label=task.mode+(task.mode==="cpu"?":"+task.loops:"");
  const start=performance.now();
  let httpStatus=0;
  let httpVerified=false;
  let diagnostic:string|undefined;
  try{
    const response=await fetch(origin+CANARY_PATH,{method:"POST",headers:{
      "Content-Type":"application/json",
      "X-MicroWP-Probe-Key":key,
      [PROBE_ID_HEADER]:requestId
    },body:JSON.stringify(task),signal:AbortSignal.timeout(timeoutMs),redirect:"manual"});
    httpStatus=response.status;
    const raw=await readBoundedJson(response);
    httpVerified=verifyRemoteCanaryResponse(task,requestId,httpStatus,
      response.headers.get(PROBE_ID_HEADER),raw);
    if(!httpVerified)diagnostic="RESPONSE_NOT_VERIFIED";
  }catch{
    diagnostic="REQUEST_OR_BOUNDED_RESPONSE_FAILED";
  }
  reports.push({task:label,requestId,httpStatus,httpVerified,
    clientWallMs:Math.round(performance.now()-start),...(diagnostic?{diagnostic}:{})});
}

// Exactly seven fixed probes, sequentially; no retries or free-form workloads.
for(const loops of CPU_SAMPLES)await run({mode:"cpu",loops},25000);
await run({mode:"php",loops:0},75000);
await run({mode:"wordpress",loops:0},95000);

const result={
  at:new Date().toISOString(),endpoint:origin,
  status:reports.every(r=>r.httpVerified)?
    "AUTHENTICATED_REMOTE_HTTP_ONLY_CPU_UNVERIFIED":"REMOTE_HTTP_PROBES_NOT_ALL_VERIFIED",
  cpuEvidence:"NOT_COLLECTED",memoryEvidence:"NOT_COLLECTED",
  note:"These are bounded HTTP checks, not CPU or memory measurements. Join requestId against Cloudflare ingress Worker AND SQLite Durable Object invocation logs; verify per-invocation cpuTime/outcome independently. Do not convert clientWallMs to CPU time or assert production readiness.",
  results:reports
};
await writeFile(".wrangler/free-do-cpu-remote-results.json",JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify(result,null,2));
if(reports.some(r=>!r.httpVerified))process.exitCode=1;
