import {describe,expect,test} from "bun:test";
import {readFileSync} from "node:fs";
import {buildWorkerObjectCacheDropin} from "../src/php/worker-object-cache-dropin";
import {indexZip,inflateEntry} from "../src/php/zip-files";
import {WORDPRESS_TRANSIENT_PROOF_PHP} from "../src/probes/wp-transients-local-plugin";

describe("hybrid WordPress object cache and DB-backed transients",()=>{
 test("builds against actual pinned WordPress cache.php, with one require_once",()=>{
  const archive=new Uint8Array(readFileSync("generated/wordpress-php.bin"));
  const entry=indexZip(archive).find(e=>e.name==="wp-includes/cache.php");
  expect(entry).toBeDefined();
  const core=new TextDecoder().decode(inflateEntry(archive,entry!));
  const hybrid=buildWorkerObjectCacheDropin(core);
  expect(hybrid.coreCachePhp).toContain("new MicroWP_Worker_Object_Cache()");
  expect(hybrid.coreCachePhp).toContain("wp_using_ext_object_cache( false )");
  expect(hybrid.coreCachePhp).not.toContain("$GLOBALS['wp_object_cache'] = new WP_Object_Cache();");
  expect(hybrid.objectCacheDropinPhp.match(/require_once ABSPATH/g)).toHaveLength(1);
  expect(hybrid.objectCacheDropinPhp).not.toContain("function wp_cache_init()");
  expect(hybrid.objectCacheDropinPhp).toContain("private const GROUP = 'microwp_public'");
 });
 test("injects only a pinned read-only WordPress cache source overlay",()=>{
  const source=readFileSync("src/php/zip-files.ts","utf8");
  const runtime=readFileSync("src/php/native.ts","utf8");
  expect(source).toContain('entry.name==="wp-includes/cache.php"&&readonlyCoreCacheOverride');
  expect(source).toContain("FS.createDataFile(dir,filename,readonlyCoreCacheOverride,true,false,false)");
  expect(runtime).toContain("hybrid?new TextEncoder().encode(hybrid.coreCachePhp):undefined");
  expect(runtime).not.toContain('php.writeFile("/www/wp-includes/cache.php"');
 });
 test("transient proof cannot be enabled on real staging",()=>{
  const local=JSON.parse(readFileSync("wrangler.wp-cache-editorial-local.jsonc","utf8"));
  const staging=JSON.parse(readFileSync("wrangler.staging.jsonc","utf8"));
  expect(local.vars.MICROWP_LOCAL_TRANSIENT_PROOF).toBe("yes");
  expect(local.workers_dev).toBe(false);
  expect(staging.vars?.MICROWP_LOCAL_TRANSIENT_PROOF).toBeUndefined();
  expect(staging.services?.some((value:{binding:string})=>value.binding==="REDIS_WORKER")).not.toBe(true);
  const localWrapper=readFileSync("src/probes/wp-cache-editorial-local.ts","utf8");
  expect(localWrapper).toContain('url.hostname==="127.0.0.1"');
  expect(localWrapper).toContain('env.MICROWP_LOCAL_TRANSIENT_PROOF==="yes"');
  expect(localWrapper.indexOf("await super.fetch(request)"))
   .toBeLessThan(localWrapper.lastIndexOf("WORDPRESS_TRANSIENT_PROOF_PHP"));
 });
 test("local-only transient REST proof checks admin permission and fixed commands",()=>{
  expect(WORDPRESS_TRANSIENT_PROOF_PHP).toContain("current_user_can( 'manage_options' )");
  expect(WORDPRESS_TRANSIENT_PROOF_PHP).toContain("set_site_transient");
  expect(WORDPRESS_TRANSIENT_PROOF_PHP).toContain("get_site_transient");
  expect(WORDPRESS_TRANSIENT_PROOF_PHP).toContain("delete_site_transient");
  expect(WORDPRESS_TRANSIENT_PROOF_PHP).toContain("get_transient");
  expect(WORDPRESS_TRANSIENT_PROOF_PHP).not.toContain("eval(");
  expect(WORDPRESS_TRANSIENT_PROOF_PHP).not.toContain("shell_exec(");
 });
});
