import {join} from "node:path";
/** Local-only integration: two real Workers, PHP-WASM WordPress inside a DO,
 * service-binding RPC to the existing dedicated cache Worker.
 */
const root=join(import.meta.dir,"..");
function spawn(config:string,port:number,state:string){
 return Bun.spawn(["node","node_modules/wrangler/bin/wrangler.js","dev",
  "--config",config,"--local","--ip","127.0.0.1","--port",String(port),
  "--persist-to",state,"--show-interactive-dev-session=false"],{
  cwd:root,stdout:"ignore",stderr:"ignore",stdin:"ignore"
 });
}
async function attempt(n:number):Promise<void>{
 const port=19141+n*20,clientPort=port+1;
 const state=".wrangler/wp-object-cache-e2e/"+process.pid+"-"+n;
 const cache=spawn("wrangler.worker-cache.jsonc",port,state);
 let client:ReturnType<typeof Bun.spawn>|undefined;
 try{
  const start=Date.now();
  let ready=false;
  while(Date.now()-start<30000){
   try{
    const response=await fetch("http://127.0.0.1:"+port+"/",{
     signal:AbortSignal.timeout(1300)});
    if(response.status===404){ready=true;break;}
   }catch{}
   await Bun.sleep(300);
  }
  if(!ready)throw Error("LOCAL_PAIRING:provider not ready");
  client=spawn("wrangler.wp-cache-local-proof.jsonc",clientPort,state);
  const url="http://127.0.0.1:"+clientPort;
  let result:Record<string,unknown>|undefined;
  const deadline=Date.now()+45000;
  let last="unreachable";
  while(Date.now()<deadline){
   try{
    const response=await fetch(url+"/__local/wordpress-cache-proof",{
     method:"POST",signal:AbortSignal.timeout(22000)
    });
    const body=await response.text();
    if(response.status===200){
     try{result=JSON.parse(body) as Record<string,unknown>}
     catch{throw Error("CONTRACT:non-JSON PHP/WP proof")}
     break;
    }
    if(response.status===503 && /PROOF_UNAVAILABLE|Network connection lost|not found|not connected/i.test(body)){
     last=body.slice(0,220);await Bun.sleep(600);continue;
    }
    if(response.status===503){
     try {
      const parsed=JSON.parse(body) as Record<string,unknown>;
      if(parsed.ok===false && "phpDropin" in parsed)
       throw Error("CONTRACT:WordPress PHP bridge incomplete: "+JSON.stringify(parsed));
     }catch(error){
      if(error instanceof Error&&error.message.startsWith("CONTRACT:"))throw error;
     }
    }
    last="HTTP "+response.status+": "+body.slice(0,220);
   }catch(error){
    if(error instanceof Error&&error.message.startsWith("CONTRACT:"))throw error;
    last=error instanceof Error?error.message:"unknown";
   }
   await Bun.sleep(700);
  }
  if(!result)throw Error("LOCAL_PAIRING:"+last);
  if(result.ok!==true||result.phpDropin!==true||result.crossRequest!==true||
    result.invalidated!==true||result.wordpressInstaller!==true)
   throw Error("CONTRACT:missing PHP WordPress cache E2E evidence");
  const blocked=await fetch(url+"/wp-admin/",{signal:AbortSignal.timeout(6000)});
  if(blocked.status!==404)throw Error("CONTRACT:public WordPress admin exposed");
 }finally{
  client?.kill();cache.kill();
  await Promise.race([Promise.allSettled([cache.exited,client?.exited]),Bun.sleep(4000)]);
 }
}
let passed=false;
for(let i=0;i<3;i++){
 try{
  await attempt(i);
  if(i>0)console.log("Local Wrangler Service Binding pairing recovered after",i,"fresh pair(s)");
  passed=true;break;
 }catch(error){
  if(!(error instanceof Error)||!error.message.startsWith("LOCAL_PAIRING:")||i===2)
   throw error;
 }
}
if(!passed)throw Error("Actual WordPress cache bridge E2E not proven");
console.log("PASS actual PHP-WASM WordPress installer inside DO with opt-in object-cache.php");
console.log("PASS cross-PHP-request Worker cache HIT and wp_cache_flush_group invalidation over Service Binding");
console.log("PASS cache proof has no public WordPress admin route or paid Cloudflare dependency");
