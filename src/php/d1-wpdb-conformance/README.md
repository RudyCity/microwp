# Experimental WordPress D1 wpdb Query Conformance

This directory contains fail-closed **non-installed** compatibility research. It is not a production `wpdb` driver.

## Current implemented slice

`options-get.ts` recognizes exactly one **pre-prepare** WordPress options query template:

```sql
SELECT option_value FROM wp_options WHERE option_name = %s LIMIT 1
```

The option name must be supplied separately as a bounded typed value. The translator returns a strict D1 protocol v1 **structured SELECT request**, never raw SQL. Its input does not accept a post-`wpdb::prepare()` query containing already interpolated SQL. The host's D1 adapter still enforces the separately configured table/column whitelist and server-owned site scope.

`tests/d1-wpdb-conformance-get-option.test.ts` verifies the precise query shape, rejection of arbitrary fragments or unsupported SQL, parameter bounds, tenant/site isolation, and prepared argument binding through a real in-memory SQLite database.

## Explicit limitations

This slice intentionally does **not** support `SELECT *`, `IN` for autoloaded options, joins, ordering, WordPress's general MySQL dialect, DDL, inserts, updates, deletes, dynamic table prefixes, arbitrary placeholders, or plugin SQL. The existing experimental D1 protocol provides a separately authorized bounded UPDATE/DELETE prototype; it is not wired into WordPress's production database layer.

A proper native driver will require a query catalog from WordPress core, a safe typed placeholder parser, option autoload conformance, index and schema equivalence, transaction and retry semantics, and full real WordPress install/editorial/plugin E2E. Existing WordPress storage remains SQLite snapshots in D1. **Production NO-GO.**

## Experimental WordPress autoloaded options SELECT

`options-autoload.ts` parses only the canonical WordPress 7.1.4 `wp_load_alloptions()` SELECT query's `autoload IN ('yes','on','auto-on','auto')` values, including the permitted filter-removed subsets. The translator returns strict `SELECT whereIn` protocol requests, with prepared site scope, deterministic `option_name` ordering and fixed maximum 50 rows per page. The caller must fetch all pages before using the result; there is no guarantee of consistent snapshot or complete alloptions beyond the bounded protocol offset, and unsupported SQL must **never** fall back to unrestricted D1 query execution.

Tests: `bun test tests/d1-protocol-bounded-in.test.ts tests/d1-wpdb-autoload-conformance.test.ts`. Full report: [WordPress D1 autoload options conformance](../../../docs/reports/2026-11-06-microwp-d1-autoload-options-conformance.md). This is never mounted as a WordPress database driver.

## Bounded full-read proof (experimental)

[`options-complete.ts`](./options-complete.ts) adds a trusted in-process reader over the bounded autoload query translator. It reads ten 50-row pages plus an empty overflow probe if necessary, repeats the bounded read to detect changes, and **rejects any partial result**. It never exposes a public route or WordPress-facing database driver. The implementation caps options at 500, response size at 64 KiB per page, each serialized value at 32 KiB, and aggregate value/key bytes at 256 KiB. Rows must be strictly ordered and have correct correlation IDs; option names become keys of an immutable null-prototype record.

**Limitations:** two identical complete passes do not guarantee a consistent database snapshot when concurrent writes are possible; WordPress sites with more than 500 autoloaded entries or large serialized values are explicitly rejected. Native transaction/snapshot support, complete fallback query handling and full `wpdb` conformance remain prerequisites before any production integration. Run `bun test tests/d1-wpdb-complete-autoload.test.ts`. See [complete-read proof](../../../docs/reports/2026-11-06-microwp-d1-autoload-complete-read-proof.md).

## Atomic D1 batch proof (experimental)

