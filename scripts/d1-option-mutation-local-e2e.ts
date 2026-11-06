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
  const exists=await request("/__local/schema-exists");
  if(exists.status!==200||exists.raw.ok!==true||exists.raw.kind!=="show-tables-like"||
     exists.raw.exists!==true||exists.raw.queryCount!==1||
     exists.raw.mysqlShowTablesCompatible!==false)
    throw Error("Local D1 table-existence metadata proof failed");
  const describe=await request("/__local/schema-describe");
  if(describe.status!==200||describe.raw.ok!==true||describe.raw.kind!=="describe"||
     describe.raw.queryCount!==1||describe.raw.mysqlDescribeCompatible!==false||
     !Array.isArray(describe.raw.columns)||
     JSON.stringify((describe.raw.columns as Array<{name:string}>).map(c=>c.name))!==
       JSON.stringify(["site_id","option_name","option_value","autoload"]))
    throw Error("Local D1 schema metadata introspection failed");
  console.log("PASS native D1 prepared SHOW TABLES and DESCRIBE family inspection");
  const initialTemplate=await request("/__local/template-option-insert");
  if(initialTemplate.status!==200||initialTemplate.raw.ok!==true||
     (initialTemplate.raw.mutation as Record<string,unknown>)?.queryCount!==1||
     (initialTemplate.raw.after as Record<string,unknown>)?.value!=="created")
    throw Error("Local one-query pinned option upsert INSERT proof failed");
  const updatedTemplate=await request("/__local/template-option-update");
  if(updatedTemplate.status!==200||
     (updatedTemplate.raw.mutation as Record<string,unknown>)?.queryCount!==1||
     (updatedTemplate.raw.after as Record<string,unknown>)?.value!=="updated")
    throw Error("Local one-query pinned option upsert UPDATE proof failed");
  console.log("PASS narrow WordPress ON DUPLICATE template translated to one prepared scoped D1 UPSERT");
  const wrong=await request("/__local/deny-crossed-capability");
  if(wrong.status!==200||wrong.raw.capabilityRejected!==true)throw Error("Crossed capability allowed");
  if(JSON.stringify(await rows())!==JSON.stringify([b]))throw Error("Crossed capability mutated D1");
  console.log("PASS wrong operation capability rejected without modifying D1");
  const invalidStore=await request("/__local/store-wrong-capability");
  if(invalidStore.status!==200||invalidStore.raw.rejected!==true||invalidStore.raw.used!==0)
    throw Error("Private read capability incorrectly permitted D1 preparation");
  const batch=await request("/__local/store-batch-read");
  if(batch.status!==200||batch.raw.ok!==true||batch.raw.queries!==1||
     batch.raw.requested!==3||batch.raw.found!==0||
     JSON.stringify(batch.raw.values)!==
       JSON.stringify({shared:null,missing:null,["__proto__"]:null}))
    throw Error("Native D1 options batch leaked another site or used more than one query");
  const batchBudget=await request("/__local/store-batch-budget");
  if(batchBudget.status!==200||batchBudget.raw.used!==50||
     batchBudget.raw.remaining!==0||batchBudget.raw.rejected!==true||
     batchBudget.raw.requested!==96||batchBudget.raw.found!==0)
    throw Error("Native D1 96-key bound and 50-query guard failed");
  console.log("PASS native D1 batch reads 96 keys in one statement, with isolation and query guard");
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
  const revisedBatch=await request("/__local/store-batch-read");
  if(revisedBatch.status!==200||revisedBatch.raw.queries!==1||
     revisedBatch.raw.found!==1||
     (revisedBatch.raw.values as Record<string,unknown>)?.shared!=="site_a_updated")
    throw Error("Native D1 batch read did not observe committed option revision");
  console.log("PASS native batch read observes committed site A revision");
  console.log("PASS one-query INSERT and UPDATE isolated by trusted site identity");
}else{
  const expected=[
    {site_id:"site_a",option_value:"site_a_updated",autoload:"auto-on"},b
  ];
  if(JSON.stringify(await rows())!==JSON.stringify(expected))
    throw Error("Committed option not durable across Workerd restart");
  console.log("PASS native D1 option survives local Workerd restart");
  const persistedSchema=await request("/__local/schema-describe");
  if(persistedSchema.status!==200||persistedSchema.raw.kind!=="describe"||
     persistedSchema.raw.queryCount!==1||
     !Array.isArray(persistedSchema.raw.columns)||
     (persistedSchema.raw.columns as unknown[]).length!==4)
    throw Error("D1 schema metadata changed after Workerd restart");
  console.log("PASS native D1 schema introspection survives Workerd restart");
  const templateAfterRestart=await request("/__local/template-option-read");
  if(templateAfterRestart.status!==200||templateAfterRestart.raw.queries!==1||
     (templateAfterRestart.raw.value as Record<string,unknown>)?.value!=="updated")
    throw Error("Pinned option upsert value did not survive D1 restart");
  const cleanupTemplate=await request("/__local/template-option-delete");
  if(cleanupTemplate.status!==200||
     (cleanupTemplate.raw.mutation as Record<string,unknown>)?.changed!==1)
    throw Error("Pinned option upsert local fixture cleanup failed");
  console.log("PASS pinned WordPress option UPSERT survives restart and deletes safely");


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
