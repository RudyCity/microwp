# microWP R36: observed WordPress SQL family matrix

Date: 2026-11-06
Status: LOCAL-ONLY QUERY-HOOK CENSUS; NATIVE D1 WPDB AND REMOTE FREE CPU UNVERIFIED

Source: actual WordPress 7.1.4 PHP-WASM and SQLite Integration 3.1.3, on Workerd localhost.
SQL text, literals, WordPress user content, cookies, options and stack traces are not exported.
The WordPress query hook activates after MU plugin registration, so early bootstrap queries
are NOT included. This is a sample of defined editorial and media workflows, not a
complete catalog of every plugin, multisite, schema or SQL dialect query.
The lexical family classifier is heuristic and can tag SQL tokens inside quoted literals.

## PHP request workload and the Free D1 query risk

| Local phase | PHP requests | WordPress SQL | Families | Min/request | Median/request | Max/request | Requests above 50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Before restart | 11 | 1355 | 74 | 6 | 46 | 559 | 5 |
| After restart | 7 | 368 | 26 | 6 | 32 | 219 | 1 |

Observed total: 1723 logical WordPress SQL statements across 18 sampled PHP requests; 79 distinct categorical families. 6 requests had over 50 SQL statements.
These statements ran in local SQLite inside PHP, NOT D1. Mapping every SQL call directly
to one D1 query would risk exceeding Workers Free 50 D1 queries/invocation for these
requests. Batching, verified caching and/or native SQLite execution strategies need
independent correctness and quota verification.

## Required D1 wpdb compatibility work

- SELECT, INSERT, UPDATE, DELETE across options/posts/postmeta, users/usermeta,
  taxonomy, comments, media and plugin schemas.
- SHOW, DESCRIBE, MySQL ON DUPLICATE KEY UPDATE and other dialect translation.
- JOIN/IN/COUNT/DISTINCT/ORDER/LIMIT, collation, correct unique indexes and transactions.
- Authentication, WordPress hooks, plugin SQL, rollback and lossless native D1 migration.
- Existing experimental options-store coverage is not an installed driver. Every
  family below is NOT VERIFIED against query-native WordPress wpdb.

## All sampled categorical SQL families

