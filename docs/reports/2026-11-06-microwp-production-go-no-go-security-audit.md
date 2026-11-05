# microWP Stage-3: production GO/NO-GO, security and architecture audit
Date: 2026-11-06 (Asia/Jakarta) | Project: microwp | Workspace: G:\project\microWP | Branch: main

## Decision: NO-GO (public WordPress / native D1 wpdb / Workers Free 10 ms)

This is independent source review plus bounded offline tests, not a remote Cloudflare invocation, live billing/account check, signed-off production pentest, or CPU/memory benchmark. **No direct D1 wpdb support and no 10 ms bootstrap success are established.** No evidence of a presently exploitable public P0 found in the inspected gate. Correctness/security blockers below are production release blockers, not verified external exploits.

## Authoritative platform budget (checked 2026-11-06)

Cloudflare's current Workers limits page (last updated 2026-10-29) states **Free: 10 ms CPU per HTTP request; Paid: default 30 seconds, configurable up to 300,000 ms (5 minutes)**, **128 MB memory per isolate including JavaScript and WebAssembly**, **Free: 50 subrequests/request; Paid: 10,000**, **100,000 requests/day Free**, **1-second Worker startup**, and an **uncompressed Worker size limit of 64 MiB** at the time of review. Wall-clock time, network wait and `performance.now()` are not interchangeable with billed/enforced CPU. CPU budget exceptions are occasionally tolerated by the platform but **cannot** be treated as a performance contract. Cloudflare documents `exceededCpu` / Error 1102 on sustained breaches. Paid CPU allocation does not increase isolate RAM.

Sources:
- https://developers.cloudflare.com/workers/platform/limits/ (last updated 2026-10-29)
- https://developers.cloudflare.com/workers/wrangler/configuration/ (CPU limits enforced on Cloudflare, not by local dev; 300000 ms maximum)
- https://developers.cloudflare.com/workers/observability/dev-tools/cpu-usage/
- https://developers.cloudflare.com/workers/runtime-apis/performance/

**Hard platform incompatibility gate:** a request that reliably consumes more than 10 ms actual Cloudflare CPU cannot meet the Free request contract without architectural change. This is not a mathematical proof that *every imaginable implementation* of WordPress cannot fit; it is a **NO-GO for the existing PHP/WASM approach until measured actual cold and warm WordPress request CPU, peak isolate memory and end-to-end behavior are within constraints**. Previous isolated WordPress installer trace reportedly terminated with `exceededCpu` after about 2.01 s wall time; it is not a new Stage-3 measurement, nor is 2.01 s proven CPU time. Offline ZIP-fastpath median improvement (~0.7 ms locally) is not a PHP execution profile or evidence of remediation.

## P0 release blockers (absence of required evidence/behavior, not confirmed exploitation)

**P0-GATE-1: Direct-D1 wpdb false positive.** `src/php/config.ts` configures `DB_ENGINE=sqlite` / `DB_PATH=/private/microwp.sqlite`; `src/php/native.ts:116-127` restores/reads SQLite bytes; `src/index-durable.ts:39-48,69-81` loads and commits **opaque D1 BLOB snapshots**. `src/storage/d1-sqlite.ts:4-7` explicitly warns that D1 is not a native WordPress driver. `src/php/d1-protocol/{protocol,worker,runtime-adapter}.ts` and `client.php` offer narrowly scoped private SELECT/INSERT primitives but no demonstrated full `wpdb` integration and no live PHP host callback binding. SQL grammar omits UPDATE, DELETE, transactions, DDL, joins, expressions, WordPress-compatible prepare/escaping, and MySQL compatibility. Passing SELECT/INSERT unit tests or a private readiness `SELECT 1` is **not** a native D1 production migration. No production readiness claim without full WordPress installer/admin/post/media/plugin transaction test suite and verified routing to D1 on every relevant query.

**P0-GATE-2: Cold WordPress bootstrap under Free CPU cap is unproven.** Active `src/php/native.ts:20-41` constructs PHP-WASM, invokes `mountWordPress`, writes config; `runNativeStagingProbe` reaches the installer. Previous repo reports `docs/reports/microwp-bootstrap-profile-and-optimization.md` and `2026-11-05-microwp-bootstrap-optimization-prototype.md` distinguish local ZIP measurements from actual PHP bootstrap and describe the earlier `exceededCpu` failure. The experimental `src/php/zip-index-fastpath.ts` is not wired into `src/php/native.ts`. **Only** a real, authorized cold/warm Cloudflare CPU trace can resolve this gate; do not run it within this task. The 128 MB budget also requires measured JS+WASM peak, including snapshots/media hydration, code cache and request bodies. Free plan cannot be rescued simply by setting `limits.cpu_ms` higher in configuration.

**P0-GATE-3: Non-destructive, verified migration proof is missing.** The existing runtime refuses to initialize a fresh D1 image if a legacy Durable Object snapshot exists without a D1 counterpart (`src/index-durable.ts:39-45`), which is correct fail-closed behavior. There is no demonstrated reversible, versioned `wpdb` data migration, consistency checkpoint, rollback across D1 and R2, or compatibility proof that all WordPress features execute against D1 query API. DO NOT silently switch the storage driver, reset the database, discard the existing snapshot or enable an incompatible new driver on production data. Keep the guard and require offline migration/replay/rollback tests and user-approved cutover.

