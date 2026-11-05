# Changelog

All notable user-visible changes to microWP are documented here.

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
