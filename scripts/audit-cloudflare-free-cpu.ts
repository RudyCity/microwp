/**
 * Offline-only review of OPERATOR-SUPPLIED Cloudflare invocation CPU samples.
 * This script NEVER fetches remote logs or reports that local wallMs is CPU.
 * Example input path: .wrangler/free-cpu-evidence.jsonl (ignored by Git).
 */
import {readFile} from "node:fs/promises";
import {parseCpuObservation,assessCpuEvidence} from "../src/probes/free-cpu-budget-evidence";

const input=process.argv[2]??".wrangler/free-cpu-evidence.jsonl";
if(!/^\.wrangler\/[A-Za-z0-9_.-]+\.jsonl$/.test(input)||
   input.includes(".."))throw Error("Only ignored .wrangler/*.jsonl evidence files are accepted");
const text=await readFile(input,"utf8");
if(text.length>1024*1024)throw Error("Cloudflare CPU evidence file exceeds 1 MiB limit");
const lines=text.split(/\r?\n/).filter(Boolean);
if(lines.length<1||lines.length>500)throw Error("Expected 1–500 Cloudflare invocation samples");
const observations=lines.map(line=>{
 const parsed=parseCpuObservation(JSON.parse(line));
 if(!parsed)throw Error("Invalid or incomplete remote Cloudflare CPU observation");
 return parsed;
});
const assessments=observations.map(assessCpuEvidence);
const scopes={
 ingress:assessments.filter(x=>x.scope==="ingress-worker"),
 durableObject:assessments.filter(x=>x.scope==="sqlite-durable-object"),
};
console.log(JSON.stringify({
 sampleCount:assessments.length,
 ingress:scopes.ingress.map(x=>({phase:x.phase,status:x.status,budgetCpuMs:x.budgetCpuMs,actualCpuMs:x.actualCpuMs})),
 durableObject:scopes.durableObject.map(x=>({phase:x.phase,status:x.status,budgetCpuMs:x.budgetCpuMs,actualCpuMs:x.actualCpuMs,memoryStatus:x.memoryStatus})),
 missingDurableObjectWordPressSamples:!scopes.durableObject.some(x=>x.phase==="wordpress-installer"),
 status:"DIAGNOSTICS_ONLY_NOT_PRODUCTION_READY",
 note:"Operator-provided remote observations only. This does not validate source authenticity, WordPress wpdb D1 parity or production rollout."
},null,2));
