/** Strictly localhost-only Workerd D1 query proof, not a remote API. */
const origin="http://127.0.0.1:19352";
async function call(path:string){
  const response=await fetch(origin+path,{
    method:"POST",headers:{"Content-Length":"0"},signal:AbortSignal.timeout(10000)
  });
  const data=response.headers.get("content-type")?.includes("application/json")?
    await response.json() as Record<string,unknown>:null;
  return {status:response.status,data};
}
const get=await fetch(origin+"/__local/read",{signal:AbortSignal.timeout(10000)});
if(get.status!==404)throw Error("Proof must refuse anonymous HTTP GET");
console.log("PASS no public GET route");
const initial=await call("/__local/read");
if(initial.status!==200||initial.data?.ok!==true||
   initial.data.count!==65||initial.data.first!=="option_0000"||
   initial.data.last!=="option_0064"||
   initial.data.firstValue!=="value_0"||
   initial.data.otherSitePresent!==false)
  throw Error("Real local D1 single-query fixture did not return isolated options");
console.log("PASS local Workerd D1 returns all 65 scoped options with one SELECT");
const updated=await call("/__local/update");
if(updated.status!==204)throw Error("Local update did not commit");
const afterUpdate=await call("/__local/read");
if(afterUpdate.status!==200||afterUpdate.data?.count!==65||
   afterUpdate.data?.firstValue!=="updated")
  throw Error("Read failed to observe committed local D1 update");
console.log("PASS subsequent D1 SELECT observes committed update");
const fill=await call("/__local/fill-500");
if(fill.status!==204)throw Error("Local 500-option setup failed");
const complete=await call("/__local/read");
if(complete.status!==200||complete.data?.count!==500||
   complete.data?.last!=="option_0499"||
   complete.data?.otherSitePresent!==false)
  throw Error("Real D1 500-option boundary was not accepted and site-scoped");
console.log("PASS 500-option D1 result remains complete and site-scoped");
const overflow=await call("/__local/overflow-one");
if(overflow.status!==204)throw Error("Local 501-option setup failed");
const rejected=await call("/__local/read");
if(rejected.status!==503||
   rejected.data?.error!=="SINGLE_AUTOLOAD_READ_REJECTED")
  throw Error("501-option overflow did not fail closed");
console.log("PASS 501-option result refused without leaking partial data");
console.log("PASS isolated Workerd single-query D1 proof");
