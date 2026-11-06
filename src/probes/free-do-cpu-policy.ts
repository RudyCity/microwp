/**
 * Private, fixed-purpose Free CPU and PHP/WordPress canary policy.
 * HTTP callers cannot supply PHP, SQL, file paths, or arbitrary instructions.
 * Platform CPU time and memory MUST come from independent Cloudflare telemetry.
 */
export const CPU_SAMPLES=[0,50000,250000,1000000,3000000] as const;
export type CanaryMode="cpu"|"php"|"wordpress";
export interface CanaryTask {mode:CanaryMode;loops:number}
export const CANARY_PATH="/__microwp/private/free-do-cpu";
export const INTERNAL_PATH="/__microwp/internal/free-do-cpu";
export const CANARY_BODY_MAX=192;
export const CANARY_PROTOCOL=1;
export const PROBE_ID_HEADER="X-MicroWP-Probe-Id";

export function validTokenFormat(key:unknown):key is string {
  return typeof key==="string"&&/^[A-Za-z0-9_-]{64,128}$/.test(key);
}
export function validProbeId(value:unknown):value is string {
  return typeof value==="string"&&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}
export function validateTask(raw:unknown):CanaryTask|null{
  if(raw===null||typeof raw!=="object"||Array.isArray(raw))return null;
  const v=raw as Record<string,unknown>;
  if(Object.keys(v).some(k=>k!=="mode"&&k!=="loops"))return null;
  if(v.mode!=="cpu"&&v.mode!=="php"&&v.mode!=="wordpress")return null;
  if(v.mode==="cpu"){
    if(!CPU_SAMPLES.some(n=>n===v.loops))return null;
    return {mode:v.mode,loops:v.loops as number};
  }
  if(v.loops!==undefined&&v.loops!==0)return null;
  return {mode:v.mode,loops:0};
}
export async function authorizeToken(supplied:string|null,expected:string|undefined):Promise<boolean>{
  if(!validTokenFormat(expected)||!validTokenFormat(supplied))return false;
  const [a,b]=await Promise.all([
    crypto.subtle.digest("SHA-256",new TextEncoder().encode(supplied)),
    crypto.subtle.digest("SHA-256",new TextEncoder().encode(expected))
  ]);
  let mismatch=0;
  const ab=new Uint8Array(a),bb=new Uint8Array(b);
  for(let i=0;i<ab.length;i++)mismatch|=ab[i]!^bb[i]!;
  return mismatch===0;
}
export function boundedWork(iterations:number):number{
  if(!CPU_SAMPLES.some(n=>n===iterations))throw new Error("Invalid CPU sample");
  let hash=0x13572468;
  for(let i=0;i<iterations;i++)hash=(Math.imul(hash^i,1664525)+1013904223)|0;
  return hash>>>0;
}

/** Prevent remote operators from sending the private token to another origin. */
export function parseRemoteProbeOrigin(input:string|undefined):string{
  if(typeof input!=="string"||input.length>220)throw new Error("Missing isolated canary HTTPS origin");
  let url:URL;
  try{url=new URL(input)}catch{throw new Error("Invalid isolated canary HTTPS origin")}
  if(url.protocol!=="https:"||url.username||url.password||url.port||
    !/^microwp-free-do-cpu-probe\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.workers\.dev$/.test(url.hostname)||
    url.pathname!=="/"||url.search||url.hash)
    throw new Error("Expected the isolated Cloudflare workers.dev canary HTTPS origin");
  return url.origin;
}

/**
 * This verifies only an authenticated canary HTTP response, NEVER Cloudflare CPU.
 * The ID must match in both response header and JSON to bind a single invocation.
 */
export function verifyRemoteCanaryResponse(
  task:CanaryTask,requestId:string,status:number,headerId:string|null,raw:unknown
):boolean{
  if(status!==200||!validProbeId(requestId)||headerId!==requestId||
     raw===null||typeof raw!=="object"||Array.isArray(raw))return false;
  const value=raw as Record<string,unknown>;
  if(value.protocol!==CANARY_PROTOCOL||value.requestId!==requestId||
     value.ok!==true||value.scope!=="durable-object"||value.mode!==task.mode)return false;
  if(task.mode==="cpu")
    return value.loops===task.loops&&value.checksum===boundedWork(task.loops);
  if(value.phpVersion!=="8.4.27"||value.sqlite!==true)return false;
  const stats=value.stats;
  if(!stats||typeof stats!=="object"||Array.isArray(stats))return false;
  const s=stats as Record<string,unknown>;
  if(s.runtime!=="php-8.4.27-wasm"||s.mounted!==true||
     typeof s.files!=="number"||!Number.isSafeInteger(s.files)||s.files<1)return false;
  return task.mode==="wordpress"?
    value.installerStatus===200&&value.installerForm===true:
    value.installerStatus===null&&value.installerForm===false;
}
