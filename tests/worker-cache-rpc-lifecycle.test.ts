import {describe,expect,test} from "bun:test";
import {detachCacheRPCResult,disposeCacheRPC} from "../src/worker-cache/rpc-lifecycle";
import type {CacheResult} from "../src/worker-cache/protocol";
describe("Cloudflare RPC cache result ownership",()=>{
 test("copies result and explicitly disposes returned object",()=>{
  const symbol=(Symbol as unknown as {dispose?:symbol}).dispose;
  if(!symbol)return;
  let count=0;
  const original={ok:true,value:"hello",[symbol](){count++}} as CacheResult;
  const result=detachCacheRPCResult(original);
  expect(result).toEqual({ok:true,value:"hello"});
  expect(count).toBe(1);
  expect((result as any)[symbol]).toBeUndefined();
 });
 test("nested metrics detach before disposing source",()=>{
  const symbol=(Symbol as unknown as {dispose?:symbol}).dispose;
  if(!symbol)return;
  let count=0;
  const original={ok:true,stats:{entries:1,bytes:2,hits:3,misses:4,evictions:5},[symbol](){count++}} as CacheResult;
  const copy=detachCacheRPCResult(original);
  expect(copy.ok&&copy.stats?.entries).toBe(1);
  expect(count).toBe(1);
  if(copy.ok&&original.ok)expect(copy.stats).not.toBe(original.stats);
 });
 test("missing disposable metadata never causes an error",()=>{
  expect(()=>disposeCacheRPC(null)).not.toThrow();
  expect(detachCacheRPCResult({ok:false,error:"UNAVAILABLE"})).toEqual({ok:false,error:"UNAVAILABLE"});
 });
});
