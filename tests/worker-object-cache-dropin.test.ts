import {describe,expect,test} from "bun:test";
import {buildWorkerObjectCacheDropin,WORKER_OBJECT_CACHE_PHP} from "../src/php/worker-object-cache-dropin";
describe("opt-in WordPress object-cache drop-in",()=>{
 test("keeps pinned API, only replacing its constructor",()=>{
  const original="<?php function wp_cache_init(){ $GLOBALS['wp_object_cache'] = new WP_Object_Cache(); } function wp_cache_supports($f){return false;}";
  const assembled=buildWorkerObjectCacheDropin(original);
  expect(assembled.coreCachePhp).toContain("$GLOBALS['wp_object_cache'] = new MicroWP_Worker_Object_Cache()");
  expect(assembled.coreCachePhp).toContain("wp_using_ext_object_cache( false )");
  expect(assembled.coreCachePhp).toContain("function wp_cache_supports(");
  expect(assembled.objectCacheDropinPhp).toContain("require_once ABSPATH . WPINC . '/cache.php'");
  expect(assembled.objectCacheDropinPhp).toContain("class MicroWP_Worker_Object_Cache extends WP_Object_Cache");
  expect(assembled.objectCacheDropinPhp).toContain("post_message_to_js");
 });
 test("unknown core API structure fails closed",()=>{
  for(const input of ["", "<?php function wp_cache_init() {}",
   "<?php function wp_cache_supports($f){return false;}"])
   expect(()=>buildWorkerObjectCacheDropin(input)).toThrow();
 });
 test("remote group is explicit and complex unserialize classes are forbidden",()=>{
  expect(WORKER_OBJECT_CACHE_PHP).toContain("private const GROUP = 'microwp_public'");
  expect(WORKER_OBJECT_CACHE_PHP).toContain("'allowed_classes' => false");
  expect(WORKER_OBJECT_CACHE_PHP).toContain("function allowed_value");
 });
});
