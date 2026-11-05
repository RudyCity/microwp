import { describe, expect, test } from "bun:test";
import { handleRequest } from "../src/engine";
import { cacheKey } from "../src/cache";
import type { CacheKV, Env, ExecutionCtx, PhpHandler } from "../src/types";

function fixtures() {
  const store = new Map<string,string>();
  const kv: CacheKV = {
    async get(key) { return store.get(key) ?? null; },
    async put(key, value) { store.set(key, value); }
  };
  const jobs: Promise<unknown>[] = [];
  const ctx: ExecutionCtx = {waitUntil(p) {jobs.push(p)}};
  let calls = 0;
  const php: PhpHandler = async () => {
    calls++;
    const body = "<html><body>WordPress fixture</body></html>";
    return new Response(body,{headers:{"Content-Type":"text/html; charset=utf-8","Content-Length":String(body.length)}});
  };
  return {store,kv,ctx,jobs,php,get calls(){return calls;}};
}
const url = (path = "/") => "https://example.org" + path;
describe("microWP Worker", () => {
  test("health works even without PHP runtime", async () => {
    const f=fixtures();
    const r=await handleRequest(new Request(url("/__microwp/health")),{},f.ctx,f.php);
    expect(r.status).toBe(200);
    expect((await r.json() as {edge:string}).edge).toBe("ready");
    expect(r.headers.get("Cache-Control")).toBe("no-store");
  });
  test("returns explicit 503 for WordPress with no PHP runtime", async () => {
    const f=fixtures();
    const r=await handleRequest(new Request(url("/")),{},f.ctx);
    expect(r.status).toBe(503);
    expect((await r.json() as {error:string}).error).toBe("PHP_WASM_NOT_CONFIGURED");
  });
  test("denies sensitive files and PHP uploads before dispatch", async () => {
    const f=fixtures();
    for(const p of ["/wp-config.php","/.git/config","/wp-content/uploads/evil.php","/wp-content/uploads/evil.svg"]) {
      expect((await handleRequest(new Request(url(p)),{},f.ctx,f.php)).status).toBe(404);
    }
    expect(f.calls).toBe(0);
  });
  test("serves allowlisted static assets only", async () => {
    const f=fixtures(); let assetCalls=0;
    const assets = {async fetch() {assetCalls++;return new Response("CSS",{headers:{"Content-Type":"text/css"}})}};
    const good=await handleRequest(new Request(url("/wp-content/themes/t/style.css")),{ASSETS:assets},f.ctx,f.php);
    expect(await good.text()).toBe("CSS");
    expect(assetCalls).toBe(1);
    expect((await handleRequest(new Request(url("/wp-admin/index.php")),{ASSETS:assets},f.ctx,f.php)).status).toBe(200);
    expect(assetCalls).toBe(1);
  });
  test("anonymous page caches and isolates by origin + version", async () => {
    const f=fixtures(); const env:Env={PAGE_CACHE:f.kv};
    const first=await handleRequest(new Request(url()),env,f.ctx,f.php);
    expect(first.headers.get("X-microWP-cache")).toBe("MISS");
    await Promise.all(f.jobs);
    const second=await handleRequest(new Request(url()),env,f.ctx,f.php);
    expect(second.headers.get("X-microWP-cache")).toBe("HIT");
    expect(f.calls).toBe(1);
    expect(cacheKey(new Request(url()),"v2")).not.toBe(cacheKey(new Request(url()),"v1"));
  });
  test("cookies, auth, query strings, WP REST and admin bypass cache", async () => {
    const f=fixtures();const env:Env={PAGE_CACHE:f.kv};
    const requests = [
      new Request(url("/"),{headers:{Cookie:"session=abc"}}),
      new Request(url("/"),{headers:{Authorization:"Bearer example"}}),
      new Request(url("/?preview=true")),
      new Request(url("/wp-json/wp/v2/posts")),
      new Request(url("/wp-login.php")),
      new Request(url("/wp-admin/")),
      new Request(url("/checkout"))
    ];
    for(const req of requests) {
      const res=await handleRequest(req,env,f.ctx,f.php);
      expect(res.headers.get("X-microWP-cache")).toBe("BYPASS");
    }
    expect(f.jobs.length).toBe(0);
  });
  test("does not cache private and cookie-setting HTML", async () => {
    const f=fixtures();const env:Env={PAGE_CACHE:f.kv};
    const privatePhp:PhpHandler = async () => new Response("<html>secret</html>",{headers:{"Content-Type":"text/html","Content-Length":"19","Set-Cookie":"auth=1"}});
    await handleRequest(new Request(url()),env,f.ctx,privatePhp);
    await Promise.all(f.jobs);
    expect(f.store.size).toBe(0);
  });
  test("disallows direct public media upload", async () => {
    const f=fixtures();
    const response=await handleRequest(new Request(url("/wp-content/uploads/file.jpg"),{method:"PUT",body:"test"}),{},f.ctx,f.php);
    expect(response.status).toBe(405);
    expect(f.calls).toBe(0);
  });
});
