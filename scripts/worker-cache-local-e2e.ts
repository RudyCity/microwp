import {join} from "node:path";
/** Two isolated LOCAL Wrangler processes and a private RPC Service Binding.
 * Local dev-session transport may drop while pairing Workers; retry at most
 * three fresh pairs/ports. Never retry a semantic cache contract failure.
 */
const root=join(import.meta.dir,"..");
const runId=String(process.pid);
function spawn(config:string,port:number,state:string){
 return Bun.spawn(["node","node_modules/wrangler/bin/wrangler.js","dev",
  "--config",config,"--local","--ip","127.0.0.1","--port",String(port),
  "--persist-to",state,"--show-interactive-dev-session=false"],{
  cwd:root,stdout:"ignore",stderr:"ignore",stdin:"ignore"
 });
}
function errorMessage(error:unknown):string{
 return error instanceof Error?error.message:"unknown";
}
async function proveCache(baseUrl:string):Promise<void>{
 const response=await fetch(baseUrl+"/__local/cache-smoke",{
  method:"POST",signal:AbortSignal.timeout(5000)});
 const body=await response.text();
 if(response.status===503&&
  /Network connection lost|not found|not connected|cannot connect/i.test(body))
   throw new Error("TRANSIENT_LOCAL_SERVICE_BINDING:"+body.slice(0,200));
 if(response.status!==200)throw new Error("CONTRACT_FAILED_HTTP_"+response.status+":"+body.slice(0,200));
 let result:Record<string,unknown>;
 try{result=JSON.parse(body) as Record<string,unknown>}
 catch{throw new Error("CONTRACT_FAILED_INVALID_JSON")}
 if(!result.ok||!result.serviceBinding||!result.separateSites||!result.addIsAtomic||
  !result.incrementAtomic||!result.concurrentIncrAtomic||!result.siteEmpty)
  throw new Error("CONTRACT_FAILED_INCOMPLETE_EVIDENCE");
}
async function pair(attempt:number):Promise<void>{
 const providerPort=18951+attempt*10,callerPort=providerPort+1;
 const state=".wrangler/worker-cache-local-e2e/"+runId+"-"+attempt;
 const provider=spawn("wrangler.worker-cache.jsonc",providerPort,state);
 let caller:ReturnType<typeof Bun.spawn>|undefined;
 try{
  const providerStart=Date.now();
  let ready=false;
  while(Date.now()-providerStart<25000){
   try{
    const response=await fetch("http://127.0.0.1:"+providerPort+"/",{
     signal:AbortSignal.timeout(1500)});
    if(response.status===404){ready=true;break}
   }catch{}
   await Bun.sleep(250);
  }
  if(!ready)throw new Error("TRANSIENT_LOCAL_SERVICE_BINDING:provider not ready");
  caller=spawn("wrangler.worker-cache-local-client.jsonc",callerPort,state);
  const clientUrl="http://127.0.0.1:"+callerPort;
  const start=Date.now();
  let last="";
  while(Date.now()-start<25000){
   try{
    await proveCache(clientUrl);
    const hidden=await fetch(clientUrl+"/",{signal:AbortSignal.timeout(4000)});
    if(hidden.status!==404)throw new Error("CONTRACT_FAILED_PUBLIC_ROUTE");
    return;
   }catch(error){
    last=errorMessage(error);
    if(last.startsWith("CONTRACT_FAILED"))throw error;
   }
   await Bun.sleep(400);
  }
  throw new Error("TRANSIENT_LOCAL_SERVICE_BINDING:"+last);
 }finally{
  caller?.kill();provider.kill();
  await Promise.race([Promise.allSettled([provider.exited,caller?.exited]),Bun.sleep(4000)]);
 }
}
let completed=false;
for(let attempt=0;attempt<3;attempt++){
 try{
  await pair(attempt);completed=true;
  if(attempt>0)console.log("Local Wrangler service pairing recovered after",attempt,"bounded retry/retries");
  break;
 }catch(error){
  const message=errorMessage(error);
  if(!message.startsWith("TRANSIENT_LOCAL_SERVICE_BINDING"))throw error;
  if(attempt===2)throw new Error("Local service binding remained unavailable after 3 fresh pairs");
 }
}
if(!completed)throw new Error("Local Worker cache evidence incomplete");
console.log("PASS local two Workers + private Service Binding + per-site Durable Object Redis-like cache");
console.log("PASS GET SET ADD DEL INCR group flush, concurrent atomic increment, site isolation and restricted public surface");
