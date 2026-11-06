/**
 * Operator-run OFFLINE normalization join: no Cloudflare APIs, secrets, or
 * deployment actions. The provided JSONL is UNTRUSTED and not authenticated
 * Cloudflare telemetry. Raw platform logs must be normalized independently.
 */
import {readFile} from "node:fs/promises";
import {correlateFreeDoCanary} from "../src/probes/free-do-canary-correlation";

const MAX_HTTP_BYTES=64*1024;
const MAX_LOG_BYTES=128*1024;
async function bounded(path:string,max:number):Promise<string>{
  const content=await readFile(path,"utf8");
  if(content.length<1||content.length>max)
    throw new Error("Canary diagnostic evidence exceeded bounds");
  return content;
}
// Fixed ignored paths, never accept filesystem paths/URLs from CLI flags.
const remote=JSON.parse(await bounded(".wrangler/free-do-cpu-remote-results.json",MAX_HTTP_BYTES));
const data=await bounded(".wrangler/free-do-cpu-platform-invocations.jsonl",MAX_LOG_BYTES);
const lines=data.split(/\r?\n/).filter(Boolean);
if(lines.length<1||lines.length>14)throw Error("Canary platform normalization must contain 1–14 invocations");
const normalized=lines.map(line=>JSON.parse(line));
const report=correlateFreeDoCanary(remote,normalized);
console.log(JSON.stringify(report,null,2));
if(report.completePairs!==7||report.verifiedHttp!==7||
   !report.allCpuWithinBudget||!report.memoryWithinLimit)process.exitCode=2;
