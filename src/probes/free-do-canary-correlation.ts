/**
 * Offline, bounded correlation of the private seven-task HTTP canary with
 * operator-normalized Cloudflare ingress Worker and SQLite DO invocation logs.
 *
 * Never authenticates source provenance. A claimed "cloudflare" source field
 * is untrusted text; no result can confer production eligibility.
 * CPU is NEVER inferred from HTTP client wall time or application requestMs.
 */
import {CPU_SAMPLES,parseRemoteProbeOrigin,validProbeId} from "./free-do-cpu-policy";
import {
  FREE_INGRESS_CPU_MS,SQLITE_DO_DEFAULT_CPU_MS,ISOLATE_MEMORY_BYTES
} from "./free-cpu-budget-evidence";

export const EXPECTED_CANARY_TASKS=[
  ...CPU_SAMPLES.map(n=>"cpu:"+n),"php","wordpress"
] as const;
type CanaryScope="ingress-worker"|"sqlite-durable-object";
type Outcome="ok"|"exceededCpu"|"exceededMemory"|"exception"|"unknown";
export interface CanaryInvocation{
  requestId:string; scope:CanaryScope; mode:"cpu"|"php"|"wordpress";
  outcome:Outcome; cpuTimeMs:number|null; memoryBytes:number|null;
  deploymentId:string;
}
type HttpReport={
  task:string;requestId:string;httpStatus:number;httpVerified:boolean;clientWallMs:number
};
export type CanaryCpuAssessment={
  requestId:string;task:string;httpVerified:boolean;
  ingress:CanaryScopeAssessment;durableObject:CanaryScopeAssessment;
};
export type CanaryScopeAssessment={
  scope:CanaryScope;cpuBudgetMs:number;cpuTimeMs:number|null;
  outcome:Outcome|null;cpuStatus:"within-budget"|"over-budget"|"failed"|"unverified";
  memoryStatus:"within-limit"|"over-limit"|"not-measured";
  deploymentId:string|null;
};
export type CanaryCorrelation={
  status:"DIAGNOSTIC_ONLY_PROVENANCE_NOT_AUTHENTICATED";
  productionReady:false;
  completePairs:number;verifiedHttp:number;tasks:readonly CanaryCpuAssessment[];
  allCpuWithinBudget:boolean;
  memoryAllMeasured:boolean;
  memoryWithinLimit:boolean;
  note:string;
};
const ALLOWED_OUTCOME=new Set<Outcome>(["ok","exceededCpu","exceededMemory","exception","unknown"]);
const MAX_MEMORY=2*1024*1024*1024;
function bounded(n:unknown,max:number):n is number{
  return typeof n==="number"&&Number.isFinite(n)&&n>=0&&n<=max;
}
function object(x:unknown):x is Record<string,unknown>{
  return x!==null&&typeof x==="object"&&!Array.isArray(x);
}
function keysOnly(value:Record<string,unknown>,allowed:readonly string[]):boolean{
  return Object.keys(value).every(k=>allowed.includes(k));
}
function refuse():never{throw new Error("Cloudflare canary evidence correlation rejected");}
function readHttp(raw:unknown):HttpReport[]{
  if(!object(raw)||!Array.isArray(raw.results)||
     raw.results.length!==EXPECTED_CANARY_TASKS.length||
     typeof raw.endpoint!=="string")return refuse();
  try{parseRemoteProbeOrigin(raw.endpoint)}catch{return refuse();}
  const seen=new Set<string>();
  return raw.results.map((entry:unknown,i:number)=>{
    if(!object(entry)||!keysOnly(entry,[
      "task","requestId","httpStatus","httpVerified","clientWallMs","diagnostic"
    ])||entry.task!==EXPECTED_CANARY_TASKS[i]||
       !validProbeId(entry.requestId)||seen.has(entry.requestId)||
       !Number.isInteger(entry.httpStatus)||!bounded(entry.httpStatus,599)||
       typeof entry.httpVerified!=="boolean"||
       (entry.httpVerified===true&&entry.httpStatus!==200)||
       !Number.isSafeInteger(entry.clientWallMs)||!bounded(entry.clientWallMs,600000)||
       (entry.diagnostic!==undefined&&(
         typeof entry.diagnostic!=="string"||entry.diagnostic.length>96)))
      return refuse();
    seen.add(entry.requestId);
    return {task:entry.task,requestId:entry.requestId,httpStatus:entry.httpStatus,
      httpVerified:entry.httpVerified,clientWallMs:entry.clientWallMs};
  });
}
function readInvocation(raw:unknown):CanaryInvocation{
  if(!object(raw)||!keysOnly(raw,[
    "requestId","scope","mode","outcome","cpuTimeMs","memoryBytes","deploymentId"
  ])||!validProbeId(raw.requestId)||
     (raw.scope!=="ingress-worker"&&raw.scope!=="sqlite-durable-object")||
     (raw.mode!=="cpu"&&raw.mode!=="php"&&raw.mode!=="wordpress")||
     !ALLOWED_OUTCOME.has(raw.outcome as Outcome)||
     !((raw.cpuTimeMs===null)||bounded(raw.cpuTimeMs,300000))||
     !((raw.memoryBytes===null)||bounded(raw.memoryBytes,MAX_MEMORY))||
     typeof raw.deploymentId!=="string"||
     !/^[A-Za-z0-9_.-]{1,80}$/.test(raw.deploymentId))
    return refuse();
  return raw as unknown as CanaryInvocation;
}
function assess(scope:CanaryScope,record:CanaryInvocation|undefined):CanaryScopeAssessment{
  const budget=scope==="ingress-worker"?FREE_INGRESS_CPU_MS:SQLITE_DO_DEFAULT_CPU_MS;
  let cpuStatus:CanaryScopeAssessment["cpuStatus"]="unverified";
  if(record){
    if(record.outcome==="exceededCpu"||
       (record.cpuTimeMs!==null&&record.cpuTimeMs>budget))
      cpuStatus="over-budget";
    else if(record.outcome!=="ok")cpuStatus="failed";
    else if(record.cpuTimeMs!==null)cpuStatus="within-budget";
  }
  return {scope,cpuBudgetMs:budget,cpuTimeMs:record?.cpuTimeMs??null,
    outcome:record?.outcome??null,cpuStatus,
    memoryStatus:record?.memoryBytes===undefined||record.memoryBytes===null?
      "not-measured":record.memoryBytes>ISOLATE_MEMORY_BYTES?"over-limit":"within-limit",
    deploymentId:record?.deploymentId??null};
}

