import {join} from "node:path";
/** Local only: two distinct Wrangler processes, real Service Binding RPC + DO. */
const root=join(import.meta.dir,"..");
function start(config:string,port:number){
 return Bun.spawn(["node","node_modules/wrangler/bin/wrangler.js","dev",
  "--config",config,"--local","--ip","127.0.0.1","--port",String(port),
  "--persist-to",".wrangler/worker-cache-local-e2e",
  "--show-interactive-dev-session=false"],{
  cwd:root,stdout:"ignore",stderr:"ignore",stdin:"ignore"
 });
}
const cache=start("wrangler.worker-cache.jsonc",18951);
let caller:ReturnType<typeof Bun.spawn>|undefined;
async function check():Promise<boolean>{
 const response=await fetch("http://127.0.0.1:18952/__local/cache-smoke",{
  method:"POST",signal:AbortSignal.timeout(3000)});
 if(response.status!==200){
  const body=await response.text();
  throw new Error("Service Binding check returned "+response.status+": "+body.slice(0,200));
 }
 const result=await response.json() as Record<string,unknown>;
 if(!result.ok||!result.serviceBinding||!result.separateSites||!result.addIsAtomic||
  !result.incrementAtomic||!result.siteEmpty)throw new Error("Service binding proof incomplete");
 return true;
}
try{
 const providerStart=Date.now();
 let providerReady=false;
 while(Date.now()-providerStart<35000){
  try{
   const response=await fetch("http://127.0.0.1:18951/",{signal:AbortSignal.timeout(1300)});
   if(response.status===404){providerReady=true;break}
  }catch{}
  await Bun.sleep(300);
 }
 if(!providerReady)throw new Error("Dedicated cache Worker failed to become ready");
 caller=start("wrangler.worker-cache-local-client.jsonc",18952);
 const startAt=Date.now();
 let lastError="";
 while(Date.now()-startAt<50000){
  try{if(await check())break}catch(e){lastError=e instanceof Error?e.message:"unknown"}
  await Bun.sleep(700);
 }
 if(Date.now()-startAt>=50000)throw new Error("Worker cache local E2E failed: "+lastError);
 const blocked=await fetch("http://127.0.0.1:18952/",{signal:AbortSignal.timeout(4000)});
 if(blocked.status!==404)throw new Error("Local caller leaked an extra route");
 console.log("PASS local two Workers + private Service Binding + per-site Durable Object Redis-like cache");
 console.log("PASS GET SET ADD DEL INCR group flush, site isolation, restricted public surface");
}finally{
 caller?.kill();cache.kill();
 await Promise.race([Promise.allSettled([cache.exited,caller?.exited]),Bun.sleep(4000)]);
}
