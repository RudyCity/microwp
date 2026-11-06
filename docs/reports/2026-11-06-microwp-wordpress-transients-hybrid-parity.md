# Hybrid WordPress object cache: database-backed Transients API parity

Date: 2026-11-06. **Implementation: opt-in and local-only verification. Production: NO-GO.**

## Scope and rationale

microWP must run **real WordPress PHP-WASM inside Cloudflare Workers / Durable Objects on the Free plan**, not export WordPress to static HTML. The dedicated internal Redis-like Worker cache persists only the explicit `microwp_public` group via an internal Service Binding. It does **not** implement a general WordPress persistent object cache.

WordPress's `wp_start_object_cache()` treats the presence of `wp-content/object-cache.php` as external persistence, setting `wp_using_ext_object_cache(true)`. The WordPress Transients API then routes `set_transient()` and `get_transient()` through the `transient` object-cache group, and site transients through `site-transient`. Because only `microwp_public` had cross-request storage, those default groups were request-local. This mismatch made transient storage unreliable for realistic plugin workflows.

Official WordPress references:
- https://developer.wordpress.org/reference/functions/wp_start_object_cache/
- https://developer.wordpress.org/reference/functions/set_transient/
- https://developer.wordpress.org/reference/functions/get_transient/
- https://developer.wordpress.org/apis/transients/
- https://developer.wordpress.org/advanced-administration/wordpress/wp-config/

## Implemented hybrid model

```text
Real WordPress 7.1.4 + PHP-WASM
  +-- wp_cache_* in microwp_public (immutable, versioned keys)
  |     -> private PHP->JS bridge -> Worker Service Binding -> cache DO
  |
  +-- other WordPress wp_cache_* groups
  |     -> request-local WordPress object cache
  |
  +-- set/get/delete_transient and site_transient
        -> native WordPress options/site-options database path
        -> authoritative SQLite image stored in D1
```

- `src/php/worker-object-cache-dropin.ts` constructs two files from the **pinned** official WordPress `wp-includes/cache.php`: a cache-core overlay with only the `WP_Object_Cache` initializer replaced with `MicroWP_Worker_Object_Cache` plus an explicit `wp_using_ext_object_cache(false)` call, and an `object-cache.php` drop-in that uses `require_once` to load the **same cache-core file**. Setting that flag to false is deliberate: the runtime does not provide universal persistent object-cache semantics.
- `src/php/native.ts` extracts the pinned cache-core source from the verified WordPress ZIP only if `MICROWP_WORKER_CACHE_ENABLED=yes` and a trusted `REDIS_WORKER` binding both exist. The original WordPress ZIP is unchanged; no source files are modified on disk.
- `src/php/zip-files.ts` installs the *single* vetted cache-core overlay read-only during initial filesystem mount. Every other WordPress source stays immutable and lazy-loaded. The core file is **not writable** to runtime PHP or plugins. A repeated WordPress cache initialization can safely `require_once` the shared patched cache-core source.
- Default WordPress without the cache flag keeps the official, untouched core source and normal database transient behavior.

This is an *opt-in* compatibility mechanism for the pinned WordPress build, not a guarantee for all future WordPress versions or plugins. Any core change must pass the fail-closed initializer check before the overlay is applied.

## Real local Workerd test evidence

A dedicated **loopback-only** WordPress Durable Object test subclass injects a fixed must-use PHP plugin *after* the base DO has restored its persisted WordPress auth secret and D1 image. The plugin registers an administrator-only REST test route with a fixed command/value whitelist. No test-plugin PHP is included in the pinned ZIP, the staging Worker, or the public route configuration.

`scripts/wp-cache-transients-local-e2e.ts` tests both ordinary transient and site transient operations through authenticated WordPress REST calls with fresh nonces:

| Test condition | Result |
| --- | --- |
| Unauthorized transient test request | Rejected with 401/403 (new security regression) |
| Set ordinary transient to a nested PHP array and site transient to a string | PASS |
| Read values from a subsequent independent PHP/WordPress request | PASS |
| Update both and read updated values from subsequent requests | PASS |
| One-second TTL, then read after 3 seconds | Both absent, PASS |
| Create 300-second TTL values; run editorial REST and restart WordPress Worker | Both survive restart, PASS |
| Delete both via real WordPress API | PASS |
| Read after deletion | Both absent, PASS |
| WordPress installer, login, post/category/site-title edits, R2 upload/delete | PASS |
| Cache `microwp_public` hit and invalidation after D1/R2 commit | PASS |
| Original WordPress without the object-cache drop-in | PASS |
| Cloudflare staging route lockdown | 10/10 PASS |

Use 300-second TTL fixtures for restart persistence because the full editorial test lasts longer than 20 seconds; the separate expiration test always uses one second. This avoids conflating natural TTL expiry with failed persistence. Test data and credentials stay under the ignored `.wrangler/` directory.

### Reproduce

```bash
bun run check
bun run wp-object-cache:e2e
bun run wp-cache:editorial-build  # dry-run only
bun run wp-cache:editorial-e2e    # WordPress + Transients + D1/R2 + cache
bun run e2e:local                 # default WordPress regression
```

The GitHub CI WordPress editorial E2E stage includes transient tests automatically; no new public deployment was performed.

## Remaining limitations

1. **Cache is not universally persistent:** WordPress's `wp_using_ext_object_cache()` deliberately reports false. This preserves native DB transient behavior while the special `microwp_public` group still uses the internal Worker cache. Third-party plugins that assume `wp_using_ext_object_cache(true)` must be audited individually.
2. **No transaction spanning D1 and the cache Worker:** on Service Binding failure after D1 commit, public cache invalidation can fail and remains best-effort. Keys must be immutable, content-revision-derived, short-lived and forbidden for auth/user-private data.
3. **Native D1 `wpdb` remains incomplete:** the current production storage path still persists SQLite snapshots into D1 rather than executing WordPress queries natively in D1.
4. **No proof of Cloudflare Free CPU/memory fitness:** real CPU/memory observations from a private Free Durable Object are still missing. Success in local Workerd proves correctness only.
5. **Broader plugin compatibility:** more transient payload types, nonstandard plugin hooks, multisite, and concurrent editors are not yet fully covered.

**Deployment policy:** do not enable this hybrid mode in the deployed WordPress staging until an explicit go/no-go review. Do not deploy local-only transient proof Worker, change billing or expose WordPress admin. Production remains **NO-GO**.
