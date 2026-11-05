# microWP Stage-3 Worker C — Real-Schema Offline D1 Plan Evidence

Date: 2026-11-06. Scope: ONLY the three assigned Worker C files.

## Source and confidentiality

The orchestrator identified an ignored, local-only installed WordPress SQLite snapshot at `.wrangler/e2e-verified-wp-sqlite-image.bin` (393,216 bytes). This file is never committed, transmitted, bundled, or printed. Its contents may include credentials and must not be displayed in test logs. Read access only. Snapshot provenance is a local verified E2E state, **not evidence of any remote D1 migration**.

## Observed structure (schema metadata only)

- 21 non-internal tables: 12 WordPress core and 9 SQLite Integration metadata; internal `sqlite_sequence` is separate.
- 29 explicit CREATE INDEX objects; additional implicit SQLite autoindexes are retained by preserving table DDL.
- `STRICT`, `DEFAULT`, `COLLATE NOCASE`, `AUTOINCREMENT`, and sequence values require full fidelity.
- Table DDL is preserved verbatim from the *locally inspected* `sqlite_master` rather than attempting to infer semantic equivalents. The planner proposes CREATE tables, parameter-bound INSERTs, explicit index recreation and sequence restoration.

## Safety and validation

- Local `bun:sqlite` only, bounded at 8 MiB snapshot, 2 MiB row payload, 2048 rows, 32 tables, 64 explicit indexes, 32 columns/table, 128 KiB/cell, 64 KiB/DDL.
- Only the 12 known WordPress core tables and 9 known SQLite metadata names are automatically allowed. Unknown plugin tables require explicit per-table allowlisting; unsafe identifiers, unknown objects, views, triggers, virtual tables, extra statements, or unsupported SQL shapes fail closed.
- Snapshot preserved by byte copy and SHA-256 digest. Dry-run roundtrip reconstructs into a *fresh ephemeral local SQLite instance*; compares `sqlite_master` definitions, PRAGMA table/index/foreign-key metadata, row values **and SQLite storage classes**, row counts, `sqlite_sequence`, and integrity check. Failure denies the plan.
- Autoindexes and collations are preserved by SQL DDL and checked structurally; source entries are never modified. Sequence rows are restored after inserts so the historical counter is retained even when greater than the current max primary key.
- Any raw SQL in DDL originates solely from offline vetted SQLite schema, is bounded and filtered and used only in local memory. **It is not safe for a public route and not a generic SQL execution gateway.** No Cloudflare bindings are accepted.

## Unresolved blockers — production NO-GO

Local SQLite roundtrip cannot prove Cloudflare D1 native schema SQL compatibility, WordPress/PHP `wpdb` MySQL dialect semantics, collations across environments, real-world plugin interoperability, transaction cutover/locking, concurrent writes, backup recovery, or CPU budget. No remote Cloudflare mutation, production migration, rollback, or staging deploy is performed. An operator-controlled authorization and real E2E gate remain mandatory. The returned plan states `productionReady:false`, `remoteExecutionAllowed:false`. The original snapshot is preserved; rollback means retain the original bytes and SHA, **not** an implemented live rollback mechanism.

## Verified local snapshot result

Scoped real-image test **PASS** on the locally present 393,216-byte ignored file:
21 non-internal tables, 29 explicit indexes, preservation of implicit autoindexes,
row/storage-class parity, full source DDL and PRAGMA structural parity, and
`sqlite_sequence` parity. Index-list entries are normalized by index name
for comparison because CREATE INDEX replay order can differ without changing
the index definitions. Snapshot bytes were not printed or copied into the report.

## Local verification

Run `bun test tests/d1-native-migration-plan.test.ts` and `bun run check`. The ignored snapshot roundtrip test is conditional on local presence; report concrete outcome rather than claiming an unavailable snapshot was tested.
