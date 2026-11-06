import {describe,expect,test} from "bun:test";
import {readFileSync} from "node:fs";
describe("isolated real D1 atomic autoload proof configuration",()=>{
 test("real D1 proof has no public route, separate local-only database",()=>{
  const config=JSON.parse(readFileSync("wrangler.d1-atomic-autoload-local.jsonc","utf8"));
  const staging=JSON.parse(readFileSync("wrangler.staging.jsonc","utf8"));
  expect(config.workers_dev).toBe(false);
  expect(config.routes).toBeUndefined();
  expect(config.name).toContain("local-only");
  expect(config.main).toBe("src/probes/d1-atomic-autoload-local.ts");
  expect(config.d1_databases[0].database_id).toBe("00000000-0000-4000-8000-000000000011");
  expect(config.d1_databases[0].database_id).not.toBe(staging.d1_databases[0].database_id);
 });
 test("only localhost may call test routes, never production",()=>{
  const source=readFileSync("src/probes/d1-atomic-autoload-local.ts","utf8");
  expect(source).toContain('url.hostname!=="127.0.0.1"');
  expect(source).toContain('request.method!=="POST"');
  expect(source).not.toContain("MICROWP_STAGING_URL");
  const staging=readFileSync("src/index-durable.ts","utf8");
  expect(staging).not.toContain("d1-atomic-autoload-local");
 });
});
