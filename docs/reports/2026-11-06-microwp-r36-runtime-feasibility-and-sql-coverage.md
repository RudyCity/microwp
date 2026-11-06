# microWP R36: real WordPress runtime feasibility and observed SQL coverage

Date: 2026-11-06
Branch: main, original shared checkout
Decision: **LOCAL QUERY-HOOK CENSUS AND BOOTSTRAP PROFILE PASS; REMOTE FREE CPU/MEMORY AND NATIVE D1 WPDB STILL NO-GO**

## Product goal and isolation

Run authentic WordPress 7.1.4/PHP-WASM server-side within Cloudflare Workers or SQLite-backed Durable Objects on the Free tier, with D1 authoritative persistence and R2 media. Do not substitute static HTML, browser Playground, paid Workers, paid Redis or a VM. This milestone used only local Workerd, a distinct local D1 UUID ending 0014 and isolated local R2. No remote deployment, secret installation, public route or billing change occurred.

## Implemented WordPress SQL census

- src/probes/wp-sql-census-local-plugin.ts: private temporary WordPress MU-plugin that attaches to the WordPress query filter. It saves bounded **categorical SQL shapes and counts only**, not query text, literals, options, WordPress content, cookies, passwords, stack traces or client data.
- src/probes/wp-sql-census-policy.ts: validates every local record, rejecting malformed, incomplete, oversized or text-bearing values. Summarizes total SQL, per-request minimum/median/maximum, and requests above 50 SQL statements.
- src/probes/wp-sql-census-local.ts and wrangler.r36-sql-census-local.jsonc: WordPress Durable Object wrapper with explicit 127.0.0.1-only POST evidence route, no public GET. The wrapper installs the ephemeral plugin only **after** original Durable Object auth-secret and D1 snapshot initialization.
- scripts/r36-sql-census-local-e2e.sh and scripts/r36-read-sql-census.ts: local WordPress installation, login, REST article publishing/editing, media upload/delete, restart verification and fixed private evidence retrieval.
- scripts/r36-export-sql-matrix.ts: reconstructs and validates a complete **observed categorical family matrix**, never raw SQL.
- tests/r36-sql-census.test.ts: strict privacy, caps, fail-closed proof, test-only config and Free-query risk counters.

The WordPress query hook activates after MU-plugin loading. Early DB bootstrap queries, internal direct PDO operations, unvisited plugin SQL, multisite variations and unsupported schema paths are **not observed**. The SQL-feature detector is a heuristic keyword classifier, not a lossless SQL parser, and quoted literals may affect feature labels. Treat this as a sampled WordPress core query profile, not complete D1 driver coverage.

### Measured genuine local Workerd SQL workload

| Metric | Before restart | After restart | Combined |
| --- | ---: | ---: | ---: |
| Sampled PHP requests | 11 | 7 | 18 |
| WordPress logical SQL statements | 1,355 | 368 | **1,723** |
| Categorized statement families | 74 | 26 | **79 unique** |
| Minimum SQL per PHP request | 6 | 6 | — |
| Median SQL per PHP request | 46 | 32 | — |
| Maximum SQL in one PHP request | 559 | 219 | **559 peak** |
| PHP requests with more than 50 logical SQL statements | 5 | 1 | **6** |

Aggregate observed verbs: SELECT 1,549; INSERT 67; UPDATE 33; DELETE 6; DESCRIBE 48; SHOW 20. Options-table categories dominated with 1,350 counted references. The most frequent pattern was SELECT / core:options / WHERE+LIMIT (1,162 statements). Other concrete compatibility targets include INSERT / core:options / ON_DUPLICATE (28), metadata reads, and multi-table taxonomy JOIN/IN/DISTINCT statements.

The complete 79-row table appears in docs/reports/2026-11-06-microwp-r36-sql-family-matrix.md, generated from local sanitized evidence. Repeated local E2E samples varied slightly (1,723 versus 1,724 SQL statements), so exact totals are observational rather than deterministic. Every row is marked NOT VERIFIED for query-native WordPress D1 wpdb.