| Structural SQL family (verb / tables / features) | Before | After | Total | Native D1 wpdb |
| --- | ---: | ---: | ---: | --- |
| SELECT / core:options / WHERE+LIMIT | 903 | 259 | 1162 | NOT VERIFIED |
| SELECT / core:options / WHERE | 86 | 0 | 86 | NOT VERIFIED |
| SELECT / core:options / WHERE+IN | 22 | 14 | 36 | NOT VERIFIED |
| SELECT / core:posts / WHERE+LIMIT | 22 | 13 | 35 | NOT VERIFIED |
| SELECT / core:usermeta / WHERE+ORDER+IN | 30 | 4 | 34 | NOT VERIFIED |
| INSERT / core:options / ON_DUPLICATE | 28 | 0 | 28 | NOT VERIFIED |
| SELECT / core:comments / WHERE+IN+COUNT | 12 | 12 | 24 | NOT VERIFIED |
| UPDATE / core:options / WHERE | 24 | 0 | 24 | NOT VERIFIED |
| SELECT / core:term_relationships+core:term_taxonomy+core:terms / WHERE+JOIN+ORDER+DISTINCT+IN | 12 | 8 | 20 | NOT VERIFIED |
| SELECT / core:users / WHERE+LIMIT | 15 | 4 | 19 | NOT VERIFIED |
| INSERT / core:usermeta / simple | 18 | 0 | 18 | NOT VERIFIED |
| SELECT / core:postmeta / WHERE+ORDER+IN | 11 | 7 | 18 | NOT VERIFIED |
| SELECT / core:posts / WHERE+ORDER+LIMIT | 7 | 5 | 12 | NOT VERIFIED |
| SELECT / core:term_taxonomy+core:terms / WHERE+JOIN+IN | 7 | 4 | 11 | NOT VERIFIED |
| SELECT / core:comments / WHERE+ORDER+LIMIT+IN | 4 | 4 | 8 | NOT VERIFIED |
| SELECT / core:postmeta / WHERE | 2 | 6 | 8 | NOT VERIFIED |
| SELECT / core:posts / WHERE+GROUP+COUNT | 4 | 4 | 8 | NOT VERIFIED |
| SELECT / core:usermeta / WHERE | 7 | 0 | 7 | NOT VERIFIED |
| SELECT / core:posts / WHERE+GROUP+ORDER+LIMIT | 3 | 3 | 6 | NOT VERIFIED |
| SELECT / core:posts / WHERE+GROUP+ORDER+LIMIT+IN | 3 | 3 | 6 | NOT VERIFIED |
| SELECT / core:posts / WHERE+IN | 4 | 2 | 6 | NOT VERIFIED |
| SELECT / core:term_taxonomy+core:terms / WHERE+JOIN+LIMIT+IN | 3 | 3 | 6 | NOT VERIFIED |
| INSERT / core:postmeta / simple | 5 | 0 | 5 | NOT VERIFIED |
| INSERT / core:posts / simple | 5 | 0 | 5 | NOT VERIFIED |
| SHOW / core:posts / simple | 5 | 0 | 5 | NOT VERIFIED |
| DESCRIBE / core:commentmeta / simple | 4 | 0 | 4 | NOT VERIFIED |
| DESCRIBE / core:comments / simple | 4 | 0 | 4 | NOT VERIFIED |
| DESCRIBE / core:links / simple | 4 | 0 | 4 | NOT VERIFIED |
| DESCRIBE / core:options / simple | 4 | 0 | 4 | NOT VERIFIED |
| DESCRIBE / core:postmeta / simple | 4 | 0 | 4 | NOT VERIFIED |
| DESCRIBE / core:posts / simple | 4 | 0 | 4 | NOT VERIFIED |
| DESCRIBE / core:term_relationships / simple | 4 | 0 | 4 | NOT VERIFIED |
| DESCRIBE / core:term_taxonomy / simple | 4 | 0 | 4 | NOT VERIFIED |
| DESCRIBE / core:termmeta / simple | 4 | 0 | 4 | NOT VERIFIED |
| DESCRIBE / core:terms / simple | 4 | 0 | 4 | NOT VERIFIED |
| DESCRIBE / core:usermeta / simple | 4 | 0 | 4 | NOT VERIFIED |
| DESCRIBE / core:users / simple | 4 | 0 | 4 | NOT VERIFIED |
| SELECT / core:comments / WHERE+IN | 2 | 2 | 4 | NOT VERIFIED |
| SELECT / core:posts / WHERE+ORDER+IN | 4 | 0 | 4 | NOT VERIFIED |
| SELECT / core:posts / WHERE+ORDER+LIMIT+IN | 2 | 2 | 4 | NOT VERIFIED |
| SHOW / core:options / simple | 4 | 0 | 4 | NOT VERIFIED |
| UPDATE / core:posts / WHERE | 4 | 0 | 4 | NOT VERIFIED |
| SELECT / core:posts / WHERE+ORDER | 2 | 1 | 3 | NOT VERIFIED |
| SELECT / core:term_relationships+core:term_taxonomy+core:terms / WHERE+JOIN+DISTINCT+IN | 3 | 0 | 3 | NOT VERIFIED |
| SELECT / none / simple | 2 | 1 | 3 | NOT VERIFIED |
| SHOW / core:postmeta / simple | 3 | 0 | 3 | NOT VERIFIED |
| SHOW / core:usermeta / simple | 3 | 0 | 3 | NOT VERIFIED |
| DELETE / core:options / WHERE+LIKE | 2 | 0 | 2 | NOT VERIFIED |
| DELETE / core:postmeta / WHERE | 0 | 2 | 2 | NOT VERIFIED |
| INSERT / core:term_relationships / simple | 2 | 0 | 2 | NOT VERIFIED |
| SELECT / core:postmeta / WHERE+COUNT | 2 | 0 | 2 | NOT VERIFIED |
| SELECT / core:posts / WHERE | 0 | 2 | 2 | NOT VERIFIED |
| SELECT / core:term_relationships / WHERE | 2 | 0 | 2 | NOT VERIFIED |
| SELECT / core:term_relationships / WHERE+IN+COUNT | 2 | 0 | 2 | NOT VERIFIED |
| SELECT / core:term_taxonomy+core:terms / WHERE+JOIN+ORDER+LIMIT+IN | 2 | 0 | 2 | NOT VERIFIED |
| SELECT / core:term_taxonomy / WHERE+IN | 2 | 0 | 2 | NOT VERIFIED |
| UPDATE / core:term_taxonomy / WHERE | 2 | 0 | 2 | NOT VERIFIED |
| UPDATE / core:usermeta / WHERE | 2 | 0 | 2 | NOT VERIFIED |
| DELETE / core:options / WHERE | 1 | 0 | 1 | NOT VERIFIED |
| DELETE / core:posts / WHERE | 0 | 1 | 1 | NOT VERIFIED |
| INSERT / core:comments / simple | 1 | 0 | 1 | NOT VERIFIED |
| INSERT / core:options+other-table / ON_DUPLICATE+LIKE | 1 | 0 | 1 | NOT VERIFIED |
| INSERT / core:options / simple | 1 | 0 | 1 | NOT VERIFIED |
| INSERT / core:options / WHERE+ON_DUPLICATE | 1 | 0 | 1 | NOT VERIFIED |
| INSERT / core:posts+other-table / LIKE | 1 | 0 | 1 | NOT VERIFIED |
| INSERT / core:posts+other-table / WHERE | 1 | 0 | 1 | NOT VERIFIED |
| INSERT / core:term_taxonomy / simple | 1 | 0 | 1 | NOT VERIFIED |
| INSERT / core:terms / simple | 1 | 0 | 1 | NOT VERIFIED |
| INSERT / core:users / simple | 1 | 0 | 1 | NOT VERIFIED |
| SELECT / core:comments / WHERE+ORDER | 0 | 1 | 1 | NOT VERIFIED |
| SELECT / core:postmeta+core:posts / WHERE+JOIN+GROUP+ORDER | 0 | 1 | 1 | NOT VERIFIED |
| SELECT / core:users / COUNT | 1 | 0 | 1 | NOT VERIFIED |
| SELECT / other-table / WHERE+IN | 1 | 0 | 1 | NOT VERIFIED |
| SHOW / core:comments / simple | 1 | 0 | 1 | NOT VERIFIED |
| SHOW / core:term_taxonomy / simple | 1 | 0 | 1 | NOT VERIFIED |
| SHOW / core:terms / simple | 1 | 0 | 1 | NOT VERIFIED |
| SHOW / core:users / simple | 1 | 0 | 1 | NOT VERIFIED |
| SHOW / none / LIKE | 1 | 0 | 1 | NOT VERIFIED |
| UPDATE / core:users / WHERE | 1 | 0 | 1 | NOT VERIFIED |

## Platform limits and release gate

https://developers.cloudflare.com/workers/platform/limits/
https://developers.cloudflare.com/durable-objects/platform/limits/
https://developers.cloudflare.com/d1/platform/limits/

Cloudflare Free Worker ingress CPU: nominal 10ms; SQLite DO default CPU is documented
as 30s/request but has NOT been independently confirmed for this workload on the
actual Free account. Isolate memory is 128MB and D1 Free allows 50 queries per invocation.
Local client wall time is NOT CPU or peak isolate memory. No remote probing or changes
to Cloudflare account/billing/deployment were conducted by this evidence generator.
Production remains NO-GO.
