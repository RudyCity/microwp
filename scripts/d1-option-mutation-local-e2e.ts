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
  const deleted=await request("/__local/delete");
  if(deleted.status!==200||deleted.raw.changed!==1||deleted.raw.queryCount!==2)
    throw Error("Scoped two-query DELETE failed");
  const again=await request("/__local/delete");
  if(again.status!==200||again.raw.changed!==0)throw Error("Absent delete should be no-op");
  if(JSON.stringify(await rows())!==JSON.stringify([b]))
    throw Error("DELETE leaked to another site or did not delete site A");
  console.log("PASS atomic DELETE + idempotent no-op preserve site B");
}
console.log("PASS real Workerd local D1 native option mutation phase "+stage);
