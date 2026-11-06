# microWP — Pinned WordPress autoload options query conformance for native D1

Date: 2026-11-06. **Experimental prototype and local tests only. Production: NO-GO.**

## Scope

microWP must continue running real server-side WordPress 7.1.4 with PHP-WASM on Cloudflare Workers Free / SQLite-backed Durable Objects. WordPress currently persists a SQLite image through D1; it does **not** yet use a native D1 `wpdb` driver.

This milestone extends the existing **private, versioned, structured D1 query protocol** with one bounded `SELECT ... IN (?, ...)` predicate, and safely translates a second concrete query from the pinned WordPress `wp-includes/option.php` source:

```sql
SELECT option_name, option_value FROM wp_options
WHERE autoload IN ( 'yes', 'on', 'auto-on', 'auto' )
```

WordPress `wp_load_alloptions()` builds this list from `wp_autoload_values_to_autoload()`. WordPress 7.1.4 permits `yes`, `on`, `auto-on`, and `auto`; its filter may remove entries but cannot add new ones. The original query is unbounded, so a production-equivalent native D1 path will need complete paging and an atomic or otherwise consistent read strategy. This proof does **not** claim to implement full `wp_load_alloptions()` semantics.

## Implemented design

1. `src/php/d1-protocol/protocol.ts`: optional `whereIn: {column, values}` for SELECT only. The decoder enforces 1–8 non-null, finite, scalar, **distinct** values with a valid identifier and forbids using the same column in equality and IN predicates. Malformed JSON, unknown fields, oversized values and unacceptable operations fail before D1 methods are invoked.
2. `src/php/d1-protocol/worker.ts`: translates an approved `whereIn` field into D1 prepared `IN (?, ...)` SQL. The column is checked against the trusted table policy's `filter` allowlist, cannot be the server-owned site scope column, and is always bound alongside the server-owned scope. Combined maximum placeholders are bounded by the protocol; all errors return sanitized codes.
3. `src/php/d1-wpdb-conformance/options-autoload.ts`: accepts only the pinned WordPress autoload SELECT template (including subsets of official values). It rejects unrecognized autoload values, duplicates, arbitrary statements, comments, joins, interpolation, other tables and identifiers. Its trusted host supplies the site-mapped table name. It emits a strictly validated SELECT with deterministic `ORDER BY option_name ASC`, `LIMIT 50`, and `OFFSET page*50`; only offsets up to 1,000 are allowed. Original source SQL is **never passed** to D1.
4. `tests/d1-protocol-bounded-in.test.ts`: rejection/allowlist tests, scope and binding count checks, real SQLite-backed D1 prepared SQL execution and deterministic option-order checks.
5. `tests/d1-wpdb-autoload-conformance.test.ts`: extracts the **pinned official WordPress source** directly from the checked-in archive, validates the four autoload values and original SQL structure, rejects injection and other unsupported MySQL syntax, and reads 65 options across two pages from an actual SQLite database while excluding another site.

The effective maximum single SELECT binding count under v1 is 19 (8 equality + 8 IN + 1 site scope + LIMIT/OFFSET), below the maximum of 20. No new routes or public APIs are created.

## Validation

```bash
bun test tests/d1-protocol-bounded-in.test.ts tests/d1-wpdb-autoload-conformance.test.ts
bun run check
bun run e2e:local
```

The unit tests validate **actual prepared SQL binding and site isolation**, not simulated string matching alone. The normal WordPress E2E is a separate regression and continues using the existing non-native snapshot driver.

## Critical limitations

- **Not installed as WordPress `db.php` or `wpdb`.** The source runtime, active WordPress, Cloudflare staging and remote D1/R2 remain unchanged.
- **Pagination is a compatibility prototype, not a complete options-loader implementation.** The 50-row page cap and maximum offset 1,000 mean a site with more than the supported number of autoloaded options cannot be fully loaded. A future host must fail closed rather than silently returning incomplete `alloptions`, and handle the fallback unfiltered options query, which is intentionally unsupported here.
- The current page-by-offset approach does **not** provide a consistent multi-page snapshot under concurrent updates; an actual production driver needs transaction/snapshot semantics, stable keys, and bounded retry behavior.
- Autoloaded option values may be large. The existing strict 64 KiB D1 protocol response cap can reject such pages; it must not silently truncate WordPress configuration.
- WordPress may use other SELECT forms for site options, autoload flags, metadata, plugins, taxonomy, and multisite. None of those is implied to be compatible from this single-pattern proof.
- WordPress Free-tier SQLite Durable Object CPU and 128 MiB memory requirements still need authentic remote invocation evidence; local E2E tests do not prove production fitness. The remote private canary remains subject to its authenticated secret gate.

**Release decision: experimental local D1 query capability PASS; native `wpdb` production NO-GO.**
