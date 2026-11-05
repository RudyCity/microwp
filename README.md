# microWP

A native Cloudflare Workers engine for REAL WordPress, powered by PHP 8.4 WebAssembly. This is NOT a static WordPress export or a replacement CMS.

## Status: LOCAL PREVIEW / PRODUCTION NO-GO (2026-11-05)

WordPress 7.1.4 with SQLite Database Integration 3.1.3 boots in real local Cloudflare workerd: GET / returns HTTP 302 to the WordPress installer and GET /wp-admin/install.php returns HTTP 200 with the real installation form. A separate experimental Durable Object Worker serializes WordPress PHP requests and has versioned, SHA256-checked SQLite snapshots. Unit tests pass; persistent post-install WordPress and restart restore have NOT yet passed an end-to-end test.

The PHP code package contains 1550 WordPress/plugin PHP files (22,330,275 raw bytes, compressed to about 5.5MB) with about 2209 static assets. Emscripten filesystem ZIP mounting is lazy. Local probe: 560 files / 12,666,450 bytes inflated on the initial installation request, 74ms mount, 2.1s first page load. NOT a Cloudflare production memory/CPU result.

## Quick start in Git Bash on Windows

  cd /g/project/microWP
  bun install
  bun run sources:fetch
  bun run wordpress:prepare
  bun run check
  bun run durable:build
  bun run durable:dev

Open http://127.0.0.1:8796/wp-admin/install.php?step=1 locally.

Other scripts:
- bun run dev: small edge gateway, intentionally no PHP.
- bun run wasm:dev: separate PHP-WASM echo/HTTP probing Worker.
- bun run native:dev: WordPress local with ephemeral SQLite and native-health statistics at /__microwp/native-health.
- bun run durable:dev: WordPress through SQLite-backed Durable Object with experimental database snapshots.
- bun run production:preflight: fail-closed production GO/NO-GO gate; it is expected to FAIL today.

## Architecture

Browser -> Worker security/static/R2 -> single-site Durable Object -> PHP 8.4 WASM -> lazy-mounted WordPress core and SQLite Integration -> transactional DO snapshot. R2 media reads and write-through exist, but PHP-side media rehydration and genuine upload testing remain pending. Native WordPress page cache remains OFF until invalidation is safe. Public runtime routes are blocked; local preview only.

Security measures include blocked wp-config and script uploads, MIME signature checks, bounded body and media sizes, single PHP execution at a time, no public upload endpoint, disabled WP auto file modifications, and failed snapshot/write-through lockout. Further security review is required.

## What remains before production

Durable WordPress install/posts/users/auth tests across process restart, R2 media hydration and image edits, external Cloudflare staging, 128MB memory measurement, CPU profiling, upload crash recovery, backups/restores, plugin compatibility, domain approval and stable login salts. Do not use this engine with real user credentials or publicly accessible pages yet. Database snapshot currently limited to 8MiB.

Cloudflare Wrangler is not authenticated (expired token); no staging or production deployment has been executed and no DNS has been modified. The owner must authenticate Wrangler before a real Cloudflare staging deployment.

## More detail

See docs/plans/2026-11-05-microwp-master-plan.md and docs/plans/2026-11-05-microwp-persistence-design.md.

WordPress, SQLite integration and WordPress Playground PHP-WASM are GPL-2.0-or-later. Preserve licenses/notices and publish corresponding source as required.
