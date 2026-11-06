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

`options-atomic.ts` executes 11 prepared SELECT statements in one Cloudflare D1 SQL transaction, using `D1Database.batch()`. Site identity and table are private trusted configuration. It fails closed on 501+ options, oversized/invalid rows and any batch error. This is stronger than the earlier two-pass consistency comparison; it does not install WordPress `wpdb` and does not guarantee transactionality across separate WordPress D1/R2/cache resources. The 11 statements count as 11 queries toward the Free 50-query-per-invocation limit.

Run `bun run d1:atomic-e2e` for a real Workerd D1 binding test, or `bun test tests/d1-wpdb-atomic-autoload.test.ts` for isolated failure cases. See [transactional D1 autoload report](../../../docs/reports/2026-11-06-microwp-d1-atomic-autoload-batch-proof.md).
