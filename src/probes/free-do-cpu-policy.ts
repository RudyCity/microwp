/** Private fixed-purpose Free CPU and PHP bootstrap canary policy.
 * Never reads PHP code, SQL, WordPress paths, or arbitrary instructions from HTTP.
 */
export const CPU_SAMPLES=[0,50000,250000,1000000,3000000] as const;
export type CanaryMode="cpu"|"php"|"wordpress";
export interface CanaryTask {mode:CanaryMode;loops:number}
export const CANARY_PATH="/__microwp/private/free-do-cpu";
export const INTERNAL_PATH="/__microwp/internal/free-do-cpu";
export const CANARY_BODY_MAX=192;
export function validTokenFormat(key:unknown):key is string {
 return typeof key==="string"&&/^[A-Za-z0-9_-]{64,128}$/.test(key);
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
