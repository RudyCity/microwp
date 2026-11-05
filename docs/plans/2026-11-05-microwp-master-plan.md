# microWP Master Plan — 2026-11-05

## Milestone reached: WordPress local runtime works; PRODUCTION NO-GO

- WordPress 7.1.4 ZIP pinned by SHA256 a147146c159362778ecbbbfb07bb20ddf4e85b130f971c824e656a8f938c5f87.
- SQLite Database Integration 3.1.3 plugin pinned by SHA256 f6ce35e8419d0b9326221a907627d905e25c2a5ba2afc86492811f14c851efe0.
- PHP 8.4.27 WASM runs inside workerd. Method, POST, GET query and cookies verified.
- WordPress core 1550 code files in compressed ZIP; 2209 public assets. Lazy Emscripten MEMFS mounting verified with actual PHP includes.
- Local WP GET / -> 302 install page, GET install -> 200. No WordPress admin login or post-publish E2E yet.
- Lazy mount 74ms, 560 PHP files / 12,666,450 bytes inflated by install, first load ~2.1s locally. This is not a measured 128MB peak or Cloudflare CPU figure.
- Native WordPress page cache is OFF until publish invalidation; static files and media can be routed separately.
- Durable Object single-site serialization and snapshot storage implemented: transactional manifest, 256KiB chunks, 8MiB database limit, SHA256 verification and fail-closed corrupted snapshots. Unit tests only, no WordPress crash/restore end-to-end.
- R2 media GET and restricted WordPress write-through implemented; real media upload/rehydration pending.
- Public dynamic requests disabled; no Cloudflare account deployment or DNS change.
- Wrangler whoami: expired token, not logged in.

## Production gating order

1. Run WordPress installation in local Durable Object with generated demo identity, add/edit post, restart Worker, verify DB/nonce/cookies and content are stable.
2. Add PHP-side R2 media file hydration, media deletion/rename, image derivatives and cache invalidation. Test full WordPress upload workflow.
3. Close crash atomicity window between PHP SQLite transaction and DO snapshot, or use native DO SQL/alternative database backend with transactional coupling. Add recovery and corruption drills.
4. Set stable WordPress salts as Cloudflare secrets; verify auth, sessions, nonce, rate limiting and CSRF across restart and concurrency.
5. Benchmark real isolate memory, CPU time (Cloudflare Workers 128MB memory), 64MiB bundle, plugin compatibility and large images. WordPress Free CPU limit may not suffice.
6. Implement/verify backup and recovery, staging Cloudflare Access protection, observability, deployment rollbacks, operational checks.
7. Authenticate Wrangler locally (requires user action), provision private staging DO + R2, test with real Cloudflare account and no production DNS.
8. Audit GPL requirements; security review and explicit operator approval before any public domain routing.
9. Run production preflight. NO-GO until all conditions are genuinely verified.

## Unresolved architecture decision

Playground PHP build includes PDO SQLite, but not mysqli. Hyperdrive MySQL would require a proper WordPress wpdb/mysqli adapter or a different custom PHP-WASM build. Durable SQLite is the current experiment, not a proven production database replacement. Also the Emscripten loader emits eval/duplicate-key build warnings: review before release.

## Usage

bun run sources:fetch
bun run wordpress:prepare
bun run check
bun run durable:build
bun run durable:dev
bun run production:preflight

Do not create worktrees or branches. Do not commit credentials, node_modules, downloaded WP ZIPs or generated PHP source bundles.
