/**
 * Local Workerd D1 transactional batch verification, not an HTTP API.
 * Only accepts the fixed loopback origin started by the accompanying shell.
 */
const origin="http://127.0.0.1:19351";
async function call(path:string){
 const response=await fetch(origin+path,{
  method:"POST",headers:{"Content-Length":"0"},signal:AbortSignal.timeout(10000)
 });
 let data:Record<string,unknown>|null=null;
 if(response.headers.get("content-type")?.includes("application/json")){
  data=await response.json() as Record<string,unknown>;
 }
 return {status:response.status,data};
}
const publicRoute=await fetch(origin+"/__local/read",{
 signal:AbortSignal.timeout(10000)
});
if(publicRoute.status!==404)throw Error("Local D1 proof must reject public GET requests");
console.log("PASS no public GET route");
const initial=await call("/__local/read");
if(initial.status!==200||initial.data?.ok!==true||
   initial.data?.count!==65||initial.data?.first!=="option_0000"||
   initial.data?.last!=="option_0064"||
   initial.data?.firstValue!=="value_0"||
   initial.data?.siteBCanaryPresent!==false){
 throw Error("Real D1 transaction and site isolation proof failed");
}
console.log("PASS Cloudflare D1 batch gives 65 complete options from site A only");
const update=await call("/__local/update");
if(update.status!==204)throw Error("Fixed local site write failed");
const modified=await call("/__local/read");
if(modified.status!==200||modified.data?.firstValue!=="updated"||
   modified.data.count!==65)throw Error("New transaction did not observe committed update");
console.log("PASS later transaction reads committed WordPress option update");
const overflow=await call("/__local/overflow");
if(overflow.status!==204)throw Error("Fixed local overflow fixture failed");
const rejected=await call("/__local/read");
if(rejected.status!==503||rejected.data?.error!=="ATOMIC_AUTOLOAD_READ_REJECTED")
 throw Error("Real D1 501 options were not rejected fail-closed");
console.log("PASS real D1 returns no partial results on 501-option overflow");
console.log("PASS Cloudflare Workerd local transactional D1 autoload E2E");
