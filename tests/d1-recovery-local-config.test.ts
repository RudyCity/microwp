import {describe,expect,test} from "bun:test";
import {readFileSync} from "node:fs";
const get=(file:string)=>readFileSync(file,"utf8");
describe("independent WordPress D1 recovery E2E isolation",()=>{
 test("fault injection is explicitly local-only, not production Cloudflare D1",()=>{
  const conf=JSON.parse(get("wrangler.d1-absence-recovery-local.jsonc"));
  const staging=JSON.parse(get("wrangler.staging.jsonc"));
  expect(conf.name).toBe("microwp-d1-absence-recovery-local-only");
  expect(conf.workers_dev).toBe(false);
  expect(conf.d1_databases[0].database_id).toBe("00000000-0000-4000-8000-000000000011");
  expect(conf.d1_databases[0].database_id).not.toBe(staging.d1_databases[0].database_id);
  expect(conf.r2_buckets[0].bucket_name).not.toBe(staging.r2_buckets[0].bucket_name);
  expect(conf.routes).toBeUndefined();
 });
 test("the test deletes only its own local D1 manifest after stopping its Worker",()=>{
  const script=get("scripts/d1-absence-recovery-local-e2e.sh");
  expect(script).toContain("--local");
  expect(script).toContain('stop_worker\nsleep 2');
  expect(script).toContain("DELETE FROM microwp_db_snapshots;");
  expect(script).not.toContain("--remote");
  expect(script).not.toContain("microwp-alpha-staging-db");
  expect(script).not.toContain("microwp-local-dev-db");
 });
 test("real Durable Object checks and arms the recovery marker before D1 writes",()=>{
  const durable=get("src/index-durable.ts");
  const verify=durable.indexOf("verifyExpectedD1Snapshot(");
  const restore=durable.indexOf("if(d1Snapshot)await restoreNativeDB(");
  const mark=durable.indexOf("await armD1SnapshotRecovery(this.ctx.storage);",restore);
  const save=durable.indexOf("await saveD1SQLite(this.env.DB,snapshot");
  expect(verify).toBeGreaterThan(0);
  expect(verify).toBeLessThan(restore);
  expect(mark).toBeGreaterThan(restore);
  expect(mark).toBeLessThan(save);
 });
});