`options-atomic.ts` executes 11 prepared SELECT statements in one Cloudflare D1 SQL transaction, using `D1Database.batch()`. Site identity and table are private trusted configuration. It fails closed on 501+ options, oversized/invalid rows and any batch error. This is stronger than the earlier two-pass consistency comparison; it does not install WordPress `wpdb` and does not guarantee transactionality across separate WordPress D1/R2/cache resources. The 11 SQL statements execute within ONE D1 batch() API call, which Cloudflare currently counts as ONE request toward the Free 50-query-per-invocation limit. Every statement still has its own SQL/bind/result limits and rows-read/written usage.

Run `bun run d1:atomic-e2e` for a real Workerd D1 binding test, or `bun test tests/d1-wpdb-atomic-autoload.test.ts` for isolated failure cases. See [transactional D1 autoload report](../../../docs/reports/2026-11-06-microwp-d1-atomic-autoload-batch-proof.md).


## Single-query D1 autoload read (experimental)

options-single.ts is an opt-in, non-installed alternative that executes one prepared D1 all() SELECT with a 501-row overflow witness and trusted site scope. It rejects malformed or oversized results and returns a frozen null-prototype options map for at most 500 entries. Unlike the 11-SELECT transactional batch, one SQLite statement sees a consistent statement snapshot while consuming one query; it can return a larger D1 result and **does not** establish WordPress wpdb completeness, Free CPU/memory fitness, or R2/cache atomicity. Never activate this helper in production.

Run bun run d1:single-e2e for an isolated local Workerd D1 proof or bun test tests/d1-wpdb-single-autoload.test.ts tests/d1-wpdb-single-config.test.ts. See [single-query proof report](../../../docs/reports/2026-11-06-microwp-d1-single-query-autoload-proof.md).

## Private WordPress option writes (experimental, non-installed)

[options-mutation.ts](./options-mutation.ts) adds host-owned, typed option UPSERT and guarded DELETE. It does **not** parse arbitrary WordPress PHP SQL or replace WordPress's SQLite adapter. All D1 SQL is constructed by trusted JS using prepared bindings, a private site identity and distinct opaque per-operation capabilities. The one-query UPSERT requires an actual UNIQUE(site_column, option_name) constraint and otherwise fails. DELETE executes COUNT and a count-guarded DELETE in one D1 batch transaction, refusing duplicate keys without deleting them. Inputs and D1 result sizes are bounded and failures return generic errors. A separate WordPress SQL catalog, migration, cache invalidation, transaction and full plugin integration are necessary before activation.

Run bun run d1:option-mutation-e2e for a local-only **real Cloudflare Workerd D1 binding** INSERT/UPDATE/DELETE/restart/isolation check. Test source lives in src/probes/d1-option-mutation-local.ts with its isolated D1 UUID, no public route and no authorized remote deployment. Unit checks: bun test tests/d1-wpdb-options-mutation.test.ts tests/d1-wpdb-option-mutation-config.test.ts. See [option mutation evidence](../../../docs/reports/2026-11-06-microwp-d1-option-mutation-proof.md).

**Production remains NO-GO.** This helper is not connected to live wpdb or WordPress admin, and local D1 success is not a Cloudflare Free CPU/memory benchmark.

## Composable private D1 options store (experimental)

[`options-store.ts`](./options-store.ts) composes trusted GET, fixed WordPress autoload SELECT, PUT and guarded DELETE into a single non-installed host-owned API. Three distinct opaque capabilities control read, put and delete; site/table identity is copied at creation and never supplied through WordPress PHP or HTTP. All SQL remains prepared, responses are strictly validated, and the store refuses more than 50 D1 queries per instance (GET/ALL/PUT = 1; DELETE = 2), including failed attempted D1 calls. **Other D1 calls in the same Worker invocation are not counted**; this local cap does not prove Free daily or per-invocation resource fitness.

