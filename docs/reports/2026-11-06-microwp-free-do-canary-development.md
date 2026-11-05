# microWP: Free Durable Object CPU + PHP-WASM canary — 2026-11-06

**Goal:** verify real WordPress PHP inside a **Cloudflare Durable Object on the Free plan**, instead of mistakenly benchmarking PHP in the ingress Worker. This is an isolated, authenticated developer canary, **not a public WordPress install**.

## Developed

- `src/probes/free-do-cpu.ts`: separate Worker router → SQLite-backed `MicroWPFreeCpuDO`, with exactly three allowed operations: bounded CPU loop, fixed PHP 8.4 runtime/PDO check, or fixed WordPress 7.1.4 installer GET. No user-selected file, PHP code, WordPress route, SQL, D1, R2 or database mutation.
- `src/probes/free-do-cpu-policy.ts`: strong shared-secret gate, fixed CPU sample whitelist (0, 50k, 250k, 1m, 3m iterations), bounded JSON request and fixed request paths.
- `wrangler.free-do-cpu.jsonc`: a **separate** service `microwp-free-do-cpu-probe` with **no `limits.cpu_ms`**, no D1, no R2 and no public WordPress route. The key is never stored in git.
- `scripts/free-do-cpu-local-e2e.ts`: isolated Node/Workerd local E2E; tests invalid token, invalid CPU sample, PHP+PDO and real WordPress installer **within the Durable Object**.
- `scripts/free-do-cpu-remote-probe.ts`: intentionally explicit, operator-run remote probe and private result report. It cannot deploy, update billing or change Cloudflare account configuration.

## Evidence so far

A local Workerd manual probe returned:
- Unauthenticated `POST`: HTTP **404**.
- Authenticated `cpu` with 50,000 iterations: HTTP **200**, `scope=durable-object`.
- Authenticated `php`: HTTP **200**, PHP **8.4.27**, PDO SQLite enabled. Mount metadata showed 2,565 WordPress archive entries, not a server-rendered page.
- Authenticated `wordpress`: HTTP **200**, `installerStatus=200`, `installerForm=true`, PHP/WASM actually ran WordPress installer inside `MicroWPFreeCpuDO.fetch()`; 562 lazy entries/12.7 MB files were loaded.
- **Local response timings do not establish Cloudflare Free CPU time or 128 MB memory fitness.**

**Remote Cloudflare deployment: SUCCESS, but CPU canary execution still BLOCKED.** The initial Cloudflare API request returned `Authentication error [code: 10000]`, but an idempotent retry succeeded. The independent Worker **microwp-free-do-cpu-probe** now exists at `https://microwp-free-do-cpu-probe.hrudy715.workers.dev`; bundle size 26,903.52 KiB uncompressed / 14,125.90 KiB gzip and startup reported 15 ms. It has **no billing/CPU upgrade setting and no D1/R2 binding**. Direct remote unauthenticated GET `/` and POST to the protected probe both returned **HTTP 404**. Installing the secret through the automated tools was **blocked by platform security checks**, so no authenticated remote CPU/PHP/WordPress probe has been executed, and no DO Free CPU outcome can be claimed. The local token remains ignored in `.wrangler/free-do-cpu.key`; it was never committed or shared.

## Remote verification procedure (after authorization)

1. Ensure the account is on the intended **Free** plan. Do not enable billing, Paid Workers, Paid Durable Objects or `limits.cpu_ms`.
2. Verify source and unit tests, then run `bun run canary:build` (**dry-run**).
3. The isolated service is **already deployed**. Do not redeploy unless code changes require it. Without a configured strong secret the endpoint fails closed with 404.
4. On an authorized terminal, run `bunx wrangler secret put STAGING_PROBE_KEY --config wrangler.free-do-cpu.jsonc` and enter the locally generated **ignored** secret when Wrangler prompts. Never paste the secret into chat, logs, shell history or a committed file. If automated secret provisioning is blocked, do not circumvent that restriction.
5. Set `MICROWP_CPU_PROBE_URL` to the exact canary `https://microwp-free-do-cpu-probe.<account-subdomain>.workers.dev/` and run `bun run canary:remote`. Inspect the sanitized ignored `.wrangler/free-do-cpu-remote-results.json`.
6. Obtain **actual Cloudflare per-invocation CPU time, wall time and outcome**, separating Worker ingress from Durable Object. Client wall milliseconds in the local/remote result are NOT CPU. A successful response alone cannot conclusively establish CPU limit. Re-run representative cold and warm PHP/WP cases, collect isolate heap/memory evidence, and check 128 MB before considering any public use.
7. Delete/disable the standalone probe after verification. Do not modify the existing `microwp-alpha-staging` Worker or expose WordPress admin.

### Decision gates

- **Free Durable Object CPU verified:** requires actual remote invocation outcomes and CPU traces. The Cloudflare docs currently show a default 30 s CPU request budget for Durable Objects while ordinary Workers Free are shown as 10 ms; plan-specific applicability cannot be assumed. Official sources: https://developers.cloudflare.com/durable-objects/platform/limits/ and https://developers.cloudflare.com/workers/platform/limits/.
- **WordPress production:** separately requires real Free DO repeated installer, admin, REST, native D1 `wpdb` compatibility, R2 integrity, user isolation, safe auth and memory <128MB. None is yet proven in remote Free runtime.
- **Static HTML is not a substitute:** `src/free-site/` remains disabled and unrelated to this CPU research.

**Production remains NO-GO until the above proofs succeed.**

### CI integration (2026-11-06)

The repository CI is configured to include `bun run canary:build` (dry-run) and `bun run canary:e2e`, which exercises fixed CPU work, PHP 8.4.27 + SQLite and the actual WordPress installer within a **local** Durable Object with an ephemeral CI token. No remote API secret is used by CI. At the time this document was prepared, local automated E2E returned HTTP 200 for each authorized mode and denied invalid/unauthorized requests. The project has **159 unit tests passing** (before CI confirmation of the new pipeline).
