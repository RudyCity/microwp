import {describe,expect,test} from "bun:test";
import {invalidatePublicCacheAfterCommit,shouldInvalidatePublicCache} from "../src/php/worker-cache-invalidation";
import {BoundedCacheStore} from "../src/worker-cache/store";
import type {CacheCommand} from "../src/worker-cache/protocol";
const key="home:v0123456789abcdef";
describe("post-commit WordPress public cache invalidation",()=>{
 test("GET, HEAD, OPTIONS and disabled staging never flush cache",async()=>{
  const store=new BoundedCacheStore();
  let calls=0;
  const binding={execute:async(c:CacheCommand)=>{calls++;return store.execute(c,1000)}};
  for(const method of ["GET","HEAD","OPTIONS","TRACE"]){
   expect(shouldInvalidatePublicCache(method,"yes",binding)).toBe(false);
   expect(await invalidatePublicCacheAfterCommit(method,"yes",binding)).toBe("skipped");
  }
  expect(await invalidatePublicCacheAfterCommit("POST","no",binding)).toBe("skipped");
  expect(await invalidatePublicCacheAfterCommit("POST","yes",undefined)).toBe("skipped");
  expect(calls).toBe(0);
 });
 test("post-commit write invalidates exactly the public cache group",async()=>{
  const store=new BoundedCacheStore();
  let groups:string[]=[];
  const binding={execute:async(c:CacheCommand)=>{
   if(c.op==="flushGroup")groups.push(c.group);
   return store.execute(c,1000);
  }};
  const msg=(group:string)=>({version:1,site:"microwp_single_site",op:"set",group,key,value:"ZGF0YQ==",ttlSeconds:30} as const);
  store.execute(msg("microwp_public"),1000);
  store.execute(msg("posts"),1000);
  for(const method of ["POST","PUT","PATCH","DELETE"]){
   store.execute(msg("microwp_public"),1000);
   expect(await invalidatePublicCacheAfterCommit(method,"yes",binding)).toBe("flushed");
   expect(store.execute({version:1,site:"microwp_single_site",op:"get",group:"microwp_public",key},1000)).toEqual({ok:true,value:null});
   expect(store.execute({version:1,site:"microwp_single_site",op:"get",group:"posts",key},1000)).toEqual({ok:true,value:"ZGF0YQ=="});
  }
  expect(groups).toEqual(["microwp_public","microwp_public","microwp_public","microwp_public"]);
 });
 test("worker RPC failure is visible, not misrepresented as success",async()=>{
  const unavailable={execute:async(_c:CacheCommand)=>{throw Error("test network unavailable")}};
  expect(await invalidatePublicCacheAfterCommit("POST","yes",unavailable)).toBe("unavailable");
 });
});
