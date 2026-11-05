import {describe,expect,test} from "bun:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";

const script=readFileSync(join(import.meta.dir,"..","scripts","production-preflight.ts"),"utf8");
describe("microWP critical production attestation gates",()=>{
 test("WordPress CPU and native D1 wpdb have independent, explicit evidence flags",()=>{
   expect(script).toContain('flag("MICROWP_WORDPRESS_CPU_VERIFIED")');
   expect(script).toContain('flag("MICROWP_NATIVE_D1_WPDB_VERIFIED")');
   expect(script).toContain('flag("MICROWP_LIMITS_VERIFIED")');
   expect(script).toContain('if(blocked.length)process.exitCode=1');
 });
 test("operator cannot substitute local tests for missing WordPress CPU/D1 production evidence",()=>{
   const env={...process.env};
   for(const key of Object.keys(env)){
      if(key.startsWith("MICROWP_") || key==="WP_SECRET_KEY" || key==="WP_PUBLIC_URL")delete env[key];
   }
   const result=Bun.spawnSync([process.execPath,join(import.meta.dir,"..","scripts","production-preflight.ts")],{
      cwd:join(import.meta.dir,".."),env,stdout:"pipe",stderr:"pipe"
   });
   const out=new TextDecoder().decode(result.stdout);
   expect(result.exitCode).not.toBe(0);
   expect(out).toContain("BLOCK Real WordPress bootstrap meets configured Cloudflare CPU budget");
   expect(out).toContain("BLOCK WordPress query-level D1 wpdb conformance and migration");
 });
});