**Critical distinction:** These were WordPress logical SQL statements against SQLite inside PHP-WASM, **not actual Cloudflare D1 query invocations**. Translating each statement to an independent D1 call could exceed the Free 50-query/invocation cap for 6 observed requests. Cloudflare counts a single D1 batch() API call as ONE request towards the 50-query Free cap even if it executes multiple SQL statements. Verified batching, caching or alternate data execution must reduce remote D1 calls without dropping WordPress semantics.

## Three independent local Workerd bootstrap runs

scripts/r36-local-bootstrap-profile.ts launches the existing Node-driven, self-owned Workerd profiler three times in sequence. It validates two HTTP 200 responses and authentic original installer forms on every run. Output is limited to ignored .wrangler/r36-wordpress-bootstrap-local.json.

| Local client/application wall-time measurement | Minimum | Median | Maximum |
| --- | ---: | ---: | ---: |
| First installer request (PHP init + WP) | 1,598.975 ms | **1,613.587 ms** | 1,757.776 ms |
| Repeated installer request (same isolate) | 614.149 ms | **665.505 ms** | 753.737 ms |
| Cumulative WASM-ready log marker | 31 ms | 34 ms | 47 ms |
| Cumulative ZIP-ready log marker | 90 ms | 99 ms | 145 ms |
| Cumulative config-ready log marker | 91 ms | 100 ms | 146 ms |

These are **client wall and cumulative application log timings**, not independent platform CPU, not billed CPU, and not peak isolate RAM. The CPU and memory fields remain null / NOT_MEASURED, and productionReady remains false. Local E2E success does not establish Cloudflare Free compatibility.

## Verified Cloudflare platform constraints (2026-11-06)

- Workers Free ingress CPU: 10 ms/request, isolate memory: 128 MB. https://developers.cloudflare.com/workers/platform/limits/
- SQLite-backed Durable Object CPU: official documented default 30 seconds/request. The actual Free-account outcome for this workload still needs authenticated platform evidence. https://developers.cloudflare.com/durable-objects/platform/limits/
- D1 Free: 50 queries/Worker invocation, maximum 500 MB/database and 100 bind parameters/query. https://developers.cloudflare.com/d1/platform/limits/

The existing dedicated remote CPU canary still lacks legitimate operator-installed authentication and independently authenticated CPU/outcome/peak-memory evidence. No remote probe was executed in this milestone. Do not bypass security gates or claim that successful local requests prove remote Free CPU.

## Prioritized engineering backlog

1. Reduce repeated scoped options GETs with a complete, transactionally consistent read plan. Preserve WordPress autoload, defaults, serialization, mutation and cache invalidation semantics. Existing private options prototypes cap data and are not installed.
2. Build query-native D1 wpdb SQL coverage for SHOW, DESCRIBE, MySQL ON DUPLICATE KEY UPDATE, JOIN/IN/ORDER/LIMIT/DISTINCT, posts, taxonomy, metadata and users/auth before attempting plugin SQL.
3. Validate unique indexes, collations, transactions, DDL, replay safety, user-data isolation, lossless migration and rollback, and real WordPress query-native D1 install/login/editorial/media E2E.
4. Measure real D1/R2 subrequests, remote per-invocation D1 query budget and Free daily quotas. Keep D1 snapshot recovery markers, media deletion journals and encrypted backup/restore rehearsals.
5. With operator authorization and a valid canary secret, obtain authentic Cloudflare per-scope CPU/outcome telemetry and trustworthy isolate memory measurements for cold/warm WordPress, admin, REST and editorial operations.

## Reproduction, all local only

    bun run r36:sql-census-e2e
    bun run r36:sql-matrix
    bun run r36:bootstrap
    bun test tests/r36-sql-census.test.ts tests/r36-bootstrap-wall-summary.test.ts
    bun run check
    bun run durable:build
    bun run staging:build
    bun run e2e:local
    bun run production:preflight  # expected fail-closed without remote proof

All source, tests, documentation and commit messages use English. The local census Worker must NEVER be deployed on Cloudflare or run with remote/staging database bindings. Full production readiness remains **NO-GO**.
