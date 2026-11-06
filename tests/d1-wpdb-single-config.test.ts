import {describe,expect,test} from "bun:test";
import {readFileSync} from "node:fs";
describe("private single-query D1 Workerd proof deployment isolation",()=>{
  test("distinct local-only database and no routes",()=>{
    const config=JSON.parse(readFileSync("wrangler.d1-single-autoload-local.jsonc","utf8"));
    const staging=JSON.parse(readFileSync("wrangler.staging.jsonc","utf8"));
    const atomic=JSON.parse(readFileSync("wrangler.d1-atomic-autoload-local.jsonc","utf8"));
    expect(config.name).toContain("local-only");
    expect(config.workers_dev).toBe(false);
    expect(config.routes).toBeUndefined();
    expect(config.main).toBe("src/probes/d1-single-autoload-local.ts");
    expect(config.d1_databases[0].database_id).toBe("00000000-0000-4000-8000-000000000012");
    expect(config.d1_databases[0].database_id).not.toBe(staging.d1_databases[0].database_id);
    expect(config.d1_databases[0].database_id).not.toBe(atomic.d1_databases[0].database_id);
  });
  test("fixed localhost POST fixture, absent from staging source",()=>{
    const worker=readFileSync("src/probes/d1-single-autoload-local.ts","utf8");
    const durable=readFileSync("src/index-durable.ts","utf8");
    expect(worker).toContain('url.hostname!=="127.0.0.1"');
    expect(worker).toContain('request.method!=="POST"');
    expect(worker).not.toContain("MICROWP_STAGING_URL");
    expect(durable).not.toContain("d1-single-autoload-local");
  });
});
