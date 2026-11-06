# microWP: single-query transactional WordPress autoload options proof — 2026-11-06

## Decision and scope

**Private local proof PASS; production and direct-D1 WordPress wpdb remain NO-GO.** This milestone implements an alternative to the previous eleven-SELECT D1 transactional batch for the pinned WordPress 7.1.4 autoload options query. It is a **single prepared D1 SELECT**, whose SQLite statement observes a consistent statement snapshot. No installed WordPress driver, Cloudflare deployment, production DB, public route, billing plan, or origin was changed.

The work does **not** enable arbitrary SQL or native WordPress D1 persistence. Live WordPress still executes PHP-WASM over the SQLite database image snapshot persisted to D1 and R2, with existing Free CPU/memory limitations.

## Design and threat model

- Implementation: src/php/d1-wpdb-conformance/options-single.ts.
- Accept only the exact WordPress autoload SELECT shape parsed by the pinned WordPress translator. Reject SQL suffixes, unexpected tables, unknown autoload literals and malformed host config *before* D1 is called.
- SQL text is constructed from validated *host-owned* table and site-column identifiers; all autoload values, site identity, byte caps and row limit use prepared bindings. WordPress PHP and HTTP input cannot choose site identity or raw SQL.
- One D1 prepared SELECT executes ORDER BY option_name COLLATE BINARY LIMIT 501. The 501st row proves overflow and causes rejection; a returned map cannot silently contain a subset of 501+ options under the documented D1 all() response contract.
- Require D1 success === true, an array of at most 500 results, exact projected column shapes, nonempty strictly ordered and unique option names, text values, no embedded NUL names, and byte limits. Query failures, unexpected output and duplicate option names fail closed.
- SQL-side CASE projects oversized names and values to NULL rather than materializing arbitrarily large strings across D1. Name cap 191 UTF-8 bytes, individual value cap 2,048 bytes, aggregate decoded name+value cap 256 KiB. The returned object is frozen with a null prototype.
- Unlike an eleven-statement batch, a single statement sees a consistent SQLite query snapshot and consumes **one D1 query**. WordPress/D1/R2/cache cross-resource atomicity is not established.

The maximum D1 result can be larger than the 64-KiB per-page wire limit of the earlier protocol (up to roughly 1 MiB of projected option values plus result-object overhead). The module fails closed after decoding when aggregate bytes exceed 256 KiB. This is an experimental memory/query-budget tradeoff, **not** proof of Free 128-MiB peak memory fitness or WordPress large-option compatibility. SQL statement CPU and production D1 quotas are not measured by local tests.

## Reproducible verified checks

1. bun test tests/d1-wpdb-single-autoload.test.ts tests/d1-wpdb-single-config.test.ts — **10 PASS, 0 FAIL** (59 assertions). Tests cover 0/65/500/501 rows, site isolation, repeated reads after update, invalid SQL/scope, oversized text, malformed D1 responses, duplicate names, NULL values and production isolation.
2. bun run typecheck — **PASS**.
3. bash scripts/d1-single-autoload-local-e2e.sh (or bun run d1:single-e2e) — **PASS**, executing a real **local-only** Cloudflare Workerd D1 binding with an isolated database. It verifies GET rejection, 65 site-A options without site-B leakage, a committed UPDATE visible to the next read, exact 500-option completeness, and rejection of a 501-option fixture without returning a partial map.

Additional regression checks: bun run check (**275 PASS, 0 FAIL**); bun run durable:build and bun run staging:build (**dry-run PASS**, with PHP-WASM loader bundler warnings); bun run e2e:local (**real WordPress install/login/editorial/media/restart PASS**). Production preflight intentionally fails closed with **2/14 gates passing**. These checks do not prove Cloudflare Free CPU or production memory.

The local proof Worker is src/probes/d1-single-autoload-local.ts with wrangler.d1-single-autoload-local.jsonc, workers_dev:false, no routes, and a distinct local D1 UUID. Its fixed mutate routes are **localhost test fixtures only** and must never be deployed. The test shell resets only its isolated ignored .wrangler/d1-single-autoload-state directory.

## Production blockers and next engineering steps

1. WordPress still uses the existing SQLite snapshot transport. Implement and validate a complete typed, permissioned wpdb compatibility layer (writes, transactions, schema, collations, MySQL dialect, plugin SQL) and real WordPress installation/login/edit/media flows on query-native D1. This single SELECT is a narrow test, not a database driver.
2. Verify **actual Cloudflare Free Worker ingress and SQLite-backed Durable Object invocation** CPU outcomes, cold/warm PHP-WASM execution and **128-MiB peak memory**, using the existing private canary with an operator-installed secret. Never substitute Workerd success, client wall clock or simulated CPU for Cloudflare telemetry.
3. Measure real read/write query volumes and row/memory overhead, including multiple WordPress queries per invocation and Free daily quotas. Test compatibility with sites exceeding 500 options or 2-KiB serialized option values; current behavior is explicitly fail-closed.
4. Finish reversible migration, upload-orphan journal recovery, credential/secrets controls, fault-injection rollback, R2/cache consistency and independent production preflight. Do not expose live WordPress public routes or alter billing until all gates are independently proven and the operator approves.

**Release decision: keep production disabled.**
