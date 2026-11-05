# microWP private Cloudflare runtime canary — 2026-11-05

## Environment and scope

- Isolated staging Worker: `microwp-alpha-staging` (`workers.dev` endpoint only; no production DNS).
- Source uses official WordPress 7.1.4 and PHP-WASM 8.4.27 with PDO SQLite.
- Authentication: strong random secret in Cloudflare Worker Secrets, sent only as a request header by a local ignored script.
- Only **two fixed, non-user-controlled operations** are allowed: `runtime` (PHP and PDO SQLite canary) and `wordpress` (GET installer). The public WordPress site remains entirely blocked.
- Evidence from **Wrangler live invocation tail**, not a synthetic local benchmark or Worker deployment startup duration.

## Live results

| Canary | HTTP | Cloudflare invocation outcome | CPU time | Wall time | Evidence |
| --- | --- | --- | --- | --- | --- |
| PHP 8.4.27 and PDO SQLite only | 200 | `ok` | **8 ms** | **10 ms** | PHP version and SQLite availability returned successfully |
| WordPress installer GET | 503 | `exceededCpu` | **2,010 ms** | **2,108 ms** | Execution terminated after `WORDPRESS_INSTALLER_BEGIN` |
| Public staging route security | Expected 200/403/404/503 | PASS | Not a PHP benchmark | Not a PHP benchmark | Health, dynamic WP, login, admin, REST, media, static, protected config and unauthenticated canary gated |

The precise CPU and wall values are **observations from individual remote invocations**, not repeatable benchmark guarantees. JavaScript `performance.now()` and `Date.now()` sometimes report zero elapsed milliseconds inside Cloudflare CPU-only execution; `runtimeInitMs: 0` and `mountMs: 0` do **not** prove zero CPU cost. Prefer the Cloudflare invocation `cpuTime` metric.

**Diagnosis:** PHP-WASM can be instantiated and execute simple PHP with SQLite inside Cloudflare, but **full WordPress startup exceeds the currently enforced per-request CPU budget**. No live peak isolate memory number was established, and successful PHP-only startup does not prove the entire WordPress workload fits inside the 128 MB memory ceiling.

## Security

- Probe is not a public PHP interpreter. Arbitrary code, filenames, paths and scripts are **not accepted**.
- A 64+ character Cloudflare secret plus explicit isolated-staging configuration is required.
- WordPress content, authentication and public media remain disabled on the deployed staging Worker.
- No real user database, credentials, or PHP output were exported.
- The secret file `.wrangler/staging-probe.key` is intentionally ignored by Git; do **not** copy it into issues, logs, PRs, or screenshots.

## Next engineering gates

1. Decide whether the project should **require an explicitly approved Paid Workers CPU budget** or re-architect WordPress execution; do not silently change account plan/billing.
2. Optimize WordPress bootstrap and measure real Cloudflare CPU; simple PHP itself already works.
3. Only after PHP startup fits CPU budget, measure peak **128 MB isolate memory**, concurrent requests, cold/warm behavior and failure outcomes.
4. Independently validate crash consistency across PHP SQLite, DO snapshots, and R2 media. Simulated fault tests are insufficient for production.
5. Keep the public staging lock and production preflight NO-GO until all gates are objectively satisfied.

Related: `docs/OPERATIONS.md` and GitHub Issues #1 and #2.
