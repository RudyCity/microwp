/**
 * Isolated Workerd E2E for WordPress running INSIDE Durable Object fetch().
 * Local-only, generates one ephemeral token; no remote deploy or Cloudflare billing.
 */
import {randomBytes} from "node:crypto";
import {join} from "node:path";
import {CANARY_PATH} from "../src/probes/free-do-cpu-policy";

const root=join(import.meta.dir,"..");
const port=18927;
const origin="http://127.0.0.1:"+port;
const token=randomBytes(48).toString("base64url");
const worker=Bun.spawn(["node","node_modules/wrangler/bin/wrangler.js",
 "dev","--config","wrangler.free-do-cpu.jsonc","--local","--ip","127.0.0.1",
 "--port",String(port),"--persist-to",".wrangler/free-do-cpu-e2e",
 "--show-interactive-dev-session=false","--var","STAGING_PROBE_KEY:"+token],{
 cwd:root,stdout:"ignore",stderr:"ignore",stdin:"ignore"
});
async function post(body:unknown,secret?:string,timeout=40000):Promise<Response>{
 return fetch(origin+CANARY_PATH,{method:"POST",
  headers:{"Content-Type":"application/json",...(secret?{"X-MicroWP-Probe-Key":secret}:{})},
  body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});
}
async function ready():Promise<void>{
 const start=Date.now();
 while(Date.now()-start<35000){
  try{
   const response=await post({mode:"cpu",loops:0},undefined,1800);
   if(response.status===404)return;
  }catch{}
  await Bun.sleep(250);
 }
 throw new Error("isolated local Durable Object Worker did not start");
}
try {
 await ready();
 const unauth=await post({mode:"cpu",loops:50000});
 if(unauth.status!==404)throw new Error("Unauthorized canary request was not denied");
 const invalid=await post({mode:"cpu",loops:99999999},token);
 if(invalid.status!==400)throw new Error("Unbounded CPU task was not denied");
 for(const task of [{mode:"cpu",loops:50000},{mode:"php"},{mode:"wordpress"}]){
  const start=performance.now();
  const response=await post(task,token,65000);
  if(response.status!==200)throw new Error("Canary "+task.mode+" returned HTTP "+response.status);
  const result=await response.json() as Record<string,unknown>;
  if(result.ok!==true||result.scope!=="durable-object"||result.mode!==task.mode)
    throw new Error("Malformed Durable Object result for "+task.mode);
  if(task.mode==="wordpress"&&
    (result.installerStatus!==200||result.installerForm!==true||result.phpVersion!=="8.4.27"))
    throw new Error("Actual WordPress PHP installer did not run in the Durable Object");
  if(task.mode==="php"&&(result.sqlite!==true||result.phpVersion!=="8.4.27"))
    throw new Error("PHP-WASM PDO SQLite missing in Durable Object");
  console.log("PASS local Durable Object",task.mode,"HTTP 200; client wall ms",Math.round(performance.now()-start));
 }
 const denied=await fetch(origin+"/wp-admin/");
 if(denied.status!==404)throw new Error("WordPress admin route accidentally public");
 console.log("PASS secret gate, malformed tasks and public WordPress lock");
 console.log("PASS local PHP-WASM + WordPress installer inside Durable Object; not proof of remote Free CPU");
}finally{
 worker.kill();
 await Promise.race([worker.exited,Bun.sleep(4000)]);
}
