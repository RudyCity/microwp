/**
 * Fixed local-only Workerd D1 option write/restart proof; no remote resources.
 * Stage names are developer-only flags, never HTTP request input.
 */
const stage=process.argv[2];
if(stage!=="before-restart"&&stage!=="after-restart")throw Error("Invalid local stage");
const origin="http://127.0.0.1:19353";
async function request(path:string){
  const response=await fetch(origin+path,{method:"POST",
    headers:{"Content-Length":"0"},signal:AbortSignal.timeout(10000)});
  const raw=await response.json() as Record<string,unknown>;
  return {status:response.status,raw};
}
type OptionRow={site_id:string;option_value:string;autoload:string};
async function rows():Promise<OptionRow[]>{
  const response=await request("/__local/read");
  if(response.status!==200||response.raw.ok!==true||
     !Array.isArray(response.raw.rows))throw Error("D1 option read failed");
  return response.raw.rows as OptionRow[];
}
const b:OptionRow={site_id:"site_b",option_value:"site_b_private",autoload:"on"};
if(stage==="before-restart"){
  const get=await fetch(origin+"/__local/read",{signal:AbortSignal.timeout(10000)});
  if(get.status!==404)throw Error("Public GET must be denied");
  console.log("PASS no public GET");
  if(JSON.stringify(await rows())!==JSON.stringify([b]))throw Error("Local fixture mismatch");
  const wrong=await request("/__local/deny-crossed-capability");
  if(wrong.status!==200||wrong.raw.capabilityRejected!==true)throw Error("Crossed capability allowed");
  if(JSON.stringify(await rows())!==JSON.stringify([b]))throw Error("Crossed capability mutated D1");
  console.log("PASS wrong operation capability rejected without modifying D1");
  const invalidStore=await request("/__local/store-wrong-capability");
  if(invalidStore.status!==200||invalidStore.raw.rejected!==true||invalidStore.raw.used!==0)
    throw Error("Private read capability incorrectly permitted D1 preparation");
  const first=await request("/__local/store-read");
  if(first.status!==200||first.raw.option===null||
     (first.raw.option as Record<string,unknown>).found!==false||
     !Array.isArray(first.raw.autoloadKeys)||
     first.raw.autoloadKeys.length!==0||first.raw.queries!==2)
    throw Error("Private options store leaked another site's option");
  const budget=await request("/__local/store-budget");
  if(budget.status!==200||budget.raw.used!==50||budget.raw.remaining!==0||
     budget.raw.rejectedTwoQuery!==true||budget.raw.rejectedExtra!==true)
    throw Error("Free D1 50-query store guard was not exercised");
  console.log("PASS fixed-site store blocks unauthorized reads and query #51");
  const storeWrite=await request("/__local/store-put");
  if(storeWrite.status!==200||storeWrite.raw.queries!==3||
     storeWrite.raw.autoloadValue!=="site_a_store"||
     (storeWrite.raw.option as Record<string,unknown>)?.value!=="site_a_store")
    throw Error("Private store put/get/all option consistency failed");
  console.log("PASS composable native D1 store PUT/GET/autoload is consistent");
  const inserted=await request("/__local/put");
  if(inserted.status!==200||inserted.raw.changed!==1||inserted.raw.queryCount!==1)
    throw Error("Scoped one-query UPSERT failed");
  const updated=await request("/__local/update");
  if(updated.status!==200||updated.raw.changed!==1||updated.raw.queryCount!==1)
    throw Error("Scoped D1 upsert update failed");
  const expected=[
    {site_id:"site_a",option_value:"site_a_updated",autoload:"auto-on"},b
  ];
  if(JSON.stringify(await rows())!==JSON.stringify(expected))
    throw Error("Site isolation or local UPSERT persistence failed");
  console.log("PASS one-query INSERT and UPDATE isolated by trusted site identity");
}else{
  const expected=[
    {site_id:"site_a",option_value:"site_a_updated",autoload:"auto-on"},b
  ];
  if(JSON.stringify(await rows())!==JSON.stringify(expected))
    throw Error("Committed option not durable across Workerd restart");
  console.log("PASS native D1 option survives local Workerd restart");
  const afterRestart=await request("/__local/store-read");
  if(afterRestart.status!==200||
     (afterRestart.raw.option as Record<string,unknown>)?.value!=="site_a_updated"||
     afterRestart.raw.autoloadValue!=="site_a_updated"||
     JSON.stringify(afterRestart.raw.autoloadKeys)!==JSON.stringify(["shared"]))
    throw Error("Composable D1 store did not read committed revision after restart");
  console.log("PASS native options store reads committed state after Workerd restart");
  const deleted=await request("/__local/store-delete");
  if(deleted.status!==200||
     (deleted.raw.changed as Record<string,unknown>)?.changed!==1||
     (deleted.raw.after as Record<string,unknown>)?.found!==false||
     deleted.raw.queries!==3)
    throw Error("Scoped store DELETE/get consistency failed");
  const again=await request("/__local/delete");
  if(again.status!==200||again.raw.changed!==0)throw Error("Absent delete should be no-op");
  if(JSON.stringify(await rows())!==JSON.stringify([b]))
    throw Error("DELETE leaked to another site or did not delete site A");
  console.log("PASS atomic DELETE + idempotent no-op preserve site B");
}
console.log("PASS real Workerd local D1 native option mutation phase "+stage);
