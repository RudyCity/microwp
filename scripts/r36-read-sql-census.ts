/**
 * Fixed localhost-only retrieval of categorical SQL census data.
 * Writes ignored sanitized JSON under .wrangler, not raw SQL or WordPress data.
 */
import {mkdir,writeFile} from "node:fs/promises";
const phase=process.argv[2];
if(phase!=="before-restart"&&phase!=="after-restart")
 throw Error("Expected one of the two fixed local census phases");
const result=await fetch("http://127.0.0.1:19356/__local/r36-sql-census",{
 method:"POST",headers:{"Content-Length":"0"},signal:AbortSignal.timeout(15000)
});
if(!result.ok)throw Error("Local WordPress SQL census HTTP "+result.status);
const data=await result.json() as Record<string,unknown>;
if(data.kind!=="local-wordpress-query-hook-census"||
   data.source!=="real-wordpress-mu-plugin"||
   data.bootstrapQueriesObserved!==false||
   data.nativeWpdbD1Verified!==false||
   data.productionReady!==false||
   !Number.isSafeInteger(data.queryCount)||!(typeof data.queryCount==="number"&&data.queryCount>0)||
   !Array.isArray(data.families)||data.families.length<1)
 throw Error("Unverified or empty local WordPress census");
const families=data.families as Array<{shape:string;count:number}>;
const verbs=[...new Set(families.map(f=>f.shape.split("|")[0]))].sort();
await mkdir(".wrangler",{recursive:true});
await writeFile(".wrangler/r36-sql-census-"+phase+".json",
 JSON.stringify(data,null,2)+"\n");
console.log("PASS local WordPress SQL query-hook samples phase="+phase+
 " requests="+data.requestSamples+" queryCount="+data.queryCount+
 " families="+families.length+" verbs="+verbs.join(","));
