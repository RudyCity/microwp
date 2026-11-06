# microWP R36 continuation: D1 schema metadata and pinned option UPSERT

Date: 2026-11-06
Decision: **PRIVATE LOCAL D1 PROOF ONLY; FULL NATIVE WORDPRESS WPDB AND CLOUDFLARE FREE CPU STILL NO-GO**
Checkout: G:\project\microWP, main, no new branch/worktree.

## Scope

The R36 authentic WordPress 7.1.4 PHP-WASM SQL census sampled 1,723 logical SQL statements in 18 PHP requests, with 79 categorical SQL families. The observed verbs included 48 DESCRIBE and 20 SHOW statements, and a recurring INSERT / options / ON_DUPLICATE category. These are categorical observations, **not complete original SQL templates**; specific patterns below are narrowly pinned hypotheses to verify against real WordPress SQL before activation. The live WordPress still uses SQLite Integration inside PHP-WASM and D1 snapshot persistence.

## Implemented safe metadata introspection

Module: src/php/d1-wpdb-conformance/schema-metadata.ts.

- Accepts only exact pre-interpolation DESCRIBE wp_options, DESC wp_options, SHOW COLUMNS FROM wp_options, or SHOW TABLES LIKE 'wp_options' queries. Any SQL injection, other table, wildcard, semicolon, unsupported schema dialect, or altered spelling fails before D1.
- Requires an independent opaque host-owned schema capability and a trusted table identity. No client-selectable schema name or SQL is passed through.
- SHOW TABLES LIKE is mapped to a single bound read-only SQLite sqlite_master SELECT with an exact table-name equality check (not SQL LIKE wildcard matching).
- DESCRIBE/SHOW COLUMNS is mapped to a single bound read-only SQLite pragma_table_info table-valued SELECT with at most 100 columns, a 101-row overflow witness, bounded type/default/name metadata, monotonic column order and required options columns.
- Results explicitly flag mysqlDescribeCompatible:false or mysqlShowTablesCompatible:false. They return **real bounded SQLite metadata**, not a fabricated MySQL wpdb result (Field / Type / Null / Key / Default / Extra). MySQL index-key semantics, collation and the canonical WordPress wp_options schema are not yet emulated.
- Module is NOT imported into the live Durable Object/WordPress/staging paths.

## Implemented pinned MySQL-shaped options UPSERT

Module: src/php/d1-wpdb-conformance/options-upsert-template.ts.

- Allows one exact INSERT INTO wp_options (option_name, option_value, autoload) VALUES (%s, %s, %s) ON DUPLICATE KEY UPDATE option_value = VALUES(option_value), autoload = VALUES(autoload) pre-prepare template with exactly three separately typed values.
- Validates the host-owned site scope, exact table, opaque write capability, bounded name/value and autoload state before forwarding to the already-tested private prepared SQLite UPSERT. No unsafe string interpolation or arbitrary SQL translator.
- The SQLite UPSERT requires actual UNIQUE(site_id, option_name); a missing index fails closed without writing.
- Does NOT implement MySQL affected rows, extra UNIQUE conflict semantics, arbitrary inserts/updates, plugin SQL, WordPress dynamic table prefix, real WordPress schema migration or a general INSERT statement parser.

## Actual local verification

- New unit tests: tests/d1-wpdb-schema-metadata.test.ts and tests/d1-wpdb-option-upsert-template.test.ts. They cover malicious templates, wrong capabilities, missing schema, malformed/oversized metadata, actual SQLite SQL binding and site-isolated upsert behavior including SQL-looking values.
- Existing local-only real Cloudflare Workerd D1 E2E was extended: bun run d1:option-mutation-e2e. It runs on localhost with an isolated fake database UUID ending in 0013. It verifies prepared D1 SHOW/DESCRIBE, pinned UPSERT insert/update, prepared GET consistency, persisted state after Workerd restart and cleanup. Public GET remains blocked.
- No remote Cloudflare D1/R2 mutations, deployment, DNS, billing, security bypass or user-data changes were performed.
- Full suite, WordPress E2E, dry-run builds and production fail-closed gates must be run separately before commit.

## Corrected Cloudflare Free D1 accounting

The official Cloudflare D1 limits documentation (https://developers.cloudflare.com/d1/platform/limits/, updated 2026-10-30) says that **one D1 db.batch() API call counts as ONE D1 query request toward the Free 50-queries-per-Worker-invocation limit**, even when it executes many SQL statements. Individual statements retain their own SQL length, 100-bind, result size and resource usage limits; rows-read/written, daily quotas and execution duration need separate measurements.

Previously written microWP documentation incorrectly counted an 11-SELECT batch as 11 D1 API query requests. That wording is corrected here and in the old atomic report, README and AGENTS.md. The existing composable option store still deliberately charges DELETE **two conservative statement-weighted units** even though it invokes one D1 batch API request. Its usedQueries property is NOT a precise Worker-invocation D1 API request meter, and must never authorize production Free quota decisions.

## Remaining blockers

- Establish real WordPress 7.1.4 MySQL DESCRIBE/SHOW and SQL source templates, full MySQL type/index/collation semantics and WordPress query-native D1 wpdb integration.
- Complete safe SQL translation for posts, postmeta, users/auth, taxonomy joins, comments, transactions and plugin-defined tables. Never treat schema-introspection proof as direct WordPress compatibility.
- Full per-invocation and daily D1/R2 accounting, crash-safe reversible migration, backup/restore, security review and remote Cloudflare Free ingress/SQLite Durable Object CPU and 128 MiB isolate memory proof.
- Existing preflight remains **NO-GO (2 of 14 gates)** until independently verified.

No public Worker, production WordPress driver, or Cloudflare Free service limit was changed.
