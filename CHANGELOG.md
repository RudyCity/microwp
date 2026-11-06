# Changelog

All notable user-visible changes to microWP are documented here.

## Unreleased — Transactional private D1 autoload options batch (2026-11-06)

- Add a private, non-installed WordPress 7.1.4 autoload read prototype that executes 11 prepared, site-scoped SELECT queries inside **one D1 `batch()` SQL transaction** rather than two independently dispatched verification passes.
- Cap the read at 500 options, 2,048 bytes per value, 256 KiB total, 64 KiB per page, and mandatory 501st-row overflow detection. Refuse incomplete or malformed pages, invalid scope/query, and oversized data; return a frozen null-prototype map.
- Verify real Cloudflare local Workerd D1 binding and transactional batch API with isolated site-A/site-B fixtures, post-commit changes, and 501-row fail-closed behavior. Add `bun run d1:atomic-e2e` to Linux CI. No production native `wpdb`, remote Cloudflare D1/R2, billing or public route changes.

## Unreleased — Bounded complete WordPress autoload reads with drift checks (2026-11-06)

- Add a private, experimental complete-read layer for the pinned WordPress `wp_load_alloptions()` query: at most 500 options, ten 50-row pages, a mandatory overflow probe on a full final page, and two verification passes.
- Refuse incomplete/modified results, duplicate or unordered option keys, invalid D1 responses, oversized option values/aggregate results and SQL outside the strictly pinned query template. Return immutable null-prototype option records to avoid prototype pollution.
- Real SQLite + private D1 runtime adapter tests cover 65/500/501 options, cross-site exclusion, edits and inserts during paging, oversized payloads, malformed envelopes and staging isolation. This is **not an atomic snapshot or installed `wpdb`**; production and remote Free CPU/memory remain NO-GO.

## Unreleased — Native D1 structured autoload options SELECT prototype (2026-11-06)

- Extend the private D1 SELECT protocol with one strictly bounded, scalar `whereIn` predicate (1–8 distinct non-null values) and prepared bindings, preserving server-owned site filtering, allowlisted identifiers, and the existing 20-binding limit.
- Add a fail-closed WordPress 7.1.4 `wp_load_alloptions()` query translator for the official autoload values, deterministic 50-row pages, and an intentionally restricted original SQL grammar. Test against the pinned WordPress source and real SQLite using site-scoped prepared statements.
- Do not install the adapter, execute remote D1 queries, enable live WordPress, or infer full `wpdb` readiness. Multi-page snapshot consistency and complete autoload fallback are outstanding.

## Unreleased — Private Free DO remote evidence hardening and D1 options conformance (2026-11-06)

- Strengthen the isolated Free CPU/PHP/WordPress Durable Object canary with per-request correlation IDs across gateway/DO, strict fixed tasks, bounded responses and no false CPU/memory claims. The new remote validator intentionally requires the matching updated canary protocol; no remote deploy or secret provisioning occurred.
- Add an experimental, non-installed single-query WordPress `get_option()` translator to the existing private, site-scoped structured D1 SELECT protocol with real SQLite binding and isolation tests. Reject all other SQL instead of allowing an unsafe fallback.
- Keep Cloudflare staging/private gates unchanged; genuine Free DO CPU/memory and full `wpdb` compatibility remain production blockers.

## Unreleased — Private cache failover, bounded D1 mutations and Free CPU audit (2026-11-06)

- Add local-only real WordPress PHP-WASM E2E that injects cache Service Binding exceptions, verifies authoritative D1 writes survive, then restarts against a recovered Worker cache and proves hit/invalidation and WordPress transients again. No deployed cache Worker was mutated.
- Extend the experimental **non-installed** D1 structured query adapter with scoped, bounded UPDATE/DELETE requiring a trusted schema unique identity predicate, independent per-operation opaque capabilities, prepared statements, and a separate destructive-operation gate. New Bun+SQLite tests cover cross-site data, malformed operations and SQL injection.
- Correct CPU attribution: the historical ~2s `exceededCpu` private staging probe ran WordPress in the ingress Worker, while SQLite-backed Durable Objects have a separately documented default 30-second request CPU allowance on Free. Add bounded operator-supplied remote CPU evidence analysis; do not claim production-ready from wall time or local Workerd.
- Keep WordPress staging disabled, code/docs English, no paid services, no public routes and no remote D1/R2 changes. Production remains NO-GO pending real DO CPU/memory, full WordPress native D1 and plugin integration gates.

## Unreleased — Hybrid WordPress object cache and Transients API parity (2026-11-06)

