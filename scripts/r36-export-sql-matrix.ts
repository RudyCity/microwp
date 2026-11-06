/**
 * R36 offline exporter of sanitized, categorical WordPress SQL query shapes.
 * Fixed local ignored inputs, no SQL text, auth data or Cloudflare remote calls.
 */
import {readFile,writeFile} from "node:fs/promises";
interface Family{shape:string;count:number}
interface Census{
 kind:string;source:string;coverage:string;bootstrapQueriesObserved:false;
 nativeWpdbD1Verified:false;productionReady:false;
 requestSamples:number;queryCount:number;families:Family[];
 minQueriesPerPhpRequest:number;medianQueriesPerPhpRequest:number;
 maxQueriesPerPhpRequest:number;phpRequestsAbove50SqlQueries:number;
}
function reject():never{throw Error("R36 sanitized SQL matrix input rejected");}
function validNumber(x:unknown):x is number{
 return typeof x==="number"&&Number.isFinite(x)&&x>=0&&x<=100000;
}
function validate(x:unknown):Census{
 if(!x||typeof x!=="object"||Array.isArray(x))return reject();
 const v=x as Record<string,unknown>;
 if(v.kind!=="local-wordpress-query-hook-census"||
    v.source!=="real-wordpress-mu-plugin"||
    v.coverage!=="post-mu-plugin-only"||
    v.bootstrapQueriesObserved!==false||
    v.nativeWpdbD1Verified!==false||
    v.productionReady!==false||
    !Array.isArray(v.families)||v.families.length<1||v.families.length>256)
   return reject();
 for(const key of ["queryCount","requestSamples","minQueriesPerPhpRequest",
   "medianQueriesPerPhpRequest","maxQueriesPerPhpRequest",
   "phpRequestsAbove50SqlQueries"])
  if(!validNumber(v[key]))return reject();
 let count=0;const seen=new Set<string>();
 for(const raw of v.families){
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return reject();
  const f=raw as Record<string,unknown>;
  if(typeof f.shape!=="string"||f.shape.length>256||
     !/^[A-Za-z0-9_:|+\-]+$/.test(f.shape)||
     f.shape.split("|").length!==3||seen.has(f.shape)||
     !Number.isSafeInteger(f.count)||!validNumber(f.count)||f.count<1)
   return reject();
  seen.add(f.shape);count+=f.count;
 }
 if(count!==v.queryCount)return reject();
 return v as unknown as Census;
}
const before=validate(JSON.parse(await readFile(".wrangler/r36-sql-census-before-restart.json","utf8")));
const after=validate(JSON.parse(await readFile(".wrangler/r36-sql-census-after-restart.json","utf8")));
const matrix=new Map<string,{before:number;after:number}>();
for(const [phase,census] of [["before",before],["after",after]] as const){
 for(const family of census.families){
  const row=matrix.get(family.shape)??{before:0,after:0};
  row[phase]+=family.count;matrix.set(family.shape,row);
 }
}
const total=before.queryCount+after.queryCount;
const over=before.phpRequestsAbove50SqlQueries+after.phpRequestsAbove50SqlQueries;
const destination="docs/reports/2026-11-06-microwp-r36-sql-family-matrix.md";
const lines=[
 "# microWP R36: observed WordPress SQL family matrix",
 "",
 "Date: 2026-11-06",
 "Status: LOCAL-ONLY QUERY-HOOK CENSUS; NATIVE D1 WPDB AND REMOTE FREE CPU UNVERIFIED",
 "",
 "Source: actual WordPress 7.1.4 PHP-WASM and SQLite Integration 3.1.3, on Workerd localhost.",
 "SQL text, literals, WordPress user content, cookies, options and stack traces are not exported.",
 "The WordPress query hook activates after MU plugin registration, so early bootstrap queries",
 "are NOT included. This is a sample of defined editorial and media workflows, not a",
 "complete catalog of every plugin, multisite, schema or SQL dialect query.",
 "The lexical family classifier is heuristic and can tag SQL tokens inside quoted literals.",
 "",
 "## PHP request workload and the Free D1 query risk",
 "",
 "| Local phase | PHP requests | WordPress SQL | Families | Min/request | Median/request | Max/request | Requests above 50 |",
 "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
 ...([["Before restart",before],["After restart",after]] as const).map(([label,c])=>
  "| "+label+" | "+c.requestSamples+" | "+c.queryCount+" | "+c.families.length+" | "+
   c.minQueriesPerPhpRequest+" | "+c.medianQueriesPerPhpRequest+" | "+
   c.maxQueriesPerPhpRequest+" | "+c.phpRequestsAbove50SqlQueries+" |"),
 "",
 "Observed total: "+total+" logical WordPress SQL statements across "+
 (before.requestSamples+after.requestSamples)+" sampled PHP requests; "+
 matrix.size+" distinct categorical families. "+over+" requests had over 50 SQL statements.",
 "These statements ran in local SQLite inside PHP, NOT D1. Mapping every SQL call directly",
 "to one D1 query would risk exceeding Workers Free 50 D1 queries/invocation for these",
 "requests. Batching, verified caching and/or native SQLite execution strategies need",
 "independent correctness and quota verification.",
 "",
 "## Required D1 wpdb compatibility work",
 "",
 "- SELECT, INSERT, UPDATE, DELETE across options/posts/postmeta, users/usermeta,",
 "  taxonomy, comments, media and plugin schemas.",
 "- SHOW, DESCRIBE, MySQL ON DUPLICATE KEY UPDATE and other dialect translation.",
 "- JOIN/IN/COUNT/DISTINCT/ORDER/LIMIT, collation, correct unique indexes and transactions.",
 "- Authentication, WordPress hooks, plugin SQL, rollback and lossless native D1 migration.",
 "- Existing experimental options-store coverage is not an installed driver. Every",
 "  family below is NOT VERIFIED against query-native WordPress wpdb.",
 "",
 "## All sampled categorical SQL families",
 "",
 "| Structural SQL family (verb / tables / features) | Before | After | Total | Native D1 wpdb |",
 "| --- | ---: | ---: | ---: | --- |",
 ...[...matrix.entries()].sort((a,b)=>
   (b[1].before+b[1].after)-(a[1].before+a[1].after)||a[0].localeCompare(b[0]))
  .map(([shape,n])=>"| "+shape.replaceAll("|"," / ")+" | "+n.before+" | "+
    n.after+" | "+(n.before+n.after)+" | NOT VERIFIED |"),
 "",
 "## Platform limits and release gate",
 "",
 "https://developers.cloudflare.com/workers/platform/limits/",
 "https://developers.cloudflare.com/durable-objects/platform/limits/",
 "https://developers.cloudflare.com/d1/platform/limits/",
 "",
 "Cloudflare Free Worker ingress CPU: nominal 10ms; SQLite DO default CPU is documented",
 "as 30s/request but has NOT been independently confirmed for this workload on the",
 "actual Free account. Isolate memory is 128MB and D1 Free allows 50 queries per invocation.",
 "Local client wall time is NOT CPU or peak isolate memory. No remote probing or changes",
 "to Cloudflare account/billing/deployment were conducted by this evidence generator.",
 "Production remains NO-GO.",
 ""
];
await writeFile(destination,lines.join("\n"));
console.log(JSON.stringify({
 destination,queryCount:total,requestSamples:before.requestSamples+after.requestSamples,
 familyCount:matrix.size,phpRequestsAbove50:over,
 maxQueriesPerPhpRequest:Math.max(before.maxQueriesPerPhpRequest,after.maxQueriesPerPhpRequest),
 productionReady:false
}));
