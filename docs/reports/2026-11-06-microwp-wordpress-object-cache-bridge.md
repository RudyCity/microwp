# microWP Worker-only cache → real WordPress `wp_cache_*` bridge

Date: 2026-11-06. Status: **local opt-in implementation and tests complete; production not enabled**.

## Design decision

The existing dedicated `microwp-worker-cache` Worker and its Durable Object provide a bounded, volatile Redis-*like* key/value cache. This stage connects WordPress's actual `wp_cache_*` API (PHP 8.4.27 WASM) to that Worker over **PHP `post_message_to_js` → JavaScript → Service Binding RPC → Durable Object**.

WordPress's external cache drop-in is officially loaded from `wp-content/object-cache.php`. WordPress 7.1.4 core `wp-includes/cache.php` is kept verbatim **except for the `wp_cache_init()` object constructor**, assembled on demand from the pinned WordPress ZIP when the runtime is explicitly opted in. It remains GPL-2.0-or-later WordPress-derived code. See https://developer.wordpress.org/reference/classes/wp_object_cache/.

## Code and controls

- `src/php/worker-object-cache-dropin.ts`: opt-in PHP backend class extending the pinned `WP_Object_Cache`. Preserves core `wp_cache_*` wrappers and local request caching for all other WordPress groups. Uses Worker RPC only for `microwp_public` and **immutable revisioned cache keys** (`home:v0123456789abcdef`). A key with the same revision MUST never change its authoritative value. Complex objects are not persisted; remote `unserialize()` forbids PHP classes.
- `src/php/worker-object-cache-bridge.ts`: fixed, strongly validated PHP→JS envelope. Accepts only `get`, `set`, `add`, `del`, and `flushGroup` for `microwp_public`, with strict versioned keys, base64 value bounds, TTL up to **300 seconds**, no site field, no arbitrary SQL/PHP, and no public HTTP endpoint. Site identity is always derived from trusted runtime configuration.
- `src/php/native.ts`: mounts the drop-in **only if** `MICROWP_WORKER_CACHE_ENABLED=yes` **and** an internal `REDIS_WORKER` Service Binding exists. Registers a scoped `php.onMessage()` callback only around actual PHP execution; unregisters after the request. Default runtime and staging configuration remain unchanged.
- `src/worker-cache/rpc-lifecycle.ts`: explicitly detaches and disposes Cloudflare RPC result objects and stubs rather than relying on garbage collection. Tested for return-value correctness and cleanup.
- `src/php/worker-object-cache-local-proof.ts`, `src/probes/wp-cache-local-proof.ts`, `wrangler.wp-cache-local-proof.jsonc`: **local-only**, loopback-restricted proof. This is not a deployable WordPress production endpoint or an API for arbitrary PHP code.
- `scripts/wp-object-cache-local-e2e.ts`: starts two separate Wrangler/Workerd Workers, validates Service Binding, and runs real WordPress/PHP inside a local SQLite-backed Durable Object. It verifies cache persists across distinct PHP invocations, `wp_cache_flush_group()` invalidates it, the real WordPress installer returns HTTP 200, and the public `wp-admin` route remains 404.

## Verified outcomes

| Gate | Observed evidence |
| --- | --- |
| Pinned WordPress cache API assembled and instantiated | `phpDropin:true` |
| Service Binding RPC cache hit in a later PHP request | `crossRequest:true` |
| Explicit group invalidation | `invalidated:true` |
| Real WordPress 7.1.4 installer with drop-in | `wordpressInstaller:true`, HTTP 200 |
| No public WordPress admin route in proof | HTTP 404 |
| Cache worker-only RPC | Existing two-Worker local E2E passed |
| Default Cloudflare staging opt-in | Disabled, no `REDIS_WORKER` binding |
| Actual production PHP `wp_cache_*` latency improvement | Not measured or claimed |
| Real Cloudflare Free DO CPU+RAM | Not proven; production **NO-GO** |

## Significant correctness caveats

- **Not a general Redis Object Cache plugin replacement.** `wp_cache_*` is compatible locally because the pinned WordPress class/API remains intact. Only the explicitly named `microwp_public` group has remote persistence; user-specific, auth and other core groups remain in the PHP request cache.
- WordPress treats the presence of an external object-cache drop-in as a persistent object cache; this affects **Transients API** behavior. An expiring transient may disappear earlier than its TTL or become request-local if its group is not remote. This must be studied with full WordPress installation/login/post/edit/REST/plugin compatibility tests before enabling for any real site.
- When remote writes or invalidation fail, the PHP class falls back to local request cache and does not stop WordPress rendering. Therefore remote entries **must be immutable and versioned**, and callers must derive the revision from authoritative content data, not merely a mutable string. Short TTL reduces but does not eliminate unsafe stale content if callers reuse an old key.
- `wp_cache_incr/decr` are only request-local in the opt-in group, with best-effort remote deletion. There is **no** claim of atomic distributed WordPress counters.
- The Worker-only cache may be evicted, and every cache miss must be reconstructible from D1 or authoritative WordPress data. Do not store secrets, sessions, serialized objects, drafts, private posts or uncommitted data in it.
- The isolated proof exercises WordPress installer and cache API but does **not** yet prove installed WordPress editorial workflows with the new drop-in. The ordinary pinned WordPress E2E remains run separately with the default cache disabled.
- This does **not** itself fix `exceededCpu` at Cloudflare Free, nor replace the not-yet-finished D1 native `wpdb` driver.
- The local proof Worker has no public deployment target; never deploy it. The dedicated cache Worker is already deployed independently with no public URL, and the live WordPress staging remains locked.

## Commands

```bash
bun run check
bun run wp-object-cache:build    # dry-run, never deploy
bun run wp-object-cache:e2e      # local real WordPress + Service Binding proof
bun run worker-cache:e2e         # preexisting Worker cache E2E
bun run e2e:local                # existing WordPress installer/login/editorial E2E, cache disabled
```

Only after a later, independent WordPress editorial E2E with the cache enabled, robust invalidation, security audit, and live Cloudflare Free CPU/memory verification should staging's Service Binding/opt-in flag be considered. The next workstream is end-to-end cache invalidation for posts/terms/options with safe, nonprivate groups and an explicit rollback plan.

**No paid services, account changes, D1/R2 mutations, public route activation or production cache enablement belong to this stage.**
