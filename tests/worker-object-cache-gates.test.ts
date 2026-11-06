import {describe,expect,test} from "bun:test";
import {readFileSync} from "node:fs";
const read=(file:string)=>readFileSync(file,"utf8");
describe("WordPress object-cache opt-in fail-closed gates",()=>{
 test("deployed WordPress staging never enables external object cache",()=>{
  const config=JSON.parse(read("wrangler.staging.jsonc"));
  expect(config.vars?.MICROWP_WORKER_CACHE_ENABLED).not.toBe("yes");
  expect(config.services?.some((s:{binding:string})=>s.binding==="REDIS_WORKER")).not.toBe(true);
 });
 test("standalone local proof has private route and trusted Service Binding",()=>{
  const config=JSON.parse(read("wrangler.wp-cache-local-proof.jsonc"));
  expect(config.main).toBe("src/probes/wp-cache-local-proof.ts");
  expect(config.workers_dev).toBe(false);
  expect(config.vars.MICROWP_WORKER_CACHE_ENABLED).toBe("yes");
  expect(config.services).toEqual([{binding:"REDIS_WORKER",service:"microwp-worker-cache"}]);
  expect(config.limits).toBeUndefined();
  expect(config.d1_databases).toBeUndefined();
  expect(config.r2_buckets).toBeUndefined();
 });
 test("runtime only mounts drop-in with both explicit opt-in and binding",()=>{
  const native=read("src/php/native.ts");
  expect(native).toContain('env.MICROWP_WORKER_CACHE_ENABLED==="yes"&&!!env.REDIS_WORKER');
  expect(native).toContain('php.writeFile("/www/wp-content/object-cache.php"');
  expect(native).toContain('handleObjectCacheMessage(message,env.REDIS_WORKER!,"microwp_single_site")');
 });
});
