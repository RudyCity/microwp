import {describe,expect,test} from "bun:test";
import {randomUUID} from "node:crypto";
import {
  CANARY_PROTOCOL,CPU_SAMPLES,boundedWork,parseRemoteProbeOrigin,
  validProbeId,verifyRemoteCanaryResponse,type CanaryTask
} from "../src/probes/free-do-cpu-policy";

const id=randomUUID();
const cpu:CanaryTask={mode:"cpu",loops:50000};
const php:CanaryTask={mode:"php",loops:0};
const wp:CanaryTask={mode:"wordpress",loops:0};
const stats={runtime:"php-8.4.27-wasm",mounted:true,files:1550};
function response(task:CanaryTask,requestId=id):Record<string,unknown>{
  if(task.mode==="cpu")return {protocol:CANARY_PROTOCOL,requestId,ok:true,scope:"durable-object",
    mode:"cpu",loops:task.loops,checksum:boundedWork(task.loops)};
  return {protocol:CANARY_PROTOCOL,requestId,ok:true,scope:"durable-object",
    mode:task.mode,phpVersion:"8.4.27",sqlite:true,
    installerStatus:task.mode==="wordpress"?200:null,
    installerForm:task.mode==="wordpress",stats};
}
const verified=(task:CanaryTask,raw:unknown,headerId:string|null=id,status=200)=>
  verifyRemoteCanaryResponse(task,id,status,headerId,raw);

describe("remote CPU canary invocation evidence safety",()=>{
  test("only a version-4 opaque lowercase ID can correlate two execution scopes",()=>{
    expect(validProbeId(id)).toBe(true);
    for(const value of ["","abc","A".repeat(36),"../../secret",
      "00000000-0000-0000-0000-000000000000",
      "00000000-0000-4000-0000-000000000000",
      id.toUpperCase(),null])expect(validProbeId(value)).toBe(false);
  });

  test("remote endpoint is restricted to the dedicated HTTPS canary origin",()=>{
    expect(parseRemoteProbeOrigin("https://microwp-free-do-cpu-probe.example123.workers.dev/"))
      .toBe("https://microwp-free-do-cpu-probe.example123.workers.dev");
    for(const bad of [
      undefined,"http://microwp-free-do-cpu-probe.example123.workers.dev/",
      "https://microwp-free-do-cpu-probe.example123.workers.dev.attacker.tld/",
      "https://microwp-free-do-cpu-probe.example123.workers.dev/wp-admin/",
      "https://microwp-free-do-cpu-probe.example123.workers.dev/?token=abc",
      "https://u:p@microwp-free-do-cpu-probe.example123.workers.dev/",
      "https://microwp-free-do-cpu-probe.example123.workers.dev:8443/",
      "https://another-service.example123.workers.dev/"
    ])expect(()=>parseRemoteProbeOrigin(bad)).toThrow();
  });

  test("fixed CPU samples are verified by their returned deterministic checksum",()=>{
    for(const loops of CPU_SAMPLES){
      const task:CanaryTask={mode:"cpu",loops};
      expect(verified(task,response(task))).toBe(true);
    }
    expect(verified(cpu,{...response(cpu),checksum:0})).toBe(false);
    expect(verified(cpu,{...response(cpu),loops:250000})).toBe(false);
    expect(verified(cpu,{...response(cpu),mode:"wordpress"})).toBe(false);
  });

  test("PHP-WASM and actual WordPress installer fields are required for HTTP proof",()=>{
    expect(verified(php,response(php))).toBe(true);
    expect(verified(wp,response(wp))).toBe(true);
    expect(verified(wp,{...response(wp),installerStatus:503})).toBe(false);
    expect(verified(wp,{...response(wp),installerForm:false})).toBe(false);
    expect(verified(php,{...response(php),sqlite:false})).toBe(false);
    expect(verified(php,{...response(php),phpVersion:"8.3.0"})).toBe(false);
    expect(verified(wp,{...response(wp),stats:{...stats,mounted:false}})).toBe(false);
    expect(verified(wp,{...response(wp),stats:{...stats,files:0}})).toBe(false);
  });

  test("request identity, version, scope and HTTP result fail closed",()=>{
    expect(verified(cpu,response(cpu),randomUUID())).toBe(false);
    expect(verified(cpu,{...response(cpu),requestId:randomUUID()})).toBe(false);
    expect(verified(cpu,{...response(cpu),protocol:CANARY_PROTOCOL+1})).toBe(false);
    expect(verified(cpu,{...response(cpu),scope:"ingress-worker"})).toBe(false);
    expect(verified(cpu,response(cpu),id,503)).toBe(false);
    expect(verified(cpu,response(cpu),id,302)).toBe(false);
    expect(verified(cpu,"not an object")).toBe(false);
    expect(verified(cpu,null)).toBe(false);
  });

  test("HTTP proof cannot become CPU or memory evidence",async()=>{
    const {readFileSync}=await import("node:fs");
    const source=readFileSync("scripts/free-do-cpu-remote-probe.ts","utf8");
    expect(source).toContain('cpuEvidence:"NOT_COLLECTED"');
    expect(source).toContain('memoryEvidence:"NOT_COLLECTED"');
    expect(source).toContain('redirect:"manual"');
    expect(source).toContain("MAX_RESPONSE_BYTES=8192");
    expect(source).not.toContain("limits.cpu_ms");
    expect(source).not.toContain("wrangler deploy");
    const handler=readFileSync("src/probes/free-do-cpu.ts","utf8");
    expect(handler).toContain('trace("ingress-worker","begin"');
    expect(handler).toContain('trace("sqlite-durable-object","begin"');
  });
});
