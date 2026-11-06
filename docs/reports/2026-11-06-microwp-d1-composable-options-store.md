# microWP: private composable WordPress options store on D1

Date: 2026-11-06
Scope: **local-only direct-D1 research, not a production WordPress wpdb driver**
Branch: main, single existing checkout

## Goal and result

Connect the previously independent private one-SELECT autoload reader and site-scoped option UPSERT/DELETE proofs behind one host-owned, opt-in D1 options-store API. Preserve real server-side WordPress PHP-WASM on Cloudflare Workers / SQLite-backed Durable Objects as the product objective. Do **not** replace WordPress with static HTML or client-side Playground; do not enable experimental direct-D1 option code in the deployed WordPress runtime until full SQL dialect, transactions and migration parity pass.

The new module is `src/php/d1-wpdb-conformance/options-store.ts`. Its complete, deliberately narrow API is:
- `get(name,readCapability)`: one prepared D1 SELECT with fixed trusted site equality and a two-row duplicate witness. Distinguishes missing option from a present empty string. SQL projects oversized or non-text values to NULL and refuses malformed result shapes.
- `all(readCapability)`: the pinned WordPress 7.1.4 autoload query, one prepared D1 SELECT through the existing bounded options-single reader, returning only fully validated and immutable null-prototype options maps. Refuses 501+ options or overlarge text, never returns a truncated WordPress alloptions map.
- `put(name,value,autoload,putCapability)`: one prepared D1 UPSERT through the existing options-mutation helper. Requires a real composite UNIQUE(site_column, option_name) index; names and values remain bounded.
- `delete(name,deleteCapability)`: two prepared SQL operations in an atomic D1 batch with a duplicate-check guard, refusing ambiguous duplicate rows and never deleting across the site scope.

Read, put and delete require **three distinct opaque host-owned capability objects**, validated by reference identity. The trusted table and site identity are validated and copied on creation, so later mutation of the caller's configuration does not redirect D1 reads or writes. No SQL text, database ID, table, site ID or capability is accepted from PHP or HTTP. Only the trusted private host can construct this store, and it is not mounted in WordPress.

The module accounts for at most 50 D1 queries **per store instance**: GET/ALL/PUT cost one each; DELETE costs two. The budget is consumed before D1 execution (including failed attempts) and excess operations fail without preparing SQL. This is a local sub-budget, **not a full per-invocation Cloudflare accounting instrument**: other D1 calls, subrequests, daily quotas, R2 traffic and the outer Worker need independent release gating. The host must instantiate the store only inside a single invocation; it is not an inter-request cache.

## Real Workerd verification

The existing isolated, localhost-only `src/probes/d1-option-mutation-local.ts` and `scripts/d1-option-mutation-local-e2e.ts` now exercise the store using **real local Cloudflare D1 bindings** (dummy UUID ending in 0013) in addition to the earlier typed write proof.

The local E2E confirms:
- Anonymous GET is still denied and caller-supplied SQL remains unavailable.
- Site B contains an option named `shared`; a site-A read returns **missing**, with no site-B autoload leak.
- Incorrect read capability fails before any D1 query.
- 49 scoped GETs followed by an attempted two-query DELETE are refused by the remaining-one-query budget; the 50th GET succeeds and the 51st fails.
- Private store PUT, GET and ALL agree on the committed value, with fresh reads (no stale cache). The existing direct-write proof then updates it.
- After stopping and restarting **only the local Workerd child**, the site-A option remains visible via GET and ALL.
- Scoped store DELETE removes only site A, subsequent direct DELETE is an idempotent no-op, and site B stays unchanged.

An isolated new `tests/d1-wpdb-option-store.test.ts` verifies read/write composition, empty versus missing, WordPress autoload flags, mutation-proof capabilities and immutable scope, duplicate/oversized/malformed results, actual SQLite values above 2 KiB and 501 autoload options, strict 50-query store sub-budget, and that production entrypoints and the PHP `db.php` proof never import the module.

## Evidence and commands

- `bun test tests/d1-wpdb-option-store.test.ts tests/d1-wpdb-options-mutation.test.ts tests/d1-wpdb-option-mutation-config.test.ts` — **22 PASS, 0 FAIL, 131 assertions**.
- `bun run typecheck` — **PASS**.
- `bun run d1:option-mutation-e2e` — **PASS** for real localhost Workerd D1, including update, read, query-limit, restart, and site isolation.
- `bun run check` — **305 PASS, 0 FAIL, 2453 assertions**, including TypeScript.
- `bun run durable:build` and `bun run staging:build` — **PASS**, both `wrangler deploy --dry-run`; existing generated PHP-WASM direct-eval/duplicate-key bundler warnings remain.
- `bun run e2e:local` — **PASS**: real WordPress 7.1.4 PHP-WASM install, login, post publishing/updating, REST auth, R2 media upload/download/delete, restart persistence and media journal completion.
- `bun run d1:absence-e2e` — **PASS**: loss of the D1 manifest for an already-installed WordPress site fails closed with HTTP 503, never a new installer.
- `bun run canary:e2e` — **PASS** for local PHP-WASM/WordPress inside SQLite-backed DO. Reported client wall time does not measure Cloudflare CPU.
- `bun run production:preflight` — **expected FAIL-CLOSED, 2/14 gates passed**, with true production CPU/memory, native wpdb and remote backups still blocked.

## Remaining high-priority production blockers

1. Authentic WordPress still uses pinned SQLite Integration 3.1.3 inside PHP-WASM and D1 snapshot storage. This store uses an isolated `site_id` fixture schema; it is **not the WordPress core schema**, and does not yet implement full `wpdb`, WordPress `add_option/update_option` semantics, arbitrary plugin SQL, INSERT/UPDATE/DELETE across all tables, joins, DDL, MySQL-compatible collations or lossless reversible migration.
2. The private Cloudflare Free CPU canary still lacks independently authenticated remote ingress/SQLite DO `cpuTime`, outcome and reliable 128-MiB peak isolate memory evidence. Local Workerd wall time is not CPU.
3. Production needs a backup/restore rehearsal, D1/R2 consistency, query/subrequest/daily-quota measurements and operator-approved domain/secret deployment. NO public route, production deployment, paid-plan changes, live D1 mutations, or secret writes are permitted by this experimental module.

**Release decision: NO-GO.** All new code, tests and documentation are in English. This proof is for native D1 research, not static export or production WordPress.