/** Correlation is diagnostic, not cryptographically authenticated telemetry. */
export function correlateFreeDoCanary(
  remoteHttpReport:unknown,operatorNormalizedInvocations:unknown
):CanaryCorrelation{
  const http=readHttp(remoteHttpReport);
  if(!Array.isArray(operatorNormalizedInvocations)||
     operatorNormalizedInvocations.length>EXPECTED_CANARY_TASKS.length*2)
    return refuse();
  const byRequest=new Map<string,Map<CanaryScope,CanaryInvocation>>();
  const expected=new Map(http.map(h=>[h.requestId,h]));
  for(const raw of operatorNormalizedInvocations){
    const item=readInvocation(raw);
    const task=expected.get(item.requestId);
    if(!task||item.mode!==(task.task.startsWith("cpu:")?"cpu":task.task))
      return refuse();
    const scopes=byRequest.get(item.requestId)??new Map();
    if(scopes.has(item.scope))return refuse();
    scopes.set(item.scope,item);
    byRequest.set(item.requestId,scopes);
  }
  const tasks=http.map(h=>{
    const scopes=byRequest.get(h.requestId);
    return {requestId:h.requestId,task:h.task,httpVerified:h.httpVerified,
      ingress:assess("ingress-worker",scopes?.get("ingress-worker")),
      durableObject:assess("sqlite-durable-object",scopes?.get("sqlite-durable-object"))};
  });
  const completePairs=tasks.filter(t=>
    t.ingress.outcome!==null&&t.durableObject.outcome!==null).length;
  const verifiedHttp=http.filter(x=>x.httpVerified).length;
  const allCpuWithinBudget=completePairs===7&&tasks.every(t=>
    t.ingress.cpuStatus==="within-budget"&&
    t.durableObject.cpuStatus==="within-budget");
  const memoryAllMeasured=completePairs===7&&tasks.every(t=>
    t.ingress.memoryStatus!=="not-measured"&&
    t.durableObject.memoryStatus!=="not-measured");
  const memoryWithinLimit=memoryAllMeasured&&tasks.every(t=>
    t.ingress.memoryStatus==="within-limit"&&
    t.durableObject.memoryStatus==="within-limit");
  return Object.freeze({
    status:"DIAGNOSTIC_ONLY_PROVENANCE_NOT_AUTHENTICATED" as const,
    productionReady:false as const,completePairs,verifiedHttp,tasks,
    allCpuWithinBudget,memoryAllMeasured,memoryWithinLimit,
    note:"This joins untrusted, operator-normalized files by canary UUID. It does not authenticate Cloudflare platform log provenance, certify CPU/memory, or enable production. Client wall time is never converted to CPU."
  });
}
