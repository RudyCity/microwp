import {describe,expect,test} from "bun:test";
import {readFileSync} from "node:fs";
const read=(file:string)=>JSON.parse(readFileSync(file,"utf8"));
describe("local WordPress with Worker cache editorial proof isolation",()=>{
 test("not a production or public Worker",()=>{
  const conf=read("wrangler.wp-cache-editorial-local.jsonc");
  expect(conf.name).toContain("local-only");
  expect(conf.workers_dev).toBe(false);
  expect(conf.vars).toEqual({MICROWP_STORAGE_DRIVER:"d1",MICROWP_WORKER_CACHE_ENABLED:"yes",MICROWP_LOCAL_TRANSIENT_PROOF:"yes"});
  expect(conf.limits).toBeUndefined();
  expect(conf.services).toEqual([{binding:"REDIS_WORKER",service:"microwp-worker-cache"}]);
 });
 test("uses uniquely isolated local D1 and R2, never staging IDs",()=>{
  const conf=read("wrangler.wp-cache-editorial-local.jsonc");
  const staging=read("wrangler.staging.jsonc");
  expect(conf.d1_databases[0].database_id).toBe("00000000-0000-4000-8000-000000000007");
  expect(conf.r2_buckets[0].bucket_name).toBe("microwp-wp-cache-editorial-local-media");
  expect(conf.d1_databases[0].database_id).not.toBe(staging.d1_databases[0].database_id);
  expect(conf.r2_buckets[0].bucket_name).not.toBe(staging.r2_buckets[0].bucket_name);
 });
 test("existing live staging never opts into an external object cache",()=>{
  const staging=read("wrangler.staging.jsonc");
  expect(staging.vars.MICROWP_WORKER_CACHE_ENABLED).not.toBe("yes");
  expect(staging.services?.some((x:{binding:string})=>x.binding==="REDIS_WORKER")).not.toBe(true);
 });
});