- Preserve native WordPress database-backed ordinary/site transient semantics while `microwp_public` remains persisted only in the private Worker cache.
- Update the pinned WordPress cache initializer with `wp_using_ext_object_cache(false)` and build a read-only core-cache overlay at PHP-WASM filesystem mount. The `object-cache.php` drop-in uses `require_once` for that single source; the official ZIP stays unchanged.
- Add a fixed, authenticated localhost-only REST test plugin and test ordinary/site transients across independent PHP requests, updates, TTL expiry, delete, and Durable Object restart. Anonymous access is denied.
- Local unit, real WordPress editorial, original no-cache WordPress and staging security tests pass. No deployment, billing changes or public WordPress routes. Production remains NO-GO until remote Free CPU/memory and native D1 `wpdb` are verified.

## Unreleased — WordPress editorial with opt-in Worker cache and post-commit invalidation (2026-11-06)

- Full real WordPress PHP-WASM D1/R2 REST editorial E2E with cache enabled: install/login, publish and update post, create/rename category and attach to post, edit blog title, upload/delete PNG, restart and verify persistence.
- Invalidate only `microwp_public` cache keys after D1 snapshot + R2 media journal commit on mutating requests; preserve other groups and report Service Binding failure without claiming success.
- Local-only diagnostic proves seed→hit→miss around WordPress REST writes, and additional unit/security gates plus CI E2E cover this behavior.
- No live WordPress configuration or billing changes. Broader plugin compatibility and actual Free Cloudflare DO CPU/memory evidence remain open production blockers.

## Unreleased — Opt-in WordPress PHP object-cache Service Binding bridge (2026-11-06)

- Build the `object-cache.php` drop-in from the pinned official WordPress core Cache API without changing the default WordPress installation.
- Add tightly scoped PHP-WASM `post_message_to_js` bridge to the existing internal cache Worker for the `microwp_public` immutable revisioned keys only; refuse arbitrary site identity, auth/user cache groups and arbitrary PHP/SQL.
- Prove real PHP-WASM WordPress installer, cache hits across PHP requests, and `wp_cache_flush_group` invalidation inside a local Durable Object plus Service Binding.
- Explicitly detach/dispose Cloudflare RPC object results and stubs; add isolated lifecycle tests and CI local E2E.
- Default staging remains unchanged, and cache is **not** enabled for public WordPress. Native transient parity now passes locally; broader plugin compatibility and actual Free CPU remain blocking.

## Unreleased — Dedicated Redis-like Worker cache (2026-11-06)

- Add a separate Redis-like cache **inside Cloudflare Workers/Durable Objects only**, with no third-party Redis, no inbound TCP endpoint and no paid-plan CPU increase.
- Strict RPC Service Binding, site-sharded cache, bounded 8 MiB/1,024 keys, TTL/LRU, atomic counters and group/site invalidation; deny arbitrary SQL/script execution and common sensitive cache namespaces.
- Add typed server-owned site client, unit tests, local dual-Worker RPC E2E and CI build/E2E gates.
- Uploaded standalone cache Worker to Cloudflare with **no public deployment targets**; the active WordPress Worker has not been wired to this binding. Cache is volatile and has not been enabled for WordPress PHP object cache. WordPress/PHP-WASM/D1/R2 remain the source of truth. No public cache route or live WordPress changes.

## Unreleased — Actual server-side WordPress inside a Free Durable Object (2026-11-06)

- Research and test the **requested full WordPress/PHP runtime**, not the abandoned static HTML alternative.
- Added a dedicated, secret-gated Worker → SQLite-backed Durable Object CPU/WordPress canary that runs fixed CPU samples, PHP 8.4.27 + PDO SQLite and the actual WordPress 7.1.4 installer **inside the Durable Object fetch invocation**.
- Local Workerd authenticated CPU/PHP/WordPress canary passed HTTP 200; unauthenticated probes and public admin route returned HTTP 404. **159 unit tests passed**.
- Added bounded local E2E and explicit remote CPU probing scripts, dry-run bundle and CI pipeline tests.
- Deployed **only** the isolated canary service on Cloudflare; no Worker CPU limit changes, D1/R2 bindings, billing upgrades, production database changes or public WordPress route. Canary remains **locked** because secret provisioning was blocked. Direct Cloudflare Free DO CPU and memory fitness are **not yet verified**.
- Keep WordPress production **NO-GO** until actual remote Free CPU/128MB evidence and complete native D1 wpdb/R2 E2E exist.

## Unreleased — Workers Free-only read-only publishing prototype (2026-11-06)

