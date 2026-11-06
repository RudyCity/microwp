import {describe,expect,test} from "bun:test";
import {
  correlateFreeDoCanary,EXPECTED_CANARY_TASKS
} from "../src/probes/free-do-canary-correlation";

const id=(i:number)=>"123e4567-e89b-42d3-a456-"+String(100000000000+i);
const origin="https://microwp-free-do-cpu-probe.example.workers.dev";
function fixture(){
  const remote={endpoint:origin,results:EXPECTED_CANARY_TASKS.map((task,i)=>({
    task,requestId:id(i),httpStatus:200,httpVerified:true,clientWallMs:50000
  }))};
  const platform=EXPECTED_CANARY_TASKS.flatMap((task,i)=>(
    ["ingress-worker","sqlite-durable-object"] as const).map(scope=>({
      requestId:id(i),scope,mode:task.startsWith("cpu:")?"cpu":task,
      outcome:"ok",cpuTimeMs:scope==="ingress-worker"?5:1500,
      memoryBytes:35*1024*1024,deploymentId:"canary-v1"
    })));
  return {remote,platform};
}
describe("offline Free DO seven-task CPU evidence correlation (diagnostics only)",()=>{
  test("seven complete independent ingress/DO pairs never become production-ready",()=>{
    const f=fixture(), result=correlateFreeDoCanary(f.remote,f.platform);
    expect(result.status).toBe("DIAGNOSTIC_ONLY_PROVENANCE_NOT_AUTHENTICATED");
    expect(result.productionReady).toBe(false);
    expect(result.completePairs).toBe(7);
    expect(result.verifiedHttp).toBe(7);
    expect(result.allCpuWithinBudget).toBe(true);
    expect(result.memoryAllMeasured).toBe(true);
    expect(result.memoryWithinLimit).toBe(true);
    expect(result.tasks).toHaveLength(7);
    expect(result.tasks[6].task).toBe("wordpress");
    expect(result.tasks[6].ingress.cpuBudgetMs).toBe(10);
    expect(result.tasks[6].durableObject.cpuBudgetMs).toBe(30000);
  });
  test("missing DO invocation, outcome or CPU measurement cannot be a full CPU pass",()=>{
    const f=fixture();
    f.platform=f.platform.filter(x=>!(x.scope==="sqlite-durable-object"&&x.requestId===id(6)));
    let result=correlateFreeDoCanary(f.remote,f.platform);
    expect(result.completePairs).toBe(6);
    expect(result.allCpuWithinBudget).toBe(false);
    expect(result.tasks[6].durableObject.cpuStatus).toBe("unverified");
    f.platform.push({requestId:id(6),scope:"sqlite-durable-object",mode:"wordpress",
      outcome:"ok",cpuTimeMs:null as unknown as number,
      memoryBytes:null as unknown as number,deploymentId:"canary-v1"});
    result=correlateFreeDoCanary(f.remote,f.platform);
    expect(result.completePairs).toBe(7);
    expect(result.tasks[6].durableObject.cpuStatus).toBe("unverified");
    expect(result.tasks[6].durableObject.memoryStatus).toBe("not-measured");
    expect(result.allCpuWithinBudget).toBe(false);
    expect(result.memoryAllMeasured).toBe(false);
  });
  test("a client wall-clock value is not substituted for missing Cloudflare CPU",()=>{
    const f=fixture();
    f.platform=f.platform.map(x=>({...x,cpuTimeMs:null as unknown as number}));
    const result=correlateFreeDoCanary(f.remote,f.platform);
    expect(result.completePairs).toBe(7);
    expect(result.verifiedHttp).toBe(7);
    expect(result.allCpuWithinBudget).toBe(false);
    expect(result.tasks.every(t=>t.ingress.cpuTimeMs===null&&
      t.durableObject.cpuTimeMs===null)).toBe(true);
  });
  test("over-budget CPU and memory are reported but never certified",()=>{
    const f=fixture();
    f.platform[0].cpuTimeMs=35;
    f.platform[1].memoryBytes=130*1024*1024;
    const result=correlateFreeDoCanary(f.remote,f.platform);
    expect(result.allCpuWithinBudget).toBe(false);
    expect(result.tasks[0].ingress.cpuStatus).toBe("over-budget");
    expect(result.tasks[0].durableObject.memoryStatus).toBe("over-limit");
    expect(result.memoryWithinLimit).toBe(false);
    expect(result.productionReady).toBe(false);
  });
  test("failed execution cannot be reported as an OK CPU invocation",()=>{
    const f=fixture();
    f.platform[1].outcome="exceededCpu";
    f.platform[1].cpuTimeMs=1000;
    const result=correlateFreeDoCanary(f.remote,f.platform);
    expect(result.tasks[0].durableObject.cpuStatus).toBe("over-budget");
    expect(result.productionReady).toBe(false);
  });
  test("unknown/duplicate/mismatched identities or arbitrary modes fail closed",()=>{
    const f=fixture();
    for(const mutated of [
      [...f.platform,f.platform[0]],
      [...f.platform.slice(0,1),{...f.platform[1],requestId:id(99)},...f.platform.slice(2)],
      [{...f.platform[0],mode:"wordpress"},...f.platform.slice(1)],
      [{...f.platform[0],scope:"container"},...f.platform.slice(1)],
      [{...f.platform[0],deploymentId:"../../bad"},...f.platform.slice(1)],
      [{...f.platform[0],cpuTimeMs:-2},...f.platform.slice(1)],
      [{...f.platform[0],memoryBytes:Infinity},...f.platform.slice(1)]
    ]){
      expect(()=>correlateFreeDoCanary(f.remote,mutated)).toThrow();
    }
  });
  test("HTTP canary fixtures must have exactly seven correctly ordered unique ids",()=>{
    const f=fixture();
    for(const remote of [
      {...f.remote,endpoint:"http://evil.invalid"},
      {...f.remote,results:f.remote.results.map((r,i)=>i===0?{...r,httpStatus:503}:r)},
      {...f.remote,results:f.remote.results.slice(1)},
      {...f.remote,results:f.remote.results.map((r,i)=>i===0?{...r,task:"sql"}:r)},
      {...f.remote,results:f.remote.results.map((r,i)=>i===1?{...r,requestId:id(0)}:r)},
      {...f.remote,results:f.remote.results.map((r,i)=>i===0?{...r,requestId:"not-a-v4-uuid"}:r)},
      {...f.remote,results:f.remote.results.map((r,i)=>i===0?{...r,authToken:"secret"}:r)}
    ]){
      expect(()=>correlateFreeDoCanary(remote,f.platform)).toThrow();
    }
  });
  test("HTTP error is allowed as diagnostic but cannot claim HTTP verification",()=>{
    const f=fixture();
    f.remote.results[6]={...f.remote.results[6],httpStatus:503,httpVerified:false};
    const result=correlateFreeDoCanary(f.remote,f.platform);
    expect(result.verifiedHttp).toBe(6);
    expect(result.productionReady).toBe(false);
  });
});
