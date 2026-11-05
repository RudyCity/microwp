import {describe,test,expect} from "bun:test";
import {isAuthorizedProbe,PROBE_PATH} from "../src/staging-probe";
const secret="s".repeat(80),origin="https://microwp-alpha-staging.example.workers.dev";
function req(method="POST",path=PROBE_PATH,provided=secret):Request{
 return new Request(origin+path,{method,headers:{"X-MicroWP-Probe-Key":provided}});
}
describe("opt-in private Cloudflare PHP staging probe",()=>{
 test("accepts only exact staging key and host protocol",async()=>{
  const env={MICROWP_STAGING_MODE:"isolated-probe-only",STAGING_PROBE_KEY:secret};
  expect(await isAuthorizedProbe(req(),env)).toBe(true);
  expect(await isAuthorizedProbe(req("GET"),env)).toBe(false);
  expect(await isAuthorizedProbe(req("POST",PROBE_PATH+"?foo=bar"),env)).toBe(false);
  expect(await isAuthorizedProbe(req("POST",PROBE_PATH+"/other"),env)).toBe(false);
  expect(await isAuthorizedProbe(req("POST",PROBE_PATH,"x".repeat(80)),env)).toBe(false);
  expect(await isAuthorizedProbe(req("POST",PROBE_PATH,secret.slice(1)),env)).toBe(false);
  expect(await isAuthorizedProbe(new Request("http://localhost:8796"+PROBE_PATH,{method:"POST",headers:{"X-MicroWP-Probe-Key":secret}}),env)).toBe(false);
 });
 test("secret or strict staging flag absent means probe is unreachable",async()=>{
  expect(await isAuthorizedProbe(req(),{})).toBe(false);
  expect(await isAuthorizedProbe(req(),{STAGING_PROBE_KEY:secret})).toBe(false);
  expect(await isAuthorizedProbe(req(),{MICROWP_STAGING_MODE:"isolated-probe-only",STAGING_PROBE_KEY:"short"})).toBe(false);
  expect(await isAuthorizedProbe(req(),{MICROWP_STAGING_MODE:"anything-else",STAGING_PROBE_KEY:secret})).toBe(false);
 });
});
