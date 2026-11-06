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
