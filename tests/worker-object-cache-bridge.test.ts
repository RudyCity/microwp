import {describe,expect,test} from "bun:test";
import {
  OBJECT_CACHE_GROUP,OBJECT_CACHE_MESSAGE_PREFIX,handleObjectCacheMessage,parseObjectCacheMessage
} from "../src/php/worker-object-cache-bridge";
import {BoundedCacheStore} from "../src/worker-cache/store";
import type {CacheCommand} from "../src/worker-cache/protocol";
function wire(op:string,rest:Record<string,unknown>={}):string{
 return OBJECT_CACHE_MESSAGE_PREFIX+JSON.stringify({version:1,group:OBJECT_CACHE_GROUP,op,...rest});
}
describe("PHP object-cache bridge",()=>{
 test("only explicitly opted-in public group and approved operations",()=>{
  expect(parseObjectCacheMessage(wire("get",{key:"home:v0123456789abcdef"}))?.op).toBe("get");
  for(const bad of [
   wire("eval",{key:"test:v0123456789abcdef",code:"die()"}),wire("get",{key:"test:v0123456789abcdef",site:"someone_else"}),
   wire("get",{key:"test:v0123456789abcdef",group:"users"}),wire("flushSite"),
   wire("get",{key:"../../secret"}).replace('home:v1','irrelevant'),
   wire("set",{key:"test:v0123456789abcdef",value:"!!",ttlSeconds:30}),wire("set",{key:"test:v0123456789abcdef",value:"YQ==",ttlSeconds:86400}),
   wire("set",{key:"test:v0123456789abcdef",value:"YQ==",ttlSeconds:0}),
   "untrusted:"+JSON.stringify({version:1,op:"get",group:OBJECT_CACHE_GROUP,key:"test:v0123456789abcdef"}),
  ]){

   expect(parseObjectCacheMessage(bad)).toBeNull();
  }
 });
 test("site identity cannot be injected through PHP message",async()=>{
  const sites:string[]=[];
  const store=new BoundedCacheStore();
  const binding={execute:async(c:CacheCommand)=>{
   sites.push(c.site);
   return store.execute(c,1000);
  }};
  const put=JSON.parse(await handleObjectCacheMessage(wire("set",{key:"home:v0123456789abcdef",value:"YQ==",ttlSeconds:30}),binding,"site_a"));
  expect(put).toEqual({ok:true,stored:true});
  const get=JSON.parse(await handleObjectCacheMessage(wire("get",{key:"home:v0123456789abcdef"}),binding,"site_a"));
  expect(get).toEqual({ok:true,found:true,value:"YQ=="});
  const miss=JSON.parse(await handleObjectCacheMessage(wire("get",{key:"missing:v0123456789abcdef"}),binding,"site_a"));
  expect(miss).toEqual({ok:true,found:false});
  expect(sites).toEqual(["site_a","site_a","site_a"]);
  expect(await handleObjectCacheMessage(wire("get",{key:"test:v0123456789abcdef",site:"evil"}),binding,"site_a")).toBe('{"ok":false}');
 });
 test("invalidation and fail-closed Service Binding errors",async()=>{
  const store=new BoundedCacheStore();
  const binding={execute:async(c:CacheCommand)=>store.execute(c,1000)};
  await handleObjectCacheMessage(wire("set",{key:"post:v0123456789abcdef",value:"YQ==",ttlSeconds:30}),binding,"site_a");
  expect(JSON.parse(await handleObjectCacheMessage(wire("flushGroup"),binding,"site_a")).deleted).toBe(1);
  expect(JSON.parse(await handleObjectCacheMessage(wire("get",{key:"post:v0123456789abcdef"}),binding,"site_a")).found).toBe(false);
  const broken={execute:async(_c:CacheCommand)=>{throw Error("private credential")}};
  expect(await handleObjectCacheMessage(wire("get",{key:"post:v0123456789abcdef"}),broken,"site_a")).toBe('{"ok":false}');
 });
});
