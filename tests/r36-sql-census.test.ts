import {describe,test,expect} from "bun:test";
import {readFileSync} from "node:fs";
import {summarizeLocalSqlCensus} from "../src/probes/wp-sql-census-policy";
import {LOCAL_SQL_CENSUS_PLUGIN} from "../src/probes/wp-sql-census-local-plugin";

const line=(shapes:Record<string,number>)=>JSON.stringify({
 version:1,total:Object.values(shapes).reduce((s,n)=>s+n,0),
 overflow:false,shapes
});
describe("R36 local-only WordPress SQL query family census",()=>{
 test("merges only categorical WordPress core shapes, never raw SQL",()=>{
  const raw=line({
   "SELECT|core:posts|WHERE+ORDER+LIMIT":3,
   "INSERT|core:posts|simple":1
  })+"\n"+line({"SELECT|core:posts|WHERE+ORDER+LIMIT":2})+"\n";
  const value=summarizeLocalSqlCensus(raw);
  expect(value.kind).toBe("local-wordpress-query-hook-census");
  expect(value.queryCount).toBe(6);
  expect(value.requestSamples).toBe(2);
  expect(value.minQueriesPerPhpRequest).toBe(2);
  expect(value.medianQueriesPerPhpRequest).toBe(3);
  expect(value.maxQueriesPerPhpRequest).toBe(4);
  expect(value.phpRequestsAbove50SqlQueries).toBe(0);
  expect(value.families).toEqual([
   {shape:"INSERT|core:posts|simple",count:1},
   {shape:"SELECT|core:posts|WHERE+ORDER+LIMIT",count:5}
  ]);
  expect(value.bootstrapQueriesObserved).toBe(false);
  expect(value.nativeWpdbD1Verified).toBe(false);
  expect(value.productionReady).toBe(false);
  expect(Object.isFrozen(value.families)).toBe(true);
 });
 test("reports per-PHP-request SQL counts over the hypothetical D1 50-query cap",()=>{
  const example=line({"SELECT|core:options|WHERE+LIMIT":51})+"\n"+
    line({"SELECT|core:posts|WHERE":1})+"\n"+
    line({"INSERT|core:posts|simple":55})+"\n";
  const data=summarizeLocalSqlCensus(example);
  expect(data.queryCount).toBe(107);
  expect(data.requestSamples).toBe(3);
  expect(data.minQueriesPerPhpRequest).toBe(1);
  expect(data.medianQueriesPerPhpRequest).toBe(51);
  expect(data.maxQueriesPerPhpRequest).toBe(55);
  expect(data.phpRequestsAbove50SqlQueries).toBe(2);
  expect(data.nativeWpdbD1Verified).toBe(false);
 });
 test("rejects SQL text, dynamic table names, invalid counts and partial samples",()=>{
  for(const data of [
   "", "not json", JSON.stringify({overflow:true}),
   line({"SELECT|wp_users|WHERE":1}),
   line({"SELECT|core:users|WHERE 'password'":1}),
   line({"SELECT|core:users|WHERE;DROP":1}),
   line({"SELECT|core:users|WHERE":0}),
   line({"SELECT|core:users|WHERE":-1}),
   line({"SELECT|core:users|WHERE":2050}),
   JSON.stringify({version:1,total:4,overflow:false,shapes:{"SELECT|core:users|WHERE":1}}),
   JSON.stringify({version:1,total:1,overflow:true,shapes:{"SELECT|core:users|WHERE":1}}),
   (line({"SELECT|core:users|WHERE":1})+"\n").repeat(260),
   "x".repeat(97000)
  ]) expect(()=>summarizeLocalSqlCensus(data)).toThrow();
 });
 test("local MU plugin has bounded, privacy-minimizing output and not WordPress core edits",()=>{
  expect(LOCAL_SQL_CENSUS_PLUGIN).toContain("add_filter('query'");
  expect(LOCAL_SQL_CENSUS_PLUGIN).toContain("register_shutdown_function");
  expect(LOCAL_SQL_CENSUS_PLUGIN).not.toContain("SAVEQUERIES");
  expect(LOCAL_SQL_CENSUS_PLUGIN).not.toContain("wp-config.php");
  expect(LOCAL_SQL_CENSUS_PLUGIN).toContain("2048");
  expect(LOCAL_SQL_CENSUS_PLUGIN).toContain("65536");
  expect(LOCAL_SQL_CENSUS_PLUGIN).toContain("JSON_INVALID_UTF8_SUBSTITUTE");
 });
 test("fixture is localhost only with distinct D1 database and no production import",()=>{
  const cfg=JSON.parse(readFileSync("wrangler.r36-sql-census-local.jsonc","utf8"));
  const stage=JSON.parse(readFileSync("wrangler.staging.jsonc","utf8"));
  expect(cfg.name).toContain("local-only");
  expect(cfg.workers_dev).toBe(false);
  expect(cfg.routes).toBeUndefined();
  expect(cfg.d1_databases[0].database_id).toBe("00000000-0000-4000-8000-000000000014");
  expect(cfg.d1_databases[0].database_id).not.toBe(stage.d1_databases[0].database_id);
  const entry=readFileSync("src/probes/wp-sql-census-local.ts","utf8");
  expect(entry).toContain('u.hostname==="127.0.0.1"');
  expect(entry).toContain('request.method==="POST"');
  for(const path of ["src/index-durable.ts","src/php/native.ts","src/php/config.ts"])
   expect(readFileSync(path,"utf8")).not.toContain("wp-sql-census-local");
 });
});