- Add separate optional entrypoint and disabled-by-default config for a **Free CPU-budget-focused** public site without PHP-WASM bootstrap per request.
- Read-only native D1 published-post index uses fixed SQL and bounded data, R2 media reads are safe-key validated and bounded, and public WordPress admin/PHP/write endpoints remain closed.
- Local-only D1 migration and R2 fixture demonstrated HTTP 200 post index and exact media-byte parity; `wp-admin` and `wp-login.php` returned 404.
- Separate local D1/R2 namespace, no new billing, no remote resources, no Cloudflare deployment or DNS changes. `free:build` performs only a dry-run.
- Missing: production-ready trusted WordPress static exporter, public revision publishing/rollback, authenticated admin backend, and actual Cloudflare 10 ms CPU confirmation. **Not production-ready.**

## [0.2.0-alpha.5] — WordPress CPU investigation and native-D1 migration proof (2026-11-06)

**Experimental Alpha — production NO-GO.**

- Introduced opt-in PHP `wpdb` `db.php` read-only SELECT protocol proof, with strict versioned envelope and fail-closed unsupported SQL. Not installed as a WordPress database driver.
- Added local-only, bounded SQLite→D1 migration planner, schema/index/sequence fidelity checks, and real installed WordPress snapshot roundtrip evidence (21 tables, 29 indexes). Never changed remote D1 or deleted the original snapshot.
- Corrected local bootstrap profiler: Wrangler/Miniflare needs Node.js (not Bun) to forward requests. Local installer HTTP 200 twice; first 3215.701ms wall, repeat 1522.496ms wall. Worker CPU/RAM remained unmeasured.
- Added independent production gates for **real Cloudflare WordPress CPU** and **direct D1 `wpdb` E2E**; neither is attested by local tests.
- Added cross-platform regression tests, audit/report and explicit deployment tradeoffs. Full local WordPress E2E and the locked public staging 10/10 safety checks pass.
- Actual Cloudflare WordPress startup `exceededCpu`, 128 MB peak-memory conformance, native D1 transaction/WordPress compatibility and reversible live cutover remain blocking. No billing or DNS change.

## Unreleased — Stage-2 four-chat Delegate integration and request hardening (2026-11-05)

- All four parallel Delegate chats remained open through completion and produced distinct files for D1 adapter, WordPress ZIP index fastpath, conservative R2 evidence extractor, and independent QA.
- Private, site-scoped **D1 runtime adapter prototype**; no public SQL route or WordPress `wpdb` cutover.
- Bounded ZIP metadata fastpath prototype and parity/benchmark report. Deliberately **not enabled** in active PHP loader; local indexing speed does not prove Cloudflare WordPress CPU budget readiness.
- Strictly incomplete/offline R2 media-reference evidence scanner; no automatic purge.
- **Security fixes:** streaming 1 MiB PHP request-body cap and stricter canonical R2 upload keys, each regression tested.
- No remote deploy, billing or DNS change. Production **NO-GO**.

## Unreleased — Delegate-orchestrated experimental modules (2026-11-05)

- Prototype strict, private, versioned SELECT/INSERT D1 SQL protocol with Worker-owned scope, parameterized SQL and 9 tests; **not a native WordPress wpdb driver**.
- Add bounded, SHA-verified local WordPress ZIP bootstrap profiler and diagnostic report; does not measure deployed Cloudflare WordPress execution.
- Add dry-run R2 orphan audit using verified D1 snapshot and exhaustive external media-reference evidence, with 13 fail-closed tests; no automatic deletion.
- Clarify D1+R2 and safe multi-chat delegation instructions in `AGENTS.md`.
- Production status unchanged: **NO-GO**, no public WordPress routes enabled.

## [0.2.0-alpha.4] — Recoverable D1 media journal and direct D1 bridge feasibility (2026-11-05)

**Experimental Alpha, production NO-GO.**

- D1 migration `0002_microwp_media_delete_journal.sql`: write validated R2 deletion journal entries atomically with SQLite snapshot chunks/manifest.
- Replay pending media deletions on Durable Object cold start *before* R2 uploads hydrate into PHP. Remove journal rows only after successful R2 deletion, with idempotent retry after crashes.
- **62 unit tests** and a full local WordPress end-to-end test PASS; the E2E now confirms no outstanding D1 media-deletion journal after a completed upload/delete workflow.
- Secret-gated Cloudflare staging checks confirmed D1 transaction + R2 journal replay (HTTP 200), three D1 schema tables, and zero remaining canary journal entries. Public safety smoke **10/10 PASS**.
- Proved a fixed, read-only, asynchronous **PHP-WASM → JS → D1 → PHP** query roundtrip on actual Cloudflare Workers (HTTP 200). Its strict handler does not accept arbitrary SQL; the native WordPress D1 driver remains future work.
- Unresolved: `exceededCpu` on full WordPress bootstrap, isolate memory/CPU budget, native D1 wpdb compatibility, upload orphan reconciliation and comprehensive crash/security validation. **NO-GO for production.**

