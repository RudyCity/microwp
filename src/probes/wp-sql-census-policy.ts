/**
 * Offline validator for WordPress-local query filter evidence.
 * Never accepts SQL text, values, unrecognized table names or plugin names.
 * Shapes are categorical only; SQL before the MU-plugin is not observable.
 */
export interface SqlFamily {readonly shape:string;readonly count:number}
export interface SqlCensusSummary {
 readonly kind:"local-wordpress-query-hook-census";
 readonly source:"real-wordpress-mu-plugin";
 readonly requestSamples:number;
 readonly queryCount:number;
 readonly minQueriesPerPhpRequest:number;
 readonly medianQueriesPerPhpRequest:number;
 readonly maxQueriesPerPhpRequest:number;
 readonly phpRequestsAbove50SqlQueries:number;
 readonly families:readonly SqlFamily[];
 readonly coverage:"post-mu-plugin-only";
 readonly bootstrapQueriesObserved:false;
 readonly nativeWpdbD1Verified:false;
 readonly productionReady:false;
}
const CORE=new Set(["options","posts","postmeta","users","usermeta","terms","termmeta","term_taxonomy","term_relationships","comments","commentmeta","links"]);
const VERBS=new Set(["SELECT","INSERT","UPDATE","DELETE","REPLACE","CREATE","ALTER","DROP","SHOW","DESCRIBE","PRAGMA","BEGIN","COMMIT","ROLLBACK","EXPLAIN","SET","START","UNKNOWN","OVERSIZE"]);
const TABLE_TYPES=new Set(["none","other-wp-table","other-table","sqlite-metadata"]);
const FEATURES=new Set(["WHERE","JOIN","GROUP","ORDER","LIMIT","DISTINCT","UNION","ON_CONFLICT","ON_DUPLICATE","SUBQUERY","IN","LIKE","CAST","COUNT","FOR_UPDATE","simple"]);
function refuse():never{throw new Error("Local WordPress SQL census rejected");}
function obj(x:unknown):x is Record<string,unknown>{
 return x!==null&&typeof x==="object"&&!Array.isArray(x);
}
function validFamily(x:string):boolean{
 if(x==="OVERSIZE"||x==="UNKNOWN")return true;
 if(x.length>256||x.includes("\u0000"))return false;
 const parts=x.split("|");
 if(parts.length!==3||!VERBS.has(parts[0]!))return false;
 const tables=parts[1]!.split("+");
 if(tables.length>8||new Set(tables).size!==tables.length)return false;
 if(tables.some(t=>!TABLE_TYPES.has(t)&&!(t.startsWith("core:")&&CORE.has(t.slice(5)))))return false;
 const features=parts[2]!.split("+");
 return features.length<=15&&new Set(features).size===features.length&&features.every(f=>FEATURES.has(f));
}
/**
 * Input is a private PHP file owned by the local Workerd isolate; no user
 * HTTP body or arbitrary file path enters this function from the server.
 */
export function summarizeLocalSqlCensus(raw:string):SqlCensusSummary{
 if(typeof raw!=="string"||raw.length>96*1024||raw.length===0)return refuse();
 const lines=raw.trimEnd().split("\n");
 if(lines.length<1||lines.length>256)return refuse();
 const byFamily=new Map<string,number>();
 let queryCount=0,requestSamples=0;
 const perRequestCounts:number[]=[];
 for(const line of lines){
  if(line.length<1||line.length>8192)return refuse();
  let row:unknown;try{row=JSON.parse(line)}catch{return refuse()}
  if(!obj(row)||Object.keys(row).sort().join(",")!=="overflow,shapes,total,version"||
    row.version!==1||row.overflow!==false||
    !Number.isSafeInteger(row.total)||!Number.isFinite(row.total)||
    (row.total as number)<0||(row.total as number)>2048||!obj(row.shapes))return refuse();
  const entries=Object.entries(row.shapes);
  if(entries.length>128)return refuse();
  let counted=0;
  for(const [shape,count] of entries){
   if(!validFamily(shape)||!Number.isSafeInteger(count)||!(typeof count==="number"&&count>=1&&count<=2048))
    return refuse();
   counted+=count;
   if(counted>2048)return refuse();
   byFamily.set(shape,(byFamily.get(shape)??0)+count);
  }
  if(counted!==row.total)return refuse();
  queryCount+=counted;requestSamples++;
  perRequestCounts.push(counted);
  if(queryCount>100000||byFamily.size>256)return refuse();
 }
 if(queryCount<1||byFamily.size<1)return refuse();
 const sorted=[...perRequestCounts].sort((a,b)=>a-b);
 const mid=Math.floor(sorted.length/2);
 const median=sorted.length%2===0?
  (sorted[mid-1]!+sorted[mid]!)/2:sorted[mid]!;
 const families=[...byFamily.entries()].sort((a,b)=>a[0].localeCompare(b[0]))
   .map(([shape,count])=>Object.freeze({shape,count}));
 return Object.freeze({
   kind:"local-wordpress-query-hook-census",
   source:"real-wordpress-mu-plugin",
   requestSamples,queryCount,
   minQueriesPerPhpRequest:sorted[0]!,
   medianQueriesPerPhpRequest:median,
   maxQueriesPerPhpRequest:sorted[sorted.length-1]!,
   phpRequestsAbove50SqlQueries:perRequestCounts.filter(n=>n>50).length,
   families:Object.freeze(families),
   coverage:"post-mu-plugin-only",
   bootstrapQueriesObserved:false,nativeWpdbD1Verified:false,productionReady:false
 });
}