## P1 correctness and security blockers / release gates

**P1-PUBLIC:** `src/index-durable.ts:97-154` returns public `/__microwp/health` (with `publicReady:false`), evaluates secret-gated private probe and blocks non-local hostnames *before* media/static/PHP dispatch. `src/staging-probe.ts:10-26` requires a long secret, staging flag, HTTPS POST, and exact pathname. However `storage-write-test` scope (`index-durable.ts:108-126`) **mutates D1 and deletes R2**, despite the description of read-only probes; fixed canary site ID and finally cleanup create a recovery/audit risk. Keep disabled on public production and isolate resources. Don't infer remote access from local unit tests.

**P1-TENANT:** Constant DO name `microwp:single-site:v1` (`index-durable.ts:153`), default site ID (`d1-sqlite.ts:14`) and shared `wp-content/uploads/` R2 prefix are *single-site design*. The D1 protocol's runtime adapter requires a server-owned scope (`runtime-adapter.ts:35-68`), but that does not isolate the SQLite snapshot, PHP globals, auth secret, media bucket or DO across multiple sites. Never put multiple untrusted sites behind the same instance without independent routing, D1 namespaces, R2 prefixes and secrets.

**P1-R2:** `src/media.ts:13-24` validates canonical media keys; `src/php/uploads.ts:13-42` hydrates at most 32 entries and 16 MiB, and `flushUploads:68-75` writes to R2 before the D1 snapshot commit in `index-durable.ts:69-81`. A failed snapshot can strand new R2 objects. D1 deletion journal is written atomically with the snapshot and drained before hydration (`src/storage/d1-sqlite.ts:56-121`), which protects the delete-after-commit case, not the upload-before-commit orphan case. `wp-media-references.ts:35,105-109` unconditionally returns incomplete evidence and refuses deletion authorization; maintain this fail-closed behavior until exhaustive references, thumbnails and plugin data are provable.

**P1-AVAILABILITY:** Full snapshot reassembly (up to 8 MiB), digest copy, WASM filesystem restore, media hydration (up to 16 MiB), body buffering and response allocation can simultaneously pressure 128 MB. `src/index-durable.ts:18-22,87-90` latches failed initialization/persistence per isolate, correctly favoring consistency over a fresh database, but recovery cannot be equated with availability. Validate restart policy, durability and peak memory/CPU under fault injection. Request count limits do not prove safe CPU time.

**P1-WP-COMPAT:** SQL wire supports up to 50 SELECT rows, 16 columns, bounded predicates, and INSERT. That is intentionally insufficient for generic WordPress wpdb. Prove table-prefix semantics, charset/collation, last insert ID, row counts, locks/concurrency, transaction rollback, escaping, schema migrations and SQLite↔D1 type parity in an *isolated* conformance suite before integration.

## Reproducible LOCAL gates (no remote mutations)

1. `bun test tests/stage3-platform-gates.test.ts` — immutable platform-budget contract, source-only public route lock, SQL bridge not mistaken for wpdb, site isolation, R2 key rejection, and fail-closed legacy migration assertions. Source inspection checks are structural guardrails and will require review if legitimate refactors change placement.
2. `bun run check` — TypeScript plus full unit suite.
3. Any tests that bypass the real worker router or mock D1 do **not** prove deployed Cloudflare behavior. Avoid remote-only tests in Worker D.
4. Release gates remain open until separately authorized genuine Cloudflare `cpuTime`/outcome and isolate-memory evidence, WordPress installer/admin/REST full flow, D1/DO/R2 crash replay, migration rollback, and public route validation are captured in one immutable test record.

## Scope and integrity
Worker D may create **only** this report and `tests/stage3-platform-gates.test.ts`. No shared entrypoint/config/manifest/README/AGENTS changes, no branch/worktree/commit/push/deploy, no Cloudflare interaction or billing mutation. Concurrent workers may alter the shared working tree after this snapshot; re-run the gates before any integration decision.

## Actual Worker D verification (2026-11-06)
- Scoped: bun test tests/stage3-platform-gates.test.ts -> PASS: 8 tests, 0 failed, 46 assertions.
- Full: bun run check -> FAIL at tsc --noEmit; the full test phase did not run because TypeScript compilation failed.
- Initial errors from concurrently authored files: scripts/profile-wordpress-php-bootstrap.ts:110 TS2504; src/storage/d1-native-migration-plan.ts:81 TS2366; tests/d1-wpdb-contract.test.ts:24 TS1005.
- After another check, the profiler error was no longer present; the migration planner TS2366 and wpdb contract test TS1005 remained. These files belong to other workers and were not edited.
- Git status: two Worker D files are untracked alongside other concurrent Stage-3 worker artifacts; no shared production source/config changes by Worker D.
- Full green check and real Cloudflare CPU/memory E2E remain release blockers.
