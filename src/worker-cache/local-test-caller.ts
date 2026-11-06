/**
 * ONLY for isolated local Wrangler Service Binding E2E.
 * Not referenced by production configs and deliberately refuses non-loopback.
 */
import {WorkerRedisClient,type CacheBinding} from "./client";
interface TestEnv{REDIS_WORKER:CacheBinding}
export default{
 async fetch(request:Request,env:TestEnv):Promise<Response>{
  const url=new URL(request.url);
  if(!["127.0.0.1","localhost"].includes(url.hostname)||
   url.pathname!=="/__local/cache-smoke"||request.method!=="POST")
    return new Response("Not Found",{status:404});
  const a=new WorkerRedisClient(env.REDIS_WORKER,"site_a");
  const b=new WorkerRedisClient(env.REDIS_WORKER,"site_b");
  try{
   await a.flushSite();await b.flushSite();
   const stored=await a.set("public","home","a-page",3);
   const own=await a.get("public","home");
   const other=await b.get("public","home");
   const added=await a.add("public","home","overwrite",3);
   const inc1=await a.incr("public","views");
   const inc2=await a.incr("public","views",2);
   // Independent RPCs racing over one DO must not lose increments.
   await Promise.all(Array.from({length:5},()=>a.incr("public","race")));
   const race=await a.get("public","race");
   const groupDeleted=await a.flushGroup("public");
   const gone=await a.get("public","home");
   const stats=await a.stats();
   await a.flushSite();await b.flushSite();
   const ok=stored&&own==="a-page"&&other===null&&added===false&&
    inc1===1&&inc2===3&&race==="5"&&groupDeleted===3&&gone===null&&stats.entries===0;
   return Response.json({ok,serviceBinding:true,separateSites:other===null,
    addIsAtomic:added===false,incrementAtomic:inc2===3,concurrentIncrAtomic:race==="5",groupDeleted,siteEmpty:stats.entries===0},
    {status:ok?200:503,headers:{"Cache-Control":"no-store"}});
  }catch(e){
   return Response.json({ok:false,reason:e instanceof Error?e.message:"unknown"},
    {status:503,headers:{"Cache-Control":"no-store"}});
  }
 }
};
