/**
 * R36: bounded LOCAL Workerd wall-time distribution, never platform CPU or
 * isolate RSS. All three runs create/stop only their own local Wrangler child.
 */
import {finiteLimit,type WorkerdSample} from "../../scripts/profile-wordpress-php-bootstrap";
export interface SummaryTime {medianWallMs:number;minWallMs:number;maxWallMs:number}
export interface R36LocalBootstrapSummary{
 readonly kind:"r36-workerd-wall-only";
 readonly sampleCount:3;
 readonly coldInstaller:SummaryTime;
 readonly warmInstaller:SummaryTime;
 readonly wasmReadyWallMs:SummaryTime|null;
 readonly zipReadyWallMs:SummaryTime|null;
 readonly configReadyWallMs:SummaryTime|null;
 readonly ingressCpuMs:null;
 readonly sqliteDurableObjectCpuMs:null;
 readonly peakIsolateMemoryBytes:null;
 readonly cpuEvidence:"NOT_MEASURED";
 readonly memoryEvidence:"NOT_MEASURED";
 readonly productionReady:false;
 readonly interpretation:"Local HTTP client wall time and local app log markers; NOT Cloudflare Worker/DO CPU or isolate memory.";
}
function reject():never{throw Error("R36 local bootstrap sample rejected");}
function time(values:number[]):SummaryTime{
 if(values.length!==3||values.some(v=>!finiteLimit(v,300000)))return reject();
 const sorted=[...values].sort((a,b)=>a-b);
 return Object.freeze({minWallMs:sorted[0]!,medianWallMs:sorted[1]!,maxWallMs:sorted[2]!});
}
function optionalTime(samples:readonly WorkerdSample[],key:"wasmReadyMsFromLog"|"zipReadyMsFromLog"|"configReadyMsFromLog"){
 const values=samples.map(s=>s[key]);
 return values.some(x=>x===null)?null:time(values as number[]);
}
export function summarizeR36LocalBootstrap(samples:readonly WorkerdSample[]):R36LocalBootstrapSummary{
 if(!Array.isArray(samples)||samples.length!==3)return reject();
 for(const sample of samples){
  if(!sample||sample.kind!=="local-workerd-wordpress-php-bootstrap"||
     sample.statusCodes.length!==2||sample.statusCodes.some((s:number)=>s!==200)||
     sample.installerForm.length!==2||sample.installerForm.some((x:boolean)=>x!==true))
   return reject();
  for(const p of [sample.initAndFirstInstaller,sample.repeatedInstaller]){
   if(!p||!finiteLimit(p.wallMs,300000)||
      p.cpuMs!==null||p.rssBeforeBytes!==null||p.rssAfterBytes!==null)
    return reject();
  }
 }
 return Object.freeze({
  kind:"r36-workerd-wall-only",sampleCount:3,
  coldInstaller:time(samples.map(s=>s.initAndFirstInstaller.wallMs)),
  warmInstaller:time(samples.map(s=>s.repeatedInstaller.wallMs)),
  wasmReadyWallMs:optionalTime(samples,"wasmReadyMsFromLog"),
  zipReadyWallMs:optionalTime(samples,"zipReadyMsFromLog"),
  configReadyWallMs:optionalTime(samples,"configReadyMsFromLog"),
  ingressCpuMs:null,sqliteDurableObjectCpuMs:null,peakIsolateMemoryBytes:null,
  cpuEvidence:"NOT_MEASURED",memoryEvidence:"NOT_MEASURED",
  productionReady:false,
  interpretation:"Local HTTP client wall time and local app log markers; NOT Cloudflare Worker/DO CPU or isolate memory."
 });
}
