# microWP: Workers Free only — viable publishing architecture

Date: 2026-11-06. Owner constraint: **NO PAID**. No plan changes, subscription, or paid CPU.

## Decision and evidence

Cloudflare Workers Free has **10 ms CPU per request**, 128 MB isolate memory, and 100,000 Worker requests/day. Prerendered **Static Assets** can be served without invoking a Worker. D1 Free has daily row-read/write and storage quotas. Sources: https://developers.cloudflare.com/workers/platform/limits/ ; https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/ ; https://developers.cloudflare.com/d1/platform/pricing/ .

The tested WordPress PHP-WASM bootstrap did **not** meet the Free CPU budget (previous private Cloudflare probe: `exceededCpu`, ~2,010 ms CPU). The revised local profiler gave two HTTP 200 installer responses but their wall-clock times (~3.2s cold/~1.5s warm) are **not Cloudflare CPU**. Optimizing the ZIP metadata lookup by <1 ms is not an architectural fix. The full WordPress backend CANNOT be claimed production-ready on Workers Free.

This is a proposed *publishing-mode tradeoff*, not an unapproved replacement of full WordPress admin with a new CMS.

## Preferred architecture

```text
WordPress 7.1.4 + PHP (local/offline editor or independently hosted free backend)
  -> trusted publication/export pipeline (manual or free CI within quotas)
      -> prerendered HTML/CSS/JS into Workers Static Assets
      -> approved, public-only post metadata into D1 (native SQL)
      -> immutable images/files into R2 wp-content/uploads/
Cloudflare Workers Free
  -> Static Assets directly (default, no PHP, bypass Worker when possible)
  -> small optional Worker read-only D1 public index
  -> bounded R2 media GET only
  X no live wp-admin, wp-login, PHP, WordPress installer, writes or arbitrary SQL
```

**Important:** WordPress authoring and plugin execution would NOT happen in the public Cloudflare Worker; WordPress can only operate on a machine/service that has enough compute to run PHP. Running it on a user's laptop or GitHub Action is not always-on WordPress admin. If permanent web admin is mandatory, a separately authorized always-on PHP host is required and may not be free. This distinction must be accepted before routing public traffic.

## Implemented optional proof, not deployed

- `src/free-site/public-edge.ts` — opt-in read-only Worker handler behind `MICROWP_FREE_PREVIEW_MODE=enabled`; rejects PHP/admin/REST and non-GET requests, uses ASSETS for trusted prerendered pages, R2 only for bounded safe uploads and a fixed D1 SELECT for the public post index.
- `tests/free-public-edge.test.ts` — opt-in, public route lock, fixed D1 query+bindings, rejected unsafe data and media, bounded/no-write behavior.
- No new Worker entrypoint, Wrangler deployment, staging binding, R2 mutation, D1 schema migration, real published content, or public route was activated in this change. Current staging remains locked. Query requires a separate reviewed D1 table and trusted publication pipeline before activation.
- This mode does **not** prove CPU <=10 ms on Cloudflare: an authorized canary must measure actual CPU on repeated representative static, API and R2 requests, with budget headroom.

## Next implementation gates (all Free)

1. **Offline exporter:** build a bounded, repeatable WordPress post/page/theme-to-static compiler with safe output encoding, canonical URLs, media rewriting, redirects and rollback. Run it on local PHP or suitable free CI. Tests must prove no private posts, draft posts, user credentials or tokens are exported.
2. **Publication transaction:** implement a reviewed, idempotent, operator-initiated CLI pipeline; static assets and D1 post index must share an immutable revision. Use R2 only for approved files. No unauthenticated publishing endpoint.
3. **Local integration:** test a real WordPress install, publish/edit, build, immutable page output, D1 public index, R2 files and rollback with lossless source preservation.
4. **Free staging:** only after explicit approval, deploy a separate isolated Free preview Worker and verify Worker CPU, request quotas, 128 MB, and invalid-path/security tests. Keep WordPress admin routes blocked.
5. **Operator decision:** accept public static/headless WordPress with offline authoring, or provide an independently available PHP backend (which may require running your own machine and network setup). Do not silently change the original full-live WordPress requirement.

## Non-negotiable guards

- Never upgrade plan/billing or modify paid limits; do not set `limits.cpu_ms` above the Free tier.
- Never activate `src/php/d1-wpdb/db.php` as a full driver: SELECT-only proof cannot run real WordPress.
- Keep the original D1-backed SQLite snapshot and R2 journal untouched until a reversible complete migration is verified; do not delete suspected orphan R2 uploads.
- If CPU, memory, quota, data privacy or storage checks fail, **fail closed**; no automatic switch back to PHP-WASM.
- **Production status: NO-GO.** This code is an opt-in architecture feasibility prototype only.

## Local verification actually performed (2026-11-06)

- `bun run check`: 154 tests passed, 0 failures (including seven Free public handler and three isolated config/schema tests).
- `bun run free:build`: `wrangler deploy --dry-run` compiled the independent Free entrypoint with 10.06 KiB / gzip 3.25 KiB Worker code; no deployment occurred.
- `CI=true wrangler d1 migrations apply microwp-free-preview-local-db --local --config wrangler.free-preview.jsonc --persist-to .wrangler/free-preview-local-state` succeeded; D1 schema is local-only.
- A **local-only** demo published post was inserted into D1 with a fixed SQL command. A **local-only** 68-byte PNG was stored in the separate R2 namespace under `wp-content/uploads/demo.png`.
- Node-run Wrangler Workerd on loopback `127.0.0.1:18921` with explicit `--var MICROWP_FREE_PREVIEW_MODE:enabled` returned HTTP 200 for `/__microwp/free/posts` and yielded the demo post. R2 media GET returned HTTP 200, image/png, 68 bytes and exact byte-for-byte parity. WordPress login and admin returned HTTP 404. Browser/public hosting was **not** activated.
- This test does **not** demonstrate a real WordPress static export, remote Cloudflare Worker CPU, R2 Free quota accounting, or any paid feature entitlement. All local test data lives under ignored `.wrangler/` only and must never be committed.

### Repeat safely in local mode

```bash
bun run check
bun run free:build
CI=true bunx wrangler d1 migrations apply microwp-free-preview-local-db --local --config wrangler.free-preview.jsonc --persist-to .wrangler/free-preview-local-state
# With the free:dev script active locally, use an explicit --var to opt in (DO NOT use on production):
node node_modules/wrangler/bin/wrangler.js dev --config wrangler.free-preview.jsonc --local --ip 127.0.0.1 --port 18921 --persist-to .wrangler/free-preview-local-state --var MICROWP_FREE_PREVIEW_MODE:enabled
# Then GET http://127.0.0.1:18921/__microwp/free/posts; /wp-admin/ remains 404.
```

**Security before activation:** `run_worker_first:true` intentionally routes every request through the safety gate while the static assets tree is not yet curated. Static-asset bypass and lower Worker request usage should only be enabled with a separate verified public-only export directory plus route patterns that cannot expose untrusted files or bypass the admin/PHP block. No publish/export pipeline currently writes this directory.
