import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mayServePreview } from "../src/php/config";
import { safePathname, blockedPath } from "../src/security";
import { isAuthorizedProbe, PROBE_PATH } from "../src/staging-probe";
import { r2MediaKey, putMedia } from "../src/media";
import { createD1RuntimeAdapter } from "../src/php/d1-protocol/runtime-adapter";
import { normalizePendingMediaPaths } from "../src/storage/d1-sqlite";

const src = (p: string) => readFileSync(join(import.meta.dir, "..", p), "utf8");
const request = (url: string, method = "GET", headers?: HeadersInit) => new Request(url, { method, headers });
const key = "x".repeat(64);

describe("Stage-3 platform GO/NO-GO isolated guards", () => {
  test("Free CPU and per-isolate memory constraints are fixed release requirements, not measured by unit tests", () => {
    const declaredPlatformRequirements = { freeCpuMs: 10, isolateMemoryMb: 128, paidDefaultCpuMs: 30_000, paidMaxCpuMs: 300_000 };
    expect(declaredPlatformRequirements.freeCpuMs).toBe(10);
    expect(declaredPlatformRequirements.isolateMemoryMb).toBe(128);
    expect(declaredPlatformRequirements.paidDefaultCpuMs).toBeLessThanOrEqual(declaredPlatformRequirements.paidMaxCpuMs);
    // This assertion does NOT benchmark WASM, WordPress, or Cloudflare.
  });

  test("public WordPress routes stay locked; private staging probe denies absent key or HTTP", async () => {
    expect(mayServePreview(new URL("https://public.example/wp-admin/"), {})).toBe(false);
    expect(mayServePreview(new URL("https://public.example/wp-content/uploads/a.png"), {})).toBe(false);
    const env = { MICROWP_STAGING_MODE: "isolated-probe-only", STAGING_PROBE_KEY: key };
    expect(await isAuthorizedProbe(request("https://public.example" + PROBE_PATH, "POST"), env)).toBe(false);
    expect(await isAuthorizedProbe(request("http://public.example" + PROBE_PATH, "POST", { "x-microwp-probe-key": key }), env)).toBe(false);
    expect(await isAuthorizedProbe(request("https://public.example" + PROBE_PATH, "POST", { "x-microwp-probe-key": key }), env)).toBe(true);
    const router = src("src/index-durable.ts");
    expect(router).toContain('if(!isLocal(url.hostname))return Response.json({error:"PREVIEW_ONLY_NO_PRODUCTION_DEPLOY"');
    expect(router.indexOf('if(!isLocal(url.hostname))')).toBeLessThan(router.indexOf('await getMedia(request,env,path)'));
    expect(router.indexOf('if(!isLocal(url.hostname))')).toBeLessThan(router.indexOf('const id=env.SITE_DO.idFromName('));
    expect(router).toContain('publicReady:false');
  });

  test("rejects traversal, PHP/script uploads and ambiguous R2 keys", () => {
    for (const bad of ["/wp-content/uploads/../bad.png", "/wp-content/uploads/.private.png",
      "/wp-content/uploads/evil.php", "/wp-content/uploads/evil.svg",
      "/wp-content/uploads/a%2fb.png", "/wp-content/uploads/x?y.png",
      "/wp-content/uploads/trailing. /x.png", "/wp-content/uploads/x\\y.png"]) {
      expect(r2MediaKey(bad)).toBeNull();
    }
    expect(r2MediaKey("/wp-content/uploads/2026/11/safe.png")).toBe("wp-content/uploads/2026/11/safe.png");
    const decoded = safePathname(new URL("https://public.example/wp-content/uploads/%252e%252e/private.png"));
    expect(decoded === null || blockedPath(decoded)).toBe(true);
  });

  test("R2 mutation helper refuses invalid names before touching bucket", async () => {
    let calls = 0;
    const fake = { put: async () => { calls++; } };
    await expect(putMedia({ MEDIA: fake as never }, "/wp-content/uploads/../escape.png", new Uint8Array(8))).rejects.toThrow();
    expect(calls).toBe(0);
    expect(() => normalizePendingMediaPaths(["/www/wp-content/uploads/../escape.png"])).toThrow();
  });

  test("trusted D1 adapter is tenant-scoped and rejects missing scope before query", async () => {
    let calls = 0;
    const db = { prepare() { calls++; throw new Error("unreachable"); } };
    const callerKey = {};
    expect(() => createD1RuntimeAdapter({ db: db as never, callerKey, policy: { tables: { posts: { select: ["id"] } } } })).toThrow();
    const adapter = createD1RuntimeAdapter({
      db: db as never, callerKey,
      policy: { tables: { posts: { select: ["id"], scope: { column: "site_id", value: "siteA" } } } }
    });
    const payload = JSON.stringify({ version: 1, id: "q", op: "select", table: "posts", columns: ["id"], where: [{ column: "site_id", value: "siteB" }] });
    expect(JSON.parse(await adapter.dispatch(payload, callerKey)).error).toBe("NOT_ALLOWED");
    expect(JSON.parse(await adapter.dispatch(payload, {})).error).toBe("NOT_ALLOWED");
    expect(calls).toBe(0);
  });

  test("no direct-D1 wpdb false positives: current entrypoints still restore SQLite snapshots", () => {
    const native = src("src/php/native.ts");
    const durable = src("src/index-durable.ts");
    const phpConfig = src("src/php/config.ts");
    const protocol = src("src/php/d1-protocol/protocol.ts");
    const client = src("src/php/d1-protocol/client.php");
    expect(phpConfig).toContain("DB_PATH");
    expect(phpConfig).toContain("/private/microwp.sqlite");
    expect(native).toContain('mountWordPress(php,new Uint8Array(wordpressArchive))');
    expect(native).toContain('readNativeDB()');
    expect(durable).toContain("loadD1SQLite(this.env.DB)");
    expect(durable).toContain("saveD1SQLite(this.env.DB,snapshot");
    expect(protocol).toContain('op: "select"');
    expect(protocol).toContain('op: "insert"');
    expect(client).not.toMatch(/(?:extends\s+wpdb|class\s+wpdb\b)/);
    // Test is intentionally a present-state detection, not validation of future direct D1.
  });

  test("legacy DO to D1 migration refuses silent fresh DB and private probe mutations are explicit", () => {
    const durable = src("src/index-durable.ts");
    const guard = 'if(legacySnapshot&&!d1Snapshot)throw new Error("Legacy DO snapshot requires explicit verified D1 migration")';
    expect(durable).toContain(guard);
    expect(durable.indexOf(guard)).toBeLessThan(durable.indexOf("if(d1Snapshot)await restoreNativeDB"));
    expect(durable).toContain('if(scope==="storage-write-test")');
    expect(durable).toContain("await drainD1MediaDeleteJournal(env.DB,env.MEDIA,canarySite)");
    // This is a read-only review of an existing mutating canary, NOT invocation.
  });

  test("orphan deletion remains prohibited while reference extraction is not exhaustive", async () => {
    const extractor = await import("../src/storage/wp-media-references");
    const evidence = await extractor.extractWordPressMediaReferences(new Uint8Array());
    expect(evidence.complete).toBe(false);
    expect(evidence.deletionAuthorized).toBe(false);
    await expect(extractor.extractReferencesForOrphanAudit(new Uint8Array())).rejects.toThrow("Incomplete");
    expect(src("src/storage/r2-orphan-audit.ts")).toContain("deletionAuthorized:false");
  });
});
