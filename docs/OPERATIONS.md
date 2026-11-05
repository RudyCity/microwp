# microWP operations and go/no-go checklist

**Alpha only**. The current Worker does not serve public WordPress admin or content. Never treat a successful dry-run as deployment or a green CI run as production approval.

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

## Cloudflare staging

1. Sign into the correct Cloudflare account in an interactive terminal: `bunx wrangler login`, then verify identity with `bunx wrangler whoami` (do not disclose or paste credentials).
2. Provision an isolated experimental R2 bucket `microwp-alpha-staging-media`, if permitted, and review Durable Object provisioning/billing.
3. Review `wrangler.staging.jsonc`. It enables a publicly reachable Worker endpoint but **blocks all WordPress dynamic routes and uploaded media outside localhost**. No production custom routes or DNS are configured.
4. Deploy to isolated test staging only, after access and billing approval: `bunx wrangler deploy --config wrangler.staging.jsonc`.
5. Set `MICROWP_STAGING_URL` to the verified workers.dev HTTPS endpoint, then run `bun run staging:smoke`.

The smoke script checks 503 for public WordPress/home/admin/media and 404 for secret config. It is **not** a WordPress production test because the public runtime is intentionally disabled.

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
