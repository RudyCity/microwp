/**
 * Offline CPU evidence audit. Local Workerd wall time is NOT Cloudflare CPU.
 * Budget values verified against official Cloudflare docs (2026-11-06):
 * https://developers.cloudflare.com/workers/platform/limits/
 * https://developers.cloudflare.com/durable-objects/platform/limits/
 *
 * The outer Workers Free ingress and the SQLite Durable Object are different
 * execution scopes. A failed ingress probe cannot prove DO CPU exhaustion.
 */
export const FREE_INGRESS_CPU_MS=10;
export const SQLITE_DO_DEFAULT_CPU_MS=30_000;
export const ISOLATE_MEMORY_BYTES=128*1024*1024;

export type CpuScope="ingress-worker"|"sqlite-durable-object";
export type CpuPhase="php-runtime"|"wordpress-installer"|"wordpress-editorial";
export interface CpuObservation {
 evidenceSource:"cloudflare-remote";
 scope:CpuScope;
 phase:CpuPhase;
 outcome:string;
 cpuTimeMs:number|null;
 wallTimeMs:number|null;
 memoryBytes:number|null;
}
export type CpuAssessmentStatus="cpu-pass-only"|"exceeded-budget"|"failed-invocation"|"unverified";
export interface CpuAssessment{
 scope:CpuScope;
 phase:CpuPhase;
 status:CpuAssessmentStatus;
 budgetCpuMs:number;
 actualCpuMs:number|null;
 memoryStatus:"within-isolate-budget"|"memory-exceeded"|"not-measured";
 /** Never converts CPU compliance into a production readiness claim. */
 productionReady:false;
}

export function parseCpuObservation(raw:unknown):CpuObservation|null{
 if(raw===null||typeof raw!=="object"||Array.isArray(raw))return null;
 const value=raw as Record<string,unknown>;
 if(Object.keys(value).some(key=>![
  "evidenceSource","scope","phase","outcome","cpuTimeMs","wallTimeMs","memoryBytes"
 ].includes(key)))return null;
 if(value.evidenceSource!=="cloudflare-remote"||
    (value.scope!=="ingress-worker"&&value.scope!=="sqlite-durable-object")||
    (value.phase!=="php-runtime"&&value.phase!=="wordpress-installer"&&value.phase!=="wordpress-editorial")||
    typeof value.outcome!=="string"||!["ok","exceededCpu","exceededMemory","exception","unknown"].includes(value.outcome))
  return null;
 const bounded=(input:unknown,max:number)=>input===null||(typeof input==="number"&&Number.isFinite(input)&&input>=0&&input<=max);
 if(!bounded(value.cpuTimeMs,300_000)||
    !bounded(value.wallTimeMs,3_600_000)||
    !bounded(value.memoryBytes,2*1024*1024*1024))return null;
 return {evidenceSource:"cloudflare-remote",scope:value.scope,phase:value.phase,
  outcome:value.outcome,cpuTimeMs:value.cpuTimeMs as number|null,
  wallTimeMs:value.wallTimeMs as number|null,memoryBytes:value.memoryBytes as number|null};
}
export function assessCpuEvidence(observation:CpuObservation):CpuAssessment{
 const budget=observation.scope==="ingress-worker"?FREE_INGRESS_CPU_MS:SQLITE_DO_DEFAULT_CPU_MS;
 const memoryStatus=observation.memoryBytes===null?"not-measured":
  observation.memoryBytes>ISOLATE_MEMORY_BYTES?"memory-exceeded":"within-isolate-budget";
 let status:CpuAssessmentStatus="unverified";
 if(observation.outcome!=="ok")status=observation.outcome==="exceededCpu"?"exceeded-budget":"failed-invocation";
 else if(observation.cpuTimeMs!==null)status=observation.cpuTimeMs>budget?"exceeded-budget":"cpu-pass-only";
 return {scope:observation.scope,phase:observation.phase,status,budgetCpuMs:budget,
  actualCpuMs:observation.cpuTimeMs,memoryStatus,productionReady:false};
}