Run `bun test tests/d1-wpdb-option-store.test.ts` and `bun run d1:option-mutation-e2e` to verify the real localhost Workerd D1 binding, fresh read-after-write, site isolation, 50-query guard, restart and deletion. See [composable store evidence](../../../docs/reports/2026-11-06-microwp-d1-composable-options-store.md). This site-scoped fixture is not the real WordPress core schema, and the module is **not connected to WordPress's wpdb adapter**. Production remains NO-GO.

## R36 private option batch-read (non-installed)

The host-only options-store.ts implements getMany(names, readCapability) to read 1–96 distinct options in one prepared D1 SELECT, using at most 100 bound parameters, strict trusted-site scope, projection and response size bounds, and a 64-KiB aggregate output cap. Missing names map to null and empty values remain empty in an immutable null-prototype map. Wrong capabilities, sparse arrays, duplicate names, duplicate result rows and oversized values fail closed.

This operation counts as one of the 50 per-store D1 query budget, not all queries in the hosting Worker invocation. Run bun test tests/d1-wpdb-option-store.test.ts and bun run d1:option-mutation-e2e to verify real local Workerd D1 behavior, site isolation, revision freshness, 100-bind limit and restart persistence. See docs/reports/2026-11-06-microwp-r36-private-option-batch-read.md. It is not a complete installed wpdb driver and must never be deployed as the local proof.

## R36 schema-metadata families and narrowly pinned option UPSERT

schema-metadata.ts recognizes only fixed pre-prepare DESCRIBE wp_options, DESC wp_options, SHOW COLUMNS FROM wp_options and SHOW TABLES LIKE 'wp_options' spellings. It performs exactly one bound read-only D1 SQLite metadata SELECT (sqlite_master or pragma_table_info), with an independent host-owned capability and a trusted wp_options table. Results are explicitly SQLite column metadata, NOT synthesized MySQL-compatible wpdb DESCRIBE/SHOW response shapes. All other tables, wildcard patterns, SQL comments and arbitrary raw SQL fail before D1.

options-upsert-template.ts recognizes exactly ONE fixed pre-prepare INSERT INTO wp_options ... ON DUPLICATE KEY UPDATE template with three separately typed values. It uses the existing prepared site-scoped one-query ON CONFLICT SQLite UPSERT, requires the actual UNIQUE(site_id,option_name) index and never interpolates the user strings into SQL. MySQL affected-row semantics, other indexes, arbitrary plugins, SQL dialect breadth, and the authentic WordPress schema are still unimplemented.

Reproduce: bun test tests/d1-wpdb-schema-metadata.test.ts tests/d1-wpdb-option-upsert-template.test.ts; bun run d1:option-mutation-e2e. The local real-D1 Workerd test verifies metadata, narrow INSERT/UPDATE, isolation, restart persistence and cleanup. See docs/reports/2026-11-06-microwp-r36-d1-metadata-and-pinned-upsert.md. Neither helper is active in production WordPress. NO-GO.

## R36 core posts/users/taxonomy read families (non-installed)

core-reads.ts adds private typed one-query D1 reads for 1–16 full core post IDs and postmeta for up to 32 post IDs, with separate host-owned capabilities, strict site scope, deterministic ordering, overflow witnesses and SQL-side text bounds. user-reads.ts adds a separate sensitive auth capability for a minimal login row (ID, user_login, user_pass, user_status) plus a distinct 32-user usermeta batch. taxonomy-reads.ts adds one fixed three-table DISTINCT JOIN for up to 16 object IDs and eight explicit taxonomy names. None accepts raw SQL, caller-selected tables, scope, projections or ordering.

These modules use an artificial site_id research fixture and are not canonical WordPress table-parity evidence. They are not imported by live WordPress, db.php, staging or the Durable Object runtime. Run bun test tests/d1-wpdb-core-reads.test.ts tests/d1-wpdb-user-reads.test.ts tests/d1-wpdb-taxonomy-reads.test.ts and bun run d1:option-mutation-e2e. See docs/reports/2026-11-06-microwp-r36-core-d1-read-families.md. Production remains NO-GO.
