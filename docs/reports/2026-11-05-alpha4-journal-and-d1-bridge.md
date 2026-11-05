# microWP alpha.4 — D1 media recovery and PHP-to-D1 bridge proof (2026-11-05)

## Summary

This experimental change improves crash recovery when WordPress removes an R2 media object. It also validates the first narrow asynchronous PHP-WASM ↔ Worker ↔ D1 data path; it does **not** replace WordPress's PDO SQLite driver.

## D1 media delete journal

Migration `0002_microwp_media_delete_journal.sql` creates `microwp_media_delete_journal(site_id,object_key)`. A WordPress media deletion is handled in this order:

1. PHP finishes the request and removes the local media file.
2. The Durable Object saves the SQLite image **and** the matching object-key deletion journal in **one D1 batch transaction**. A failed batch does not replace the old database or commit the deletion journal.
3. Only after D1 commits does the Worker remove validated objects from R2. The journal entry is deleted **after** the R2 deletion succeeds, not before.
4. If an isolate stops after the D1 commit, the next Durable Object initialization replays any journal entries **before** rehydrating uploads into PHP-WASM.

All journal object keys are validated against the `wp-content/uploads/` namespace. A failed delete or D1 journal cleanup leaves the pending operation for retry after a cold restart. The Worker fails closed if a journal is corrupt or cannot be processed.

This is crash-recoverable media **deletion**, not an atomic cross-service transaction between all PHP filesystem, D1, and R2 writes. A crash after uploading an R2 object but before the matching D1 snapshot can still produce an orphan; automatic upload reconciliation and real abrupt-crash fault injection remain required.

## Tests

- `bun run check`: **62 tests PASS**, including five new D1 media journal unit tests, four new strict SQL bridge protocol tests, D1 transaction failure and unsafe-path cases.
- `bun run e2e:local`: original WordPress installer, login/auth, article create/edit, R2 media, restart and delete PASS. The final local D1 query verifies **zero pending media-deletion journal rows** after a successful WordPress media deletion.
- Cloudflare isolated staging migration `0002`: applied and verified. The D1 binding now has **3 microWP tables** (snapshots, chunks, journal).
- Secret-gated private Cloudflare `--storage-write-test`: HTTP 200, `verified=true`, `journalReplayed=true`. Read-only verification found **zero canary snapshots and zero outstanding journal rows** after cleanup.
- Private `--sql-bridge` diagnostic: PHP 8.4.27 called `post_message_to_js`; its strictly fixed JavaScript listener performed `SELECT 1 AS ready` via Cloudflare D1, returned the result to PHP, and the Worker reported HTTP 200, `d1FromPhp=true`, `phpExitCode=0`.
- Public staging safety smoke: **10/10 PASS**. WordPress content/admin/login/REST/media remains unavailable to public traffic.

## Direct D1 SQL caveat

The bridge can return an asynchronous result from D1 to PHP. This is **only a capability proof**, not a production query dispatcher. The message handler accepts exactly one sentinel string and runs one fixed, read-only statement; it does not accept SQL text, a table identifier, or PHP-controlled SQL parameters.

A real native `wpdb` driver requires verified WP SQL compatibility, prepared statements, query/transaction error mapping, concurrency controls, bounded payloads, plugin compatibility, security audit, migration and rollback. The D1-backed SQLite image remains the active storage mode in alpha.4.

## Outstanding blockers

Full WordPress bootstrap in the deployed Cloudflare account still hits `exceededCpu` (previous private observation around 2,010 ms CPU); neither journal replay nor the PHP-only D1 bridge eliminates it. Peak 128 MB isolate memory, comprehensive crash injection, media upload orphan cleanup, backup/restore drills and external security remain unverified.

**Production NO-GO.** No account plan change, custom DNS change or public WordPress route was authorized.
