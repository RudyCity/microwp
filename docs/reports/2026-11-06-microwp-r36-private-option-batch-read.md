# microWP R36: Private D1 WordPress Option Batch Read

Date: 2026-11-06
Status: LOCAL WORKERD D1 PROOF ONLY; NATIVE WPDB AND REMOTE FREE CPU STILL NO-GO.

## Goal

The R36 local genuine WordPress PHP-WASM census measured approximately 1,723 logical SQL statements across 18 PHP requests. Six requests exceeded 50 logical SQL calls, with a peak of 559. One-to-one forwarding to D1 could exceed the Free 50-query invocation limit. This experiment reads multiple fixed, host-authorized options using one D1 query. It is not installed into WordPress.

## Design and security

- Private options store implements getMany(names, readCapability) for 1–96 distinct, dense, valid UTF-8 names (each at most 191 bytes).
- Exactly one prepared scoped SELECT uses 2 bounded projection arguments, 1 server-owned site ID, up to 96 option-name binds, and 1 LIMIT witness, for at most **100 SQL bindings**.
- SQL-side projections and strict complete response validation refuse overlong options, duplicate or unexpected rows, malformed responses, unsorted output, and aggregate key/value bytes above 64 KiB.
- Returns an immutable, null-prototype map where absent names are null, present empty strings remain empty, and special __proto__ names cannot mutate object prototypes.
- A separate opaque read capability is required. Malformed input fails before D1 preparation; attempted database work counts toward the **per-store** 50-query budget even if D1 fails. The total Worker invocation's unrelated D1 queries are not accounted for by this store.
- No cross-request cache, public route, remote deployment, live WordPress db.php adapter, schema migration, credential or billing change.

## Verified local evidence

- bun test tests/d1-wpdb-option-store.test.ts: 15 PASS, 0 FAIL, including 5 new batch behavior tests.
- bun run d1:option-mutation-e2e: PASS against real localhost Workerd D1 binding with placeholder database UUID ending 0013. Checks 96-key single SELECT, 100 bindings, site isolation, fresh read-after-write, restart and 50-query guard.
- bun run check: 318 PASS, 0 FAIL, 2566 assertions; TypeScript compilation passed.
- No claim of direct query-native WordPress wpdb compatibility. Current WordPress still runs PHP-WASM with SQLite and D1 snapshot persistence.

## Production blockers

This proof uses a special site_id-scoped options fixture, not WordPress core wp_options schema. It cannot handle arbitrary WordPress option sizes, serialization and filters, live SQL translation, plugin SQL, transaction/DDL, lossless migration, backups or complete authenticated workflows. Real Cloudflare Free ingress and Durable Object CPU/peak isolate memory evidence remains outstanding. The existing production preflight must remain fail-closed at 2/14.

Decision: research PASS; production NO-GO.
