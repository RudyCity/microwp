# microWP Worker-only Redis-like cache — 2026-11-06

## Implemented architecture (no external Redis)

The user requested a Redis-style cache **specifically inside Cloudflare Workers**, without Upstash or any externally hosted Redis. This implementation provides a **small subset** of Redis-like cache operations; it is **not** Redis itself and does not implement TCP/RESP, pub/sub, Lua scripts, streams, persistence or Redis client compatibility.

```text
WordPress PHP-WASM (integration opt-in; NOT wired yet)
       | trusted cache client in microWP Worker
       v
Cloudflare Service Binding (RPC only, never public HTTP)
       |
Dedicated Worker: microwp-worker-cache (workers_dev=false, no routes)
       |
Durable Object namespace CACHE_DO
       | one DO ID per trusted site identity
       v
Bounded volatile cache (Map + TTL + LRU, atomic per DO)
```

The code contains:
- `src/worker-cache/index.ts`: WorkerEntrypoint RPC method `execute`, all HTTP `fetch` routes respond 404; a unique Durable Object is selected for each trusted site. No D1/R2 or API secret is needed for the internal Service Binding.
- `src/worker-cache/protocol.ts`: strict versioned command parser, limits and forbidden sensitive namespaces.
- `src/worker-cache/store.ts`: bounded cache with SET, GET, ADD, DEL, INCR, EXPIRE, TTL, FLUSH GROUP, FLUSH SITE and stats.
- `src/worker-cache/client.ts`: typed, site-bound caller. Never trust a site ID from request query/body.
- `wrangler.worker-cache.jsonc`: dedicated independent Worker (workers_dev=false, SQLite-backed DO, no paid CPU increase, no public routes).
- `wrangler.worker-cache-binding.example.jsonc`: documentation-only example for an authorized calling Worker. **Do not deploy this as a separate Wrangler config.**
- `src/worker-cache/local-test-caller.ts`, `wrangler.worker-cache-local-client.jsonc`, `scripts/worker-cache-local-e2e.ts`: **local-only test harness** proving RPC between two distinct Wrangler Workers, Durable Object state, site separation and restrictions.

### Hard limits (per Durable Object / site)

| Dimension | Limit |
| --- | --- |
| Logical cache bytes (values plus key UTF-8) | 8 MiB |
| Number of entries | 1,024 |
| Individual string value | 64 KiB |
| Key | 240 UTF-8 bytes |
| TTL | 1–86,400 seconds (default 300) |
| Atomic INCR step | 1–1,000 |
| In-memory eviction | LRU, expired entries removed |
| WordPress private groups | Auth/users/session/token/password/nonce names explicitly rejected |

The logical size is *not a measured isolate heap limit*; PHP runs in a separate Worker/DO. The cache is **volatile**: DO eviction/redeploy loses entries. This is acceptable only when WordPress/D1 remains authoritative and every cache miss can be recomputed. Do not store secrets, session cookies, login states or uncommitted writes. Cache must always fail open as a *miss* for reads when appropriate; never fail open for WordPress authorization.

### How to use (server-side caller only)

Add a Service Binding to the **trusted** WordPress Worker config after deploying the dedicated cache service:

```jsonc
"services": [
  {"binding": "REDIS_WORKER", "service": "microwp-worker-cache"}
]
```

Then, from server-owned code (not user-provided site IDs):

```ts
const cache = new WorkerRedisClient(env.REDIS_WORKER, "microwp_single_site");
await cache.set("public", "rendered:post:42", "<rendered-from-real-wordpress>", 120);
const page = await cache.get("public", "rendered:post:42");
await cache.del("public", "rendered:post:42"); // on publish/update
```

**Important:** WordPress still runs PHP-WASM inside the Durable Object on cache misses. A cached HTML response is an optional normal WordPress response cache, **not WordPress exported to static HTML**. PHP object-cache drop-in/bridge is not yet wired and requires correct invalidation for posts, terms, options, attachments and multisite. A new Worker does **not** automatically reduce an already-running PHP invocation's CPU budget.

### Evidence and tests

- Unit tests cover malformed commands, arbitrary script/SQL refusal, TTL, expired deletion, atomic increment bounds, LRU, group invalidation, site-sealed caller and cache statistics.
- Real **local** Workerd ran **two different Worker processes** with Service Binding `[connected]` and returned HTTP 200 with `separateSites:true`, `addIsAtomic:true`, `incrementAtomic:true`, `siteEmpty:true`.
- The source Worker returned 404 on its HTTP fetch route; the local test caller returned 404 outside its one loopback-only test route.
- `bun run worker-cache:build` is a **dry run**, not a deploy; the bundle is ~8.35 KiB uncompressed before helper changes.
- `bun run worker-cache:e2e` runs local dual-Worker verification without paid Cloudflare features or a remote request.

**Status:** standalone cache implemented and locally validated. Not yet integrated into live WordPress object-cache.php; does not fix `exceededCpu` without the separate real-Free Durable Object CPU evidence. No upgrade or Redis subscription required.

### Security/operational rules

1. Never assign workers.dev or public routes to this cache Worker; the Worker should remain Service Binding only.
2. Use a trusted server-defined site ID; DO per-site isolation is not an authentication system for arbitrary untrusted callers.
3. No persistent store, no replication/failover guarantees and no transactional multi-key operations. Do not place authoritative WordPress data here.
4. Production WordPress staging/current cache settings stay unchanged until an explicitly opt-in cache bridge passes full `wp_cache_*` and invalidation tests.
5. Keep the source Worker disabled to public traffic and monitor Free request/DO quotas after any future deployment.
