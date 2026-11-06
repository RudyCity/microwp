import {describe,expect,test} from "bun:test";
import {BoundedCacheStore} from "../src/worker-cache/store";
import {parseCacheCommand,CACHE_LIMITS} from "../src/worker-cache/protocol";
import {WorkerRedisClient} from "../src/worker-cache/client";
function task(op:string,extra:Record<string,unknown>={}) {
 return {version:1,site:"site_a",group:"public",key:"k",op,...extra}
}
describe("Redis-like Worker cache input contract",()=>{
 test("denies arbitrary scripts, oversized values, unsafe keys and private groups",()=>{
  expect(parseCacheCommand({...task("eval"),code:"return 1"})).toBeNull();
  expect(parseCacheCommand(task("set",{value:"v",ttlSeconds:1,sql:"DROP TABLE"}))).toBeNull();
  expect(parseCacheCommand(task("set",{value:"x".repeat(65537),ttlSeconds:3}))).toBeNull();
  expect(parseCacheCommand(task("set",{value:"x",ttlSeconds:86401}))).toBeNull();
  expect(parseCacheCommand({...task("get"),key:"bad\u0000key"})).toBeNull();
  expect(parseCacheCommand({...task("get"),group:"auth"})).toBeNull();
  expect(parseCacheCommand({...task("get"),site:"../someone_else"})).toBeNull();
 });
 test("SET GET ADD DEL and TTL stay consistent",()=>{
  const s=new BoundedCacheStore();
  expect(s.execute(task("get"),1000)).toEqual({ok:true,value:null});
  expect(s.execute(task("set",{value:"value",ttlSeconds:2}),1000)).toEqual({ok:true,stored:true});
  expect(s.execute(task("get"),1001)).toEqual({ok:true,value:"value"});
  expect(s.execute(task("add",{value:"new",ttlSeconds:2}),1001)).toEqual({ok:true,stored:false});
  expect(s.execute(task("ttl"),1001)).toEqual({ok:true,ttlSeconds:2});
  expect(s.execute(task("get"),3000)).toEqual({ok:true,value:null});
  expect(s.execute(task("ttl"),3000)).toEqual({ok:true,ttlSeconds:-2});
  expect(s.execute(task("add",{value:"new",ttlSeconds:2}),3000)).toEqual({ok:true,stored:true});
  expect(s.execute(task("del"),3001)).toEqual({ok:true,deleted:1});
  expect(s.execute(task("del"),3001)).toEqual({ok:true,deleted:0});
 });
 test("INCR uses bounded atomic numeric semantics",()=>{
  const s=new BoundedCacheStore();
  expect(s.execute(task("incr",{by:1,ttlSeconds:20}),1000)).toEqual({ok:true,number:1});
  expect(s.execute(task("incr",{by:2,ttlSeconds:20}),1001)).toEqual({ok:true,number:3});
  expect(s.execute(task("ttl"),1001)).toEqual({ok:true,ttlSeconds:20});
  expect(s.execute(task("set",{value:"x",ttlSeconds:20}),1001)).toEqual({ok:true,stored:true});
  expect(s.execute(task("incr",{by:1,ttlSeconds:20}),1002)).toEqual({ok:false,error:"NOT_INTEGER"});
  expect(s.execute(task("set",{value:"2147483647",ttlSeconds:20}),1002)).toEqual({ok:true,stored:true});
  expect(s.execute(task("incr",{by:1,ttlSeconds:20}),1002)).toEqual({ok:false,error:"NOT_INTEGER"});
 });
 test("INCR never extends an existing absolute expiry",()=>{
  const s=new BoundedCacheStore();
  expect(s.execute(task("set",{value:"1",ttlSeconds:2}),1000)).toEqual({ok:true,stored:true});
  for(let i=0;i<5;i++)expect(s.execute(task("incr",{by:1,ttlSeconds:30}),2900)).toEqual({ok:true,number:i+2});
  expect(s.execute(task("get"),3000)).toEqual({ok:true,value:null});
 });
 test("site/group boundaries and malformed inputs fail closed",()=>{
  const s=new BoundedCacheStore();
  expect(s.execute({...task("set",{value:"private",ttlSeconds:20}),group:"posts"},1000)).toEqual({ok:true,stored:true});
  expect(s.execute({...task("get"),group:"public"},1000)).toEqual({ok:true,value:null});
  // Store has one DO per site: local in-memory store alone cannot enforce site isolation.
  // The Worker routing layer chooses a distinct DO ID for each trusted site.
  expect(s.execute({...task("set",{value:"v",ttlSeconds:0})},1000)).toEqual({ok:false,error:"INVALID_COMMAND"});
 });
 test("EXPIRE and FLUSH GROUP preserve other groups",()=>{
  const s=new BoundedCacheStore();
  s.execute(task("set",{value:"one",ttlSeconds:8}),1000);
  s.execute({...task("set",{value:"two",ttlSeconds:8}),group:"posts"},1000);
  expect(s.execute(task("expire",{ttlSeconds:1}),1000)).toEqual({ok:true,stored:true});
  expect(s.execute(task("get"),2000)).toEqual({ok:true,value:null});
  expect(s.execute({...task("get"),group:"posts"},2000)).toEqual({ok:true,value:"two"});
  expect(s.execute({version:1,site:"site_a",op:"flushGroup",group:"posts"},2000)).toEqual({ok:true,deleted:1});
  expect(s.execute({version:1,site:"site_a",op:"flushSite"},2000)).toEqual({ok:true,deleted:0});
 });
 test("LRU eviction enforces bounded entries and stats",()=>{
  const s=new BoundedCacheStore();
  for(let i=0;i<CACHE_LIMITS.maxKeys+1;i++){
   expect(s.execute({...task("set",{value:"v",ttlSeconds:60}),key:"k"+i},1000)).toEqual({ok:true,stored:true});
  }
  expect(s.execute({version:1,site:"site_a",op:"stats"},1000)).toEqual({ok:true,stats:{
    entries:CACHE_LIMITS.maxKeys,bytes:expect.any(Number),hits:0,misses:0,evictions:1
  }});
  expect(s.execute({...task("get"),key:"k0"},1000)).toEqual({ok:true,value:null});
 });
 test("trusted client seals site and forwards only validated calls",async()=>{
  const observed:string[]=[];
  const db=new BoundedCacheStore();
  const client=new WorkerRedisClient({execute:async cmd=>{
    observed.push(cmd.site);
    return db.execute(cmd,1000);
  }},"site_a");
  expect(await client.set("public","welcome","hello")).toBe(true);
  expect(await client.get("public","welcome")).toBe("hello");
  expect(await client.incr("public","count")).toBe(1);
  expect(await client.flushGroup("public")).toBe(2);
  expect(observed.every(site=>site==="site_a")).toBe(true);
  await expect(client.get("auth","bad")).rejects.toThrow();
 });
});
