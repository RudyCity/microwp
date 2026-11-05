# microWP D1 + R2 validation report — 2026-11-05

## Scope

This report covers experimental `v0.2.0-alpha.3` on `main`, with Cloudflare D1 for durable WordPress SQLite **snapshot** storage and R2 for uploads plus selected static `wp-content` assets.

D1 database name: `microwp-alpha-staging-db` (isolated project database in the Cloudflare account). R2 bucket: `microwp-alpha-staging-media`. Staging: `https://microwp-alpha-staging.hrudy715.workers.dev`. No production DNS modified.

## Evidence

- `bun run check`: **53 unit tests, 0 failures**, including the D1 SQLite manifest/transaction/rollback/isolation tests and the R2 static-file guard tests.
- `bun run e2e:local`: **PASS**, real WordPress install, admin login/session, authenticated article create/edit, PNG REST upload, restart, persisted article/session/media, delete media and verify 404.
- Local D1 inspected via Wrangler: `microwp_db_snapshots` contained a 393,216-byte SQLite image, two chunks and a 64-character SHA-256 digest after the test. Confirms durable state is actually in D1, not merely held in PHP or a DO.
- R2 `wp-content/themes/twentytwentyfive/style.css` was served through the Worker in local E2E with a distinctive test marker. PHP never executes files fetched from R2.
- Cloudflare remote D1 migration applied successfully; both `microwp_db_chunks` and `microwp_db_snapshots` exist.
- Cloudflare remote private `--storage` probe: **HTTP 200**, `backend=d1-sqlite-bridge`, two D1 tables, R2 bound, `r2Prefix=wp-content/uploads/`.
- Cloudflare remote private `--storage-write-test`: **HTTP 200**, verified an atomic D1 `batch()` BLOB write/read and cleaned its isolated test row.
- Official WordPress Twenty Twenty-Five CSS uploaded to private staging R2, then downloaded and SHA-256 compared: **identical**, 3,009 bytes.
- Cloudflare public staging smoke: **10/10 checks pass**. WordPress routes, login, admin, REST, static and media remain HTTP 503 to public requests; uncredentialed private canary returns 404.

## Architecture disclaimer

D1 stores the complete SQLite image as verified BLOB chunks in D1 tables; the WordPress SQLite plugin still runs PDO against a temporary file in PHP-WASM. This is a **D1-backed SQLite compatibility bridge**, **not** a direct WordPress SQL driver. A future native SQL adapter would allow WordPress tables to be queryable directly in D1 but requires a separately verified PHP-to-Worker async bridge.

Only `wp-content/uploads/` and a **read-only static asset overlay** for theme/plugin CSS, JS, images and fonts are covered by R2. Executable PHP plugin/theme installation, arbitrary writable WordPress content and arbitrary static scripting uploads remain disabled.

## Release gates

- **Production NO-GO**. Full WordPress installer bootstrap still exceeds this account's Cloudflare CPU allowance (`exceededCpu`, previously observed around 2,010 ms CPU). Passing private PHP-only/SQLite tests does not remove this blocker.
- Abrupt crash-consistency tests, full backup/restore rehearsal, isolation and security audit, large-image resizing, R2 namespace migration of existing buckets, and live isolate memory under the 128 MB ceiling are not complete.
- The old Durable Object snapshot storage remains available for controlled migration. If an old DO snapshot exists with no D1 snapshot, startup intentionally fails closed rather than wiping or resetting user content.

For details and migration commands, see `docs/ARCHITECTURE_D1_R2.md` and `docs/OPERATIONS.md`.
