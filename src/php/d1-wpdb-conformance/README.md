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
