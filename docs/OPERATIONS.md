# microWP operations and go/no-go checklist

**Alpha only**. The current Worker does not serve public WordPress admin or content. Never treat a successful dry-run as deployment or a green CI run as production approval.

> **Staging verification (2026-11-05):** Wrangler OAuth now works. An isolated R2 bucket `microwp-alpha-staging-media` was created in APAC and the `microwp-alpha-staging` Worker was deployed to `https://microwp-alpha-staging.hrudy715.workers.dev`. Public-route smoke checks pass: health 200, WordPress homepage/admin/login/REST/static/media 503, and config 403 (Cloudflare block). No DNS or existing R2 buckets changed. **This is a locked public staging gateway, not a production WordPress deployment or remote PHP benchmark.**



## Local acceptance

```bash
bun install --frozen-lockfile
bun run sources:fetch
bun run wordpress:prepare
bun run check
bun run durable:build
bun run staging:build
bun run e2e:local
bun run production:preflight
```

The last command **must fail today**, because production gates are not proven.

## Cloudflare staging (deployed, locked)

1. Confirm authentication with `bunx wrangler whoami` (do not disclose or paste credentials).
2. Use the isolated experimental R2 bucket `microwp-alpha-staging-media` already provisioned. Do not modify any unrelated bucket.
3. Review `wrangler.staging.jsonc`. It enables a publicly reachable Worker endpoint but **blocks all WordPress dynamic routes and uploaded media outside localhost**. No production custom routes or DNS are configured.
4. Deploy updates to this isolated test staging only, after reviewing the diff: `bunx wrangler deploy --config wrangler.staging.jsonc`.
5. Set `MICROWP_STAGING_URL=https://microwp-alpha-staging.hrudy715.workers.dev`, then run `bun run staging:smoke`.

The smoke script checks 503 for public WordPress/home/admin/media/static/REST and accepts 403 or 404 for secret config (the Cloudflare edge can return 403). It is **not** a WordPress production test because the public runtime is intentionally disabled.

### Authorized PHP-only and WordPress CPU canaries

**Private staging only.** The Worker requires the opt-in `MICROWP_STAGING_MODE=isolated-probe-only` setting and an untracked 64+ character `STAGING_PROBE_KEY` uploaded as a Cloudflare secret. Never paste the key into a URL, source code, GitHub, or public logs. The local key is stored only under ignored `.wrangler/staging-probe.key`.

- `MICROWP_STAGING_URL=https://microwp-alpha-staging.hrudy715.workers.dev bun run staging:probe` — fixed PHP 8.4.27 + PDO SQLite canary; live **PASS**.
- `MICROWP_STAGING_URL=https://microwp-alpha-staging.hrudy715.workers.dev bun run staging:probe --wordpress` — fixed GET WordPress installer bootstrap; live **FAIL: exceededCpu**. Do not retry repeatedly; an isolated invocation showed approximately 2,010 ms CPU.
- For independent evidence, see `docs/reports/2026-11-05-cloudflare-private-runtime-canary.md`.

Public WordPress routes remain locked regardless of either canary result. The result `runtimeInitMs: 0` is a clock-resolution limitation, **not proof of zero CPU time**; use Cloudflare invocation metrics. No change to the account plan or CPU spending configuration has been made.


## Failure handling and recovery

- Durable Object serializes WordPress requests and only returns success after the corresponding DB snapshot is stored, but an abrupt isolate failure can interrupt PHP-side state before snapshot persistence.
- Snapshot chunks are SHA256-verified with a transactional manifest. Missing/corrupt snapshot fails closed; do not replace it with an empty DB.
- Each site's auth secret is stored privately in the DO when not supplied as a Cloudflare secret; never print or export it through public endpoints.
- If a site hits the preview database or media hydration limits, treat it as unsupported and do not change the limit without memory tests.
- Backup exports, point-in-time recovery rehearsal, atomicity under crash injection, media reconciliation across crash and rollback are **still required**.

## Outstanding pre-production validations

- Crash window between WordPress SQLite commit and DO snapshot must be eliminated or proven tolerable with clear documented loss semantics.
- Real Cloudflare staging memory and CPU high-water under a representative WP site, single request and concurrency, including 128 MiB isolate budget.
- Authentication security (login/logout, CSRF/nonces, rate limiting), plugin/theme safety and execution controls, XSS/SSRF, user file attacks.
- Rich media image processing and large library hydration (current preview limit: 32 files / 16 MiB).
- Backups, independent restore and disaster-recovery drills; observability, alerting, WAF and incident response.
- Release candidate security review and explicit approval before public dynamic traffic or DNS cutover.
