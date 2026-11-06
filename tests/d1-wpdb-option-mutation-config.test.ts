import {describe,expect,test} from "bun:test";
import {readFileSync} from "node:fs";
describe("isolated real Workerd D1 WordPress option mutation fixtures",()=>{
  test("fixture is local-only, distinct from staging, and has no route",()=>{
    const cfg=JSON.parse(readFileSync("wrangler.d1-option-mutation-local.jsonc","utf8"));
    const staging=JSON.parse(readFileSync("wrangler.staging.jsonc","utf8"));
    expect(cfg.name).toContain("local-only");
    expect(cfg.workers_dev).toBe(false);
    expect(cfg.routes).toBeUndefined();
    expect(cfg.d1_databases[0].database_id).toBe("00000000-0000-4000-8000-000000000013");
    expect(cfg.d1_databases[0].database_id).not.toBe(staging.d1_databases[0].database_id);
  });
  test("no public GET, caller SQL or runtime installation",()=>{
    const code=readFileSync("src/probes/d1-option-mutation-local.ts","utf8");
    expect(code).toContain('url.hostname!=="127.0.0.1"');
    expect(code).toContain('request.method!=="POST"');
    expect(code).not.toContain("MICROWP_STAGING_URL");
    expect(readFileSync("src/index-durable.ts","utf8")).not.toContain("d1-option-mutation-local");
  });
});
