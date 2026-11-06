# microWP: Real WordPress editorial with internal Worker cache and post-commit invalidation

Date: 2026-11-06. Status: **local Workerd E2E PASS; deployed WordPress staging unchanged; production NO-GO**.

## Goal

Run real WordPress PHP-WASM on Cloudflare Workers/Durable Objects with a private Service Binding to a dedicated internal Redis-like cache Worker. Keep WordPress's authoritative data in its current SQLite-backed D1 snapshot path, media in R2, and avoid all external Redis products or paid Cloudflare services. This is not static HTML export.

## Implemented behavior

1. `src/php/worker-cache-invalidation.ts` enforces an explicit mutation-method policy (POST/PUT/PATCH/DELETE). GET/HEAD/OPTIONS and configurations without both opt-in and Service Binding skip invalidation.
2. `src/index-durable.ts` clears only derived `microwp_public` keys **after** the WordPress SQLite snapshot and R2 deletion journal have successfully committed. Any cache RPC failure is reported as unavailable, not represented as successful invalidation.
3. `wrangler.wp-cache-editorial-local.jsonc` is an isolated, local-only WordPress Durable Object configuration. It uses placeholder D1 ID `00000000-0000-4000-8000-000000000007`, a separate local R2 bucket, trusted `REDIS_WORKER` binding, and explicit object-cache opt-in. It has `workers_dev:false`, no public routes and no paid CPU setting.
4. `src/probes/wp-cache-editorial-local.ts` provides fixed-value, **loopback-only** cache seed/check diagnostics and a fixed WordPress Transients API proof plugin for local E2E. These are not in the deployed WordPress Worker.
5. `scripts/wp-cache-editorial-e2e.sh` runs two independent local Workers, D1 migrations and media fixtures, real WordPress installation/login/REST updates, cache seed→hit→miss, restart preservation, media deletion and D1 journal reconciliation.
6. `scripts/wp-cache-editorial-rest.ts` covers WordPress post/category relations and site title updates, using real authenticated WordPress REST nonces.
7. `scripts/wp-cache-transients-local-e2e.ts` covers the native WordPress Transients API with an authenticated local-only PHP plugin: set/get/update, short TTL expiry, delete and persistence after restart for both ordinary and site transients.

## Actual Workerd results

| Local verification | Result |
| --- | --- |
| Real WordPress installer and administrator login with the cache enabled | PASS |
| REST publish/edit post, create/rename category, associate category with post | PASS |
| Update public site-title option; see updated rendered WordPress HTML | PASS |
| WordPress PNG media upload, R2 GET and delete | PASS |
| Cache seed → hit → post/category/option/media write → miss | PASS |
| Post-restart: WordPress administrator session, posts, category relations and site title | PASS |
| Post-restart: original R2 media and D1 media journal with zero pending entries | PASS |
| Native WordPress transient and site-transient cross-request persistence | PASS |
| Transient update, one-second expiration, deletion and post-restart persistence | PASS |
| Transient test route requires administrator authentication | PASS |
| Original WordPress installation with the external cache disabled | PASS |
| Production staging safety smoke | 10/10 PASS |
| Real Cloudflare Free DO CPU/memory | **NOT VERIFIED** |

All data was isolated under ignored local `.wrangler/` directories. Existing Cloudflare staging, D1/R2 remote resources, public WordPress routes, billing and account settings were not changed. The local PHP proof uses **actual WordPress**, not an HTML export or a mocked WordPress cache.

## Hybrid transient compatibility correction

The earlier drop-in only persisted `microwp_public`, but WordPress initially detected it as a universal external object cache; this redirected the WordPress Transients API to request-local `transient` and `site-transient` groups.

The new hybrid mode still uses the internal cache Worker for `microwp_public`, but ensures `wp_using_ext_object_cache(false)` is set by the pinned WordPress object-cache initializer. As a result, the normal WordPress Transients API uses **database-backed options/site-options**, which survive requests and Durable Object restarts. The pinned `wp-includes/cache.php` has one minimal in-memory, **read-only** mount-time overlay in opt-in mode, and `object-cache.php` includes the same source through `require_once` to prevent duplicate declarations. This is not an on-disk change to the original WordPress ZIP.

The official API defines TTL as an upper bound; an early eviction is permitted, but this local proof additionally verifies the expected durable DB fallback. See [hybrid Transients API parity research](2026-11-06-microwp-wordpress-transients-hybrid-parity.md).

## Limitations and release gates

- Invalidation is **best-effort**, not an atomic D1/cache transaction. If the Service Binding fails after the D1 commit, the caller may continue with an old cache entry until expiration. **Only immutable content-revision-derived keys may be cached remotely**, with short TTL and no private or session data.
- WordPress's `wp_using_ext_object_cache()` deliberately reports false for this partial, hybrid cache. WordPress plugins assuming every object-cache group is persistent need independent evaluation. The local proof covers native Transients API, not all plugins or multisite configurations.
- Core WordPress groups such as `posts`, `options`, `users`, `auth`, `transient` and `site-transient` are **not** sent to the Worker cache.
- The production WordPress native D1 `wpdb` adapter is still incomplete; the current path stores SQLite snapshots as D1-backed state. A local editorial E2E is not a real Free Cloudflare CPU or 128 MB memory benchmark.
- Test the failure/recovery of the Service Binding and plugin-specific invalidation before enabling even private WordPress staging. Never deploy the local-only proof Worker or enable paid CPU.

## Reproduction

```bash
bun run check
bun run wp-object-cache:e2e
bun run wp-cache:editorial-build      # dry-run
bun run wp-cache:editorial-e2e        # real local WordPress + Transients + D1/R2
bun run e2e:local                     # default WordPress regression
bun run staging:smoke                 # deployed staging stays locked
```

**Production status remains NO-GO.** A successful local WordPress installer or cache test must never be presented as proof that actual Free-tier Cloudflare DO CPU and memory budgets have been met.
