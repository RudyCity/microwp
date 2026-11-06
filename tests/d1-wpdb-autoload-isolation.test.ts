import {describe,expect,test} from "bun:test";
import {readFileSync} from "node:fs";
const source=(path:string)=>readFileSync(path,"utf8");

describe("autoload D1 query translator is experimental and not deployed",()=>{
 test("real WordPress runtime and staging do not import the translator",()=>{
  const native=source("src/php/native.ts");
  const worker=source("src/index-durable.ts");
  const staging=JSON.parse(source("wrangler.staging.jsonc"));
  expect(native).not.toContain("d1-wpdb-conformance/options-autoload");
  expect(worker).not.toContain("d1-wpdb-conformance/options-autoload");
  expect(staging.main).not.toContain("options-autoload");
  expect(staging.vars?.MICROWP_NATIVE_D1_WPDB_ENABLED).not.toBe("yes");
 });
 test("WordPress native D1 PHP database drop-in remains uninstalled",()=>{
  const php=source("src/php/d1-wpdb/db.php");
  expect(php).toContain("MICRO_WP_D1_READONLY_PROOF");
  expect(source("src/php/d1-wpdb-conformance/options-autoload.ts"))
   .toContain("NOT an installed wpdb adapter");
 });
});
