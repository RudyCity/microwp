# Experimental PHP-WASM → D1 query mutations: safe bounded subset

Date: 2026-11-06. **Experimental only. The deployed WordPress runtime still uses its existing SQLite snapshot storage.**

## Implementation

The existing private structured SQL protocol under `src/php/d1-protocol/` now understands bounded, versioned `UPDATE` and `DELETE` AST messages alongside `SELECT` and `INSERT`. No raw SQL or unrestricted expressions enter the bridge.

- Strict protocol: all fields and keys validated, max 16 KiB input, max 16 assigned columns, max 8 equality predicates, max 20 bindings; UPDATE requires a non-empty values map and WHERE, DELETE requires WHERE, and unauthorized operations fail before `D1.prepare()`.
- Trusted table policy: independent `update` columns and `delete:true` authorization are disabled by default. Mutations require a server-owned tenant/site scope and a configured `identityColumn` that **must be a verified unique or primary-key column in the real schema**. The WHERE predicates must include that column with a non-null exact equality; a scope-only or broad mutation is rejected. Scope and identity columns cannot be rewritten.
- Host runtime authorization: `createD1RuntimeAdapter()` checks the existing opaque private `callerKey` plus **distinct opaque capability object identities** for INSERT, UPDATE and DELETE. Keys are snapshotted during construction and cannot be widened by mutating the caller's permissions object after creation. Missing or cross-operation keys fail closed. `handleD1ProtocolMessage()` additionally requires an explicitly authorized destructive operation, preventing accidental internal direct invocation of UPDATE/DELETE.
- SQL generation: table and column identifiers must match strict policy-validated syntax and are quoted by the Worker. Every value, tenant scope, and predicate uses D1 prepared `?` bindings, with no raw PHP SQL execution. D1 errors never reveal schema, secrets or bound values.
- Row reporting: `changes` is checked as 0 or 1. **This check is diagnostic after execution, not a transactional row-count guard.** Schema owners must attest and independently verify the identity-column UNIQUE/PRIMARY KEY constraint before enabling any live mutation.

## Tests

`tests/d1-protocol-mutation-capability.test.ts` uses an actual in-memory SQLite database and a D1 prepare/bind/run adapter. It checks:
- Denial of all mutations with a normal read-only caller key and no operation-specific capability.
- Denial of wrong, missing, forged or reused write capabilities.
- Actual UPDATE and DELETE prepared SQL with the server-owned site predicate; cross-tenant ID is unaffected.
- SQL injection strings retained as bound data.
- Denial of empty or broad WHERE, missing/non-null identity predicates, forbidden columns/tables, scope overwrites and malformed payloads before D1 methods run.
- Immutable trusted policy snapshots and invalid write policies.
- Existing experimental PHP `src/php/d1-wpdb/db.php` remains **read-only and never installed** in active WordPress.

## Production gaps and limitations

This is **not** a production `wpdb` implementation. The actual WordPress SQLite Integration driver includes SQL translation, joins, multisite options, transactions, schema migration, result metadata, error handling, and dozens of MySQL compatibility details. Real WordPress install/edit flows continue to use the SQLite-in-D1-image path. No PHP mutation parser/driver is activated, no remote D1 database was modified, no live schema constraints were audited, and no INSERT/update exactly-once semantics have been guaranteed across retries.

Never mount these functions on public HTTP routes or let a WordPress plugin supply the tenant policy/capabilities. Before any runtime activation, verify actual schema uniqueness, idempotency and transaction boundaries, WordPress `wpdb` conformance, migration rollback, private authorization and a full WordPress end-to-end suite.

**Decision: experimental prepared mutation subset implemented and locally tested; WordPress native D1 production is NO-GO.**
