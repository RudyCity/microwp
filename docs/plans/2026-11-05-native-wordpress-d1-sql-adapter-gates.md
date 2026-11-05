# Native WordPress-to-D1 adapter — verified feasibility and rollout gates

**Status:** design / isolated proof only. The current released architecture still uses a D1-backed snapshot bridge.

## Proof established

The PHP-WASM runtime supports `post_message_to_js()` and `PHP.onMessage(async listener)`. On isolated Cloudflare staging, fixed PHP code successfully invoked an asynchronous JavaScript handler, the handler read a single fixed `SELECT 1 AS ready` from the D1 binding, and PHP received the result. The canary returned HTTP 200.

The proof is implemented in `src/php/d1-message-bridge.ts` and is **deliberately non-general**: unrecognized messages or SQL-like strings cannot execute queries. Never expose an SQL execution endpoint on the publicly reachable staging Worker.

## Required stages

1. **Protocol:** versioned structured envelopes and bounded serialization; reject unexpected operations, oversized payloads, unsupported SQL, and cross-site context. Keep message and result size within the Worker/PHP memory budget.
2. **Compatibility:** a PHP `wp-content/db.php` drop-in or an upstream-supported adapter must map WordPress query semantics to D1's SQLite dialect. Reuse compatible SQL translation logic where licensing and behavior permit. MySQL-specific queries, schema migration, PDO behavior, plugin queries and error codes require an extensive conformance test suite.
3. **Transactions:** define explicit transaction boundaries over asynchronous PHP↔JS messages; preserve isolation and rollback semantics. Do not assume Cloudflare D1 `batch()` supports every multi-step WordPress transaction without an RPC-level transaction design.
4. **Security:** parameterized statements; safe identifier handling; site-bound authorization; strict quota, timeout and rate-limits; no unrestricted runtime PHP or untrusted plugin database calls; never leak D1 binding identifiers or credentials through public routes.
5. **Migration:** export and verify original SQLite contents, migrate into D1 WordPress tables, compare all row counts/checksums, and support a reversible rollback without destroying the original snapshot. No automatic irreversible cutover.
6. **CPU and memory:** verify on *live Cloudflare Workers* that the entire WordPress installer, admin, REST requests and representative plugins fit the configured CPU budget and 128 MB isolate ceiling.
7. **Cutover:** require an explicit feature flag, one-site canary, independent security review, and operational backups before enabling direct D1 SQL in any user-facing deployment.

The SQL bridge proof confirms only the **transport feasibility**. It does not mean a native WordPress D1 driver exists or that the Cloudflare CPU constraint has been solved.
