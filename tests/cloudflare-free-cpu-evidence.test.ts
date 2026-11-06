import {describe,expect,test} from "bun:test";
import {readFileSync} from "node:fs";
import {
 FREE_INGRESS_CPU_MS,SQLITE_DO_DEFAULT_CPU_MS,ISOLATE_MEMORY_BYTES,
 parseCpuObservation,assessCpuEvidence
} from "../src/probes/free-cpu-budget-evidence";
const record=(scope:"ingress-worker"|"sqlite-durable-object",overrides:Record<string,unknown>={})=>
 ({evidenceSource:"cloudflare-remote",scope,phase:"wordpress-installer",
 outcome:"ok",cpuTimeMs:2000,wallTimeMs:2100,memoryBytes:null,...overrides});
describe("Cloudflare Free CPU evidence must identify execution scope",()=>{
 test("distinguishes regular Workers Free from SQLite Durable Object budget",()=>{
  expect(FREE_INGRESS_CPU_MS).toBe(10);
  expect(SQLITE_DO_DEFAULT_CPU_MS).toBe(30_000);
  expect(ISOLATE_MEMORY_BYTES).toBe(134_217_728);
  const ingress=parseCpuObservation(record("ingress-worker"));
  const durable=parseCpuObservation(record("sqlite-durable-object"));
  expect(assessCpuEvidence(ingress!).status).toBe("exceeded-budget");
  expect(assessCpuEvidence(durable!).status).toBe("cpu-pass-only");
  expect(assessCpuEvidence(durable!).productionReady).toBe(false);
 });
 test("never uses wall time as CPU or infers missing memory",()=>{
  const observation=parseCpuObservation(record("sqlite-durable-object",{
   cpuTimeMs:null,wallTimeMs:20000,memoryBytes:null
  }));
  expect(assessCpuEvidence(observation!).status).toBe("unverified");
  expect(assessCpuEvidence(observation!).memoryStatus).toBe("not-measured");
 });
 test("remote outcome exceededCpu outweighs a seemingly acceptable metric",()=>{
  const observed=parseCpuObservation(record("sqlite-durable-object",{
   outcome:"exceededCpu",cpuTimeMs:2010
  }));
  expect(assessCpuEvidence(observed!).status).toBe("exceeded-budget");
 });
 test("unknown, invalid or local-only evidence cannot pass the remote gate",()=>{
  for(const raw of [
   record("sqlite-durable-object",{evidenceSource:"local-workerd"}),
   record("sqlite-durable-object",{cpuTimeMs:Infinity}),
   record("sqlite-durable-object",{cpuTimeMs:-2}),
   record("sqlite-durable-object",{origin:"localhost"}),
   record("sqlite-durable-object",{scope:"unknown"}),
   {cpuTimeMs:5000,wallTimeMs:1}
  ])expect(parseCpuObservation(raw)).toBeNull();
 });
 test("historical WordPress private staging probe ran in ingress Worker, not DO",()=>{
  const durableSource=readFileSync("src/index-durable.ts","utf8");
  const doProbe=readFileSync("src/probes/free-do-cpu.ts","utf8");
  const ingress=durableSource.indexOf('if(path===PROBE_PATH)');
  const siteDispatch=durableSource.indexOf('const id=env.SITE_DO.idFromName');
  expect(ingress).toBeGreaterThan(0);
  expect(ingress).toBeLessThan(siteDispatch);
  expect(durableSource.slice(ingress,siteDispatch)).toContain("runNativeStagingProbe(env,scope)");
  expect(doProbe).toContain("export class MicroWPFreeCpuDO extends DurableObject");
  expect(doProbe).toContain('runNativeStagingProbe(this.env');
  expect(doProbe).toContain('env.CPU_PROBE_DO.get(');
 });
});
