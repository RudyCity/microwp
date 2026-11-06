import {describe,expect,test} from "bun:test";
import {summarizeR36LocalBootstrap} from "../src/probes/r36-bootstrap-wall-summary";
import type {WorkerdSample} from "../scripts/profile-wordpress-php-bootstrap";

function sample(a:number,b:number):WorkerdSample{
 return {
  kind:"local-workerd-wordpress-php-bootstrap",
  initAndFirstInstaller:{wallMs:a,cpuMs:null,rssBeforeBytes:null,rssAfterBytes:null},
  repeatedInstaller:{wallMs:b,cpuMs:null,rssBeforeBytes:null,rssAfterBytes:null},
  wasmReadyMsFromLog:45,zipReadyMsFromLog:75,configReadyMsFromLog:80,
  statusCodes:[200,200],installerForm:[true,true],
  phaseIsolation:"first request includes PHP init, MEMFS mount, wp-settings and installer; subsequent request includes wp-settings and installer; these are NOT isolated CPU values"
 };
}
describe("R36 local WordPress PHP-WASM wall-only feasibility evidence",()=>{
 test("bounded three-sample median preserves missing CPU and memory",()=>{
  const result=summarizeR36LocalBootstrap([sample(1100,700),sample(800,400),sample(1400,650)]);
  expect(result.sampleCount).toBe(3);
  expect(result.coldInstaller).toEqual({minWallMs:800,medianWallMs:1100,maxWallMs:1400});
  expect(result.warmInstaller.medianWallMs).toBe(650);
  expect(result.wasmReadyWallMs?.medianWallMs).toBe(45);
  expect(result.ingressCpuMs).toBeNull();
  expect(result.sqliteDurableObjectCpuMs).toBeNull();
  expect(result.peakIsolateMemoryBytes).toBeNull();
  expect(result.productionReady).toBe(false);
  expect(result.cpuEvidence).toBe("NOT_MEASURED");
  expect(Object.isFrozen(result)).toBe(true);
 });
 test("refuses fake CPU/RSS, failed installer and invalid samples",()=>{
  const a=sample(700,400),b=sample(850,450),c=sample(900,500);
  for(const bad of [
   {...a,initAndFirstInstaller:{...a.initAndFirstInstaller,cpuMs:42}},
   {...a,repeatedInstaller:{...a.repeatedInstaller,rssAfterBytes:128}},
   {...a,installerForm:[true,false]},
   {...a,statusCodes:[503,200]},
   {...a,initAndFirstInstaller:{...a.initAndFirstInstaller,wallMs:-5}},
  ])expect(()=>summarizeR36LocalBootstrap([bad as WorkerdSample,b,c])).toThrow();
  expect(()=>summarizeR36LocalBootstrap([a,b])).toThrow();
 });
 test("unavailable log markers stay null rather than fabricated zero",()=>{
  const s=sample(1000,500);s.configReadyMsFromLog=null;
  const data=summarizeR36LocalBootstrap([s,s,s]);
  expect(data.configReadyWallMs).toBeNull();
  expect(data.memoryEvidence).toBe("NOT_MEASURED");
 });
});