## [0.2.0-alpha.3] — D1 durable SQLite and R2 wp-content (2026-11-05)

**Experimental Alpha, production NO-GO.**

- Cloudflare **D1** is now the authoritative durable SQLite snapshot store for WordPress when D1 mode is enabled. Atomic chunk transactions use D1 BLOB rows with SHA-256 verification. WordPress PDO still operates on a temporary SQLite image in PHP-WASM; this is a compatibility bridge, **not a native query-level D1 WordPress adapter**.
- Isolated staging D1 `microwp-alpha-staging-db` provisioned with versioned migration, and D1/R2 bindings deployed to the existing locked Worker. Private binding diagnostic: **HTTP 200 PASS**. Other D1 databases left unchanged.
- **R2 `wp-content/`** namespace: WordPress uploads stored under `wp-content/uploads/`, and trusted theme/plugin static assets served read-only from R2 with immutable bundled fallback. Executable theme/plugin PHP remains locked in the build.
- The official Twenty Twenty-Five stylesheet was uploaded to the isolated R2 staging bucket, fetched back and SHA-256 compared. Full local WordPress E2E verifies D1 persistence, authenticated media operations, restart and R2 theme asset delivery.
- **53 unit tests pass**, including D1 rollback, integrity and site-isolation tests. Public Cloudflare WordPress routes remain blocked.
- Production remains NO-GO: full WordPress bootstrap still exceeds the account's current Cloudflare CPU budget; independent memory, crash, security and backup validation is outstanding.

## [0.2.0-alpha.2] — Cloudflare runtime diagnostics and durability hardening (2026-11-05)

**Experimental Alpha, production NO-GO.**

- Deployed a narrowly scoped, secret-protected private Cloudflare diagnostic that never exposes public WordPress routes or arbitrary PHP execution.
- **Live Cloudflare PHP 8.4.27 + PDO SQLite canary PASS** (CPU 8 ms, wall time 10 ms).
- **Live Cloudflare WordPress installer bootstrap FAIL** with `exceededCpu` (CPU 2,010 ms, wall time 2,108 ms); startup CPU is a verified blocker. No paid plan or CPU-spending changes were made.
- Public staging gate and private probe non-disclosure tested with 10 security smoke checks.
- Durable Object media delete now occurs **after** the database snapshot commit, preventing a failed snapshot from deleting still-referenced R2 media.
- Added simulated DB/R2 failure tests; **45 unit tests** and full local WordPress E2E pass. True abrupt crash atomicity, remote memory, backups, and independent security remain unverified.
- Detailed observed results in `docs/reports/2026-11-05-cloudflare-private-runtime-canary.md`.

## [0.2.0-alpha.1] — Experimental Alpha (2026-11-05)

**Preview release only; NOT suitable for production WordPress sites or real user data.**

- Official WordPress 7.1.4 and SQLite Database Integration 3.1.3, pinned and hash-verified for reproducible builds.
- PHP 8.4.27 WebAssembly runs native inside local Cloudflare workerd.
- Lazy ZIP filesystem supplies WordPress PHP, theme templates, CSS and block metadata.
- One single-site Durable Object serializes requests and stores versioned, SHA256-verified SQLite snapshots.
- Durable per-site WordPress auth secret persists across normal Worker restarts.
- WordPress login, authenticated REST post create/update, REST media upload/delete, and persistence across restart have passed local end-to-end tests.
- R2 media write-through and bounded, signature-validated rehydration on isolate initialization.
- Login secrets and WordPress config are not bundled into static assets; native page cache disabled pending verified invalidation.
- 38 unit tests and a workerd E2E script; reproducible build in GitHub Actions.
- Explicit fail-closed production preflight and public staging safety gate.

### Known blockers for production

- Abrupt crash injection and atomic commit across PHP SQLite and Durable Object state not validated.
- Locked Cloudflare staging is now deployed with a dedicated R2 bucket, and eight public safety smoke checks pass. Remote PHP-WASM execution and live CPU/memory telemetry are still **unverified**.
- 8 MiB SQLite snapshot cap, 32 media objects and 16 MiB media hydration cap are experimental limits.
- Plugin compatibility, multipart upload and rich media transformations, authentication abuse testing, backup/restore drills, rate limiting and Cloudflare WAF not completed.
- External WordPress/public routes are blocked and should remain so until independent security sign-off.

GPL-2.0-or-later; third-party attribution in THIRD_PARTY_NOTICES.md.
