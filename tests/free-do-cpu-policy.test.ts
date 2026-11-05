import {describe,expect,test} from "bun:test";
import {authorizeToken,boundedWork,CANARY_BODY_MAX,CANARY_PATH,CPU_SAMPLES,INTERNAL_PATH,validateTask} from "../src/probes/free-do-cpu-policy";
describe("free Durable Object CPU/WordPress probe policy",()=>{
 test("only bounded workload samples are permitted",()=>{
  for(const loops of CPU_SAMPLES)expect(validateTask({mode:"cpu",loops})).toEqual({mode:"cpu",loops});
  for(const loops of [-1,1,12,1e8,"50000",null])expect(validateTask({mode:"cpu",loops})).toBeNull();
  expect(validateTask({mode:"cpu",loops:0,sql:"DELETE FROM wp_posts"})).toBeNull();
 });
 test("PHP and WordPress modes never accept a path or PHP text",()=>{
  expect(validateTask({mode:"php"})).toEqual({mode:"php",loops:0});
  expect(validateTask({mode:"wordpress",loops:0})).toEqual({mode:"wordpress",loops:0});
  for(const v of [{mode:"wordpress",php:"<?php echo 1"},{mode:"php",path:"/wp-config.php"},
    {mode:"wordpress",loops:20},{mode:"delete",loops:0},null,[]])
    expect(validateTask(v)).toBeNull();
 });
 test("token comparison requires a strong secret and never authorizes missing/wrong secret",async()=>{
  const key="A".repeat(64);
  expect(await authorizeToken(key,key)).toBe(true);
  expect(await authorizeToken("B".repeat(64),key)).toBe(false);
  expect(await authorizeToken(null,key)).toBe(false);
  expect(await authorizeToken(key,undefined)).toBe(false);
  expect(await authorizeToken("secret","secret")).toBe(false);
 });
 test("bounded deterministic CPU loop computes a real checksum",()=>{
  expect(boundedWork(0)).toBe(0x13572468);
  expect(boundedWork(50000)).toBe(boundedWork(50000));
  expect(boundedWork(250000)).not.toBe(boundedWork(50000));
  expect(()=>boundedWork(10_000_000)).toThrow("Invalid CPU sample");
 });
 test("probe configuration is opt-in and never sets paid CPU limits",async()=>{
  const {readFileSync}=await import("node:fs");
  const cfg=JSON.parse(readFileSync("wrangler.free-do-cpu.jsonc","utf8"));
  expect(cfg.main).toBe("src/probes/free-do-cpu.ts");
  expect(cfg.limits).toBeUndefined();
  expect(cfg.vars.MICROWP_STAGING_MODE).toBe("isolated-probe-only");
  expect(cfg.durable_objects.bindings[0].class_name).toBe("MicroWPFreeCpuDO");
  expect(cfg.d1_databases).toBeUndefined();
  expect(cfg.r2_buckets).toBeUndefined();
  expect(CANARY_BODY_MAX).toBeLessThan(256);
  expect(CANARY_PATH).not.toBe(INTERNAL_PATH);
 });
});
