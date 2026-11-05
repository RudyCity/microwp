# microWP D1 + R2 architecture (experimental alpha)

## What is implemented

- **D1** is the durable source of truth for the WordPress SQLite *file snapshot* in D1 bridge mode. `MICROWP_STORAGE_DRIVER=d1` must be set and the Worker must have a `DB` D1 binding. D1 uses a real SQLite database with two relational **storage** tables: `microwp_db_snapshots` and `microwp_db_chunks`.
- The standard WordPress SQLite Database Integration 3.1.3 plugin still runs PHP `PDO SQLite` against an **ephemeral** file at `/private/microwp.sqlite` in PHP-WASM. After each request, the completed file is hashed and its content stored as BLOB chunks in a **D1 batch transaction**. If media is removed, a **D1 media-deletion journal** is saved in the same transaction and drained before the next cold-start R2 hydration. The previous verified manifest and chunks remain intact on a failed D1 batch.
- A single Durable Object serializes PHP requests and keeps the site's auth secret. **The database itself is persisted in D1**, not Durable Object storage, when D1 mode is enabled.
- **R2** stores all newly uploaded WordPress media under `wp-content/uploads/<date>/<filename>`. Files are validated by filename, size and signature before write. The cold-start filesystem hydrates R2 media, and WordPress media deletion happens after D1 commits the DB.
- Trusted **static theme/plugin assets** (CSS, JS, images, fonts) may be served from R2 under `wp-content/themes/`, `wp-content/plugins/` and `wp-content/mu-plugins/`, with immutable bundled Worker assets as fallback. **Executable PHP is never served from R2**, and runtime installation or modification of themes/plugins remains disabled.

**Important terminology:** this is a **D1-backed SQLite snapshot bridge**, **not a native WordPress SQL-to-D1 driver**. WordPress tables and individual articles are *not directly queryable as D1 rows*; D1 currently stores the verified SQLite image in chunks. A true D1 `wpdb` adapter is a separate architectural task.

## Request and recovery sequence

```text
HTTP (local-only WordPress alpha) -> Worker -> single-site Durable Object
    -> read verified SQLite image from D1 (only at cold initialization)
    -> PHP-WASM / PDO SQLite -> WordPress MySQL-on-SQLite translation
    -> scan and upload validated wp-content/uploads files to R2
    -> hash SQLite image -> D1 transaction:
           INSERT new BLOB chunks
           UPSERT manifest with SHA-256 and revision
           DELETE old BLOB chunks
           INSERT journal entries for removed R2 objects
    -> replay R2 media deletions from the D1 journal after DB commit
    -> remove journal records only after successful R2 delete
    -> return HTTP response
```

The initial SQLite image is reconstructed and hash-verified before PHP receives it. If D1 returns a missing/corrupted manifest/chunk, startup **fails closed** rather than creating an empty WordPress database. If a **legacy DO SQLite snapshot** exists but the D1 snapshot is empty, microWP also **fails closed**: migration requires a verified backup and an explicit procedure. Do not delete original DO data to force a blank install.

### D1 constraints

- Maximum SQLite image is currently **8 MiB**, split into **256 KiB chunks**. The design fits below D1's documented **2 MB maximum BLOB** per row. This cap is deliberate; do not raise it before measuring Worker memory, D1 read/write costs, and D1 query limits.
- Writes use Cloudflare D1 `batch()` for an atomic set of SQL statements; reads verify revision, chunk order/length and full SHA-256.
- An abrupt failure before a D1 snapshot commit can still lose *unacknowledged* PHP-side changes. **D1-journaled R2 deletions now replay safely after restart**; however, a crash after R2 media upload but before D1 save can leave orphaned media, and upload reconciliation is not yet production-ready.
- D1 Time Travel and independent backup/restore drills are still required before production.

## R2 wp-content layout

| Key | Runtime behavior |
| --- | --- |
| `wp-content/uploads/**` | Validated WordPress uploads; persisted to and restored from R2 |
| `wp-content/themes/**` | Read-only static CSS/JS/image/font overlay if present in R2; bundled fallback |
| `wp-content/plugins/**` | Read-only static overlay; bundled fallback |
| `wp-content/mu-plugins/**` | Read-only static overlay; bundled fallback |
| Executable PHP source files | Pinned in immutable WordPress/PHP ZIP; **no R2 execution** |
| `wp-content/cache/**`, session files and arbitrary writes | Not yet supported; no general-purpose writable remote filesystem |

Old media objects with unprefixed R2 keys remain readable as a **legacy compatibility fallback**, but are not automatically rehydrated into PHP. Any previously populated bucket requires a carefully verified key migration before relying on WordPress image manipulation.

## Verified

- **62 unit tests**, including transactional D1 snapshot roundtrip, checksum validation, simulated D1 batch failure and multi-site isolation.
- Full **local workerd WordPress E2E**: install, login, publish and edit articles, media upload/read/delete, restart and restore content/auth/media **from D1 plus R2**.
- Local workerd serves a trusted R2 theme stylesheet from `wp-content/themes/twentytwentyfive/style.css`, verified by a distinctive test marker.
- Remote isolated D1 `microwp-alpha-staging-db` has its schema applied and verified; D1 and R2 bindings on locked Cloudflare staging respond to a secret-gated read-only probe. A scoped, disposable remote D1 BLOB write/read canary passed, and the canary rows were verified removed afterward.
- The official WordPress Twenty Twenty-Five stylesheet uploaded to remote R2 staging and fetched back with an identical SHA-256 checksum.
- Cloudflare staging **public routes remain blocked**. In this account, a full WordPress PHP bootstrap still hits `exceededCpu`, independently of the D1/R2 storage changes. This architecture is **experimental alpha, not production-ready**.

## Local commands

```bash
bun install --frozen-lockfile
bun run sources:fetch
bun run wordpress:prepare
bunx wrangler d1 migrations apply microwp-local-dev-db --local --config wrangler.durable.jsonc
bun run durable:dev
# Separate, disposable integration test:
bun run e2e:local
```

The local Wrangler database ID is intentionally a **local-only placeholder**. Do not deploy `wrangler.durable.jsonc` directly to a remote account.

## Staging commands (only the isolated project resources)

```bash
bunx wrangler d1 migrations apply microwp-alpha-staging-db --remote --config wrangler.staging.jsonc
bunx wrangler deploy --config wrangler.staging.jsonc
MICROWP_STAGING_URL=https://microwp-alpha-staging.hrudy715.workers.dev bun run staging:smoke
MICROWP_STAGING_URL=https://microwp-alpha-staging.hrudy715.workers.dev bun run staging:probe --storage
```

The private probe needs a Cloudflare Secret and a local ignored key. Do not publish or paste it. Staging is **locked**: these commands do not open WordPress admin, media, static assets, or login publicly.

For timestamped live and local results, see [D1 + R2 validation report](reports/2026-11-05-d1-r2-validation.md).

## Before native D1 SQL

A true query-native D1 driver would need a PHP-WASM-to-Worker D1 SQL bridge, transactional semantics compatible with WordPress/MySQL-on-SQLite, SQLite type conversions, streaming/serialization, error mapping, prepared statement security and independent performance/security evaluation. It must not silently replace a user's SQLite database; migration must be explicitly verified and reversible.

Alpha.4 recovery/bridge evidence: [D1 journal and PHP-to-D1 proof](reports/2026-11-05-alpha4-journal-and-d1-bridge.md).
