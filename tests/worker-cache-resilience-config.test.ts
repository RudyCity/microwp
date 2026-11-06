import {describe,expect,test} from "bun:test";
import {readFileSync} from "node:fs";
const load=(path:string)=>JSON.parse(readFileSync(path,"utf8")) as Record<string,any>;
describe("WordPress cache failure/recovery local-only config",()=>{
 test("fault and recovery endpoints are private, never reuse the deployed cache Worker name",()=>{
  const a=load("wrangler.worker-cache-fault-local.jsonc");
  const b=load("wrangler.worker-cache-recovered-local.jsonc");
  expect(a.name).toBe("microwp-cache-resilience-local-only");
  expect(a.name).toBe(b.name);
  expect(a.name).not.toBe("microwp-worker-cache");
  expect(a.workers_dev).toBe(false);
  expect(b.workers_dev).toBe(false);
  expect(a.routes).toBeUndefined();
  expect(b.routes).toBeUndefined();
  expect(a.d1_databases).toBeUndefined();
  expect(a.r2_buckets).toBeUndefined();
  expect(b.durable_objects.bindings[0].name).toBe("CACHE_DO");
 });
 test("WordPress D1/R2 resources are sandboxed in local test config",()=>{
  const config=load("wrangler.wp-cache-fault-editorial-local.jsonc");
  const staging=load("wrangler.staging.jsonc");
  expect(config.workers_dev).toBe(false);
  expect(config.services[0]).toEqual({
   binding:"REDIS_WORKER",service:"microwp-cache-resilience-local-only"
  });
  expect(config.d1_databases[0].database_id).toBe("00000000-0000-4000-8000-000000000009");
  expect(config.d1_databases[0].database_id).not.toBe(staging.d1_databases[0].database_id);
  expect(config.r2_buckets[0].bucket_name).toBe("microwp-cache-resilience-local-media");
  expect(config.r2_buckets[0].bucket_name).not.toBe(staging.r2_buckets[0].bucket_name);
  expect(staging.services?.some((v:{binding:string})=>v.binding==="REDIS_WORKER")).not.toBe(true);
 });
 test("fault Worker throws on RPC and cannot return fabricated success",()=>{
  const source=readFileSync("src/probes/wp-cache-rpc-failure-local.ts","utf8");
  expect(source).toContain('throw new Error("LOCAL_CACHE_SERVICE_UNAVAILABLE")');
  expect(source).not.toContain("stored:true");
  expect(source).toContain('status:404');
 });
});
