# microWP contributor instructions

Workspace: G:\project\microWP. Never create a new worktree or branch without permission.
Status: public open-source experimental alpha v0.2.0-alpha.4; staging locked; NOT production-ready.

- Pinned official WordPress 7.1.4 and SQLite Integration 3.1.3 are sha256 verified; do not replace with latest without a separate audit.
- WordPress PHP runs in PHP 8.4.27 WASM via a lazy ZIP-mounted MEMFS. Never expose PHP sources or wp-config through static assets.
- WordPress uses transient PHP-WASM PDO SQLite; Cloudflare D1 is the authoritative verified SQLite image snapshot store (8MiB preview cap). A single-site Durable Object serializes requests and stores per-site auth secret. Do not describe this as native D1 SQL WordPress wpdb.
- R2 stores uploads in wp-content/uploads/ and read-only trusted static assets in wp-content/themes, plugins and mu-plugins. Executable PHP must remain in pinned immutable archives.
- Deletion journal migration 0002 atomically records R2 media deletions with each D1 snapshot; upload orphan cleanup is not yet production ready.
- No public dynamic routes. Do not deploy to Cloudflare production until production preflight is genuinely verified and operator approves.
- Never log auth tokens/salts, login cookies or real site content. Do not commit .dev.vars, vendor sources or generated binary bundles.
- After changes run: bun run check; bun run durable:build; bun run staging:build; bun run e2e:local. All staging remote mutations require orchestrator authorization and public route smoke tests.
- Cloudflare isolate memory limit 128MB including WASM. Worker package <=64MiB. Do not turn on WP page cache until edit invalidation.
- PHP WASM, WordPress, SQLite Integration are GPL-2.0-or-later. Comply with notices and source distribution.

## Delegated multi-chat development

- Delegate workers operate on non-overlapping file scopes in the same repo and `main`, without branches or worktrees. Orchestrator assigns scopes and is the only actor to commit, push or deploy.
- Workers do not claim success without tested repository changes; CPU and security research must distinguish local proxy measurements from Cloudflare platform metrics.
- Independent new modules or tests may be developed concurrently; shared entrypoints, migrations, lockfiles and releases are orchestrator-owned.
- Do not treat experimental SQL message transport as native WordPress wpdb/D1 query support. All public WordPress routes remain blocked until production gates pass.

## Stage-2 safety expectations

- The PHP request body byte cap is enforced by a bounded streaming reader, even without Content-Length. Do not regress to an unbounded `request.arrayBuffer()`.
- The R2 upload key predicate must stay consistent with the orphan audit; never permit ambiguous reserved/encoded paths or auto-delete unproven orphan candidates.
- The ZIP index fastpath and the private D1 adapter are **prototypes not yet wired to production**, and Cloudflare startup CPU plus 128 MB memory remain blocking.

## Stage-3 production-critical safeguards

- Keep active WordPress `wpdb` on the existing pinned SQLite integration until full direct-D1 SQL equivalence, migrations, rollback and real E2E pass. The Stage-3 `src/php/d1-wpdb/db.php` is an opt-in read-only proof, never automatically mounted.
- Stage-3 native migration plans are offline only with `productionReady:false` and `remoteExecutionAllowed:false`; never replay generated DDL on a live D1 database without independent review and approval.
- Do not confuse local Workerd wall timing with actual Cloudflare invocation CPU. Free Workers has a 10ms CPU request budget; do not claim WordPress production-ready without actual CPU/memory proof.

## Free-only user constraint (2026-11-06)

- User explicitly declined all paid Cloudflare use. Do **not** change account plan/billing, increase CPU limits, enable paid resources, or present Workers Paid as a prerequisite for the opted-in Free architecture.
- Do not claim full native WordPress PHP-WASM works under 10ms CPU on Workers Free; previous real installer failed with `exceededCpu`.
- Experimental Free-preview code in `src/free-site/` and `wrangler.free-preview.jsonc` is disabled and separated from deployed WordPress staging; no deployment or public WordPress cutover without approval.
- A trusted WordPress-to-static exporter is still required before the Free preview can represent a real published WordPress site. Static publication is a product tradeoff, not a transparent drop-in equivalent to live wp-admin.

## Product requirement clarified: REAL WordPress runs inside Cloudflare Workers Free (2026-11-06)

- User explicitly requires **real WordPress server-side PHP to execute on Cloudflare Workers or SQLite-backed Durable Objects**, with admin/hooks/plugins, D1 and R2. **DO NOT replace the main architecture with static HTML exports or browser-only WordPress Playground.**
- The existing `src/free-site/` static preview is a prior optional proof, **not the approved solution**. Keep it disabled and do not present it as a substitute for live WordPress.
- Cloudflare Workers Free only: no billing upgrade, paid plans, billing mutations or paid compute. DO CPU Free semantics are ambiguous in official docs; **verify with an isolated private canary** before claiming 30-second CPU.
- Research priorities: real Free DO CPU trace, PHP-WASM JSPI vs Asyncify, WordPress phase CPU/memory, OpCache/persistent runtime, direct D1 `wpdb`, R2 recovery. Respect 128 MB, 10 ms Worker ingress, and fail-closed production status.
- Read `docs/research/2026-11-06-real-wordpress-cloudflare-workers-free.md` before assigning further work. No unsupported production claims or public WordPress routes.

## Isolated Free Durable Object WordPress CPU canary (2026-11-06)

- `wrangler.free-do-cpu.jsonc` is a separate service with no D1/R2 bindings, no increased CPU limit, and no WordPress admin route. It is not the deployed `microwp-alpha-staging` service.
- The canary performs fixed, private, bounded CPU work, real PHP-WASM PDO probes and a fixed WordPress installer probe **inside Durable Object fetch()**. Never accept arbitrary PHP, SQL, WordPress paths or direct public access.
- Reproducible local verification is `bun run canary:e2e`. Successful local HTTP 200 is NOT evidence of Cloudflare Free CPU fitness.
- The actual canary Worker is deployed but not authorized for a remote probe because the secret-install action was blocked; do not bypass security checks or expose its secret. After the operator installs a key, run the explicit remote probe, then inspect actual DO invocation `cpuTime`, outcome and 128 MB isolate memory.

## Dedicated Worker Redis-like cache (2026-11-06)

- User requested Redis functionality hosted **entirely within Cloudflare Workers Free**, with **no external Redis provider**. This is a bounded internal Redis-like cache, NOT a Redis TCP/RESP server.
- The dedicated `src/worker-cache/` Worker must remain `workers_dev:false` without public routes. Other Workers access it only through trusted `REDIS_WORKER` Service Binding RPC; site IDs are server-controlled, never from untrusted HTTP input.
- The Durable Object volatile Map cache is disposable (TTL/LRU, 8 MiB/1,024 keys). Never cache auth/session/credentials, WordPress user-private data or authoritative content; a cache miss must safely fall back to the original database.
- Run `bun run worker-cache:build`, `bun run worker-cache:e2e` and `bun run check`. The Worker is standalone; no implicit PHP object-cache.php install, no billing changes and no false claim of full Redis protocol compatibility.

## Real WordPress PHP object-cache opt-in (2026-11-06)

- `src/php/worker-object-cache-dropin.ts` derives a separate, opt-in WordPress object-cache.php from the pinned core cache.php; default staging/runtime must not enable it. Only install when `MICROWP_WORKER_CACHE_ENABLED=yes` and a trusted `REDIS_WORKER` Service Binding both exist.
- Remote cache is restricted to the explicitly named `microwp_public` group, with **immutable revisioned keys**, classless unserialize and short TTL. Keep auth, users, options, transients and private data request-local until independently audited; never cache secrets.
- A WordPress drop-in changes `wp_using_ext_object_cache()` behavior and thus Transients API persistence; this implementation is **not production-ready**. Require full WordPress editorial/REST/plugin/cache invalidation regression before enabling even for private staging.
- `wrangler.wp-cache-local-proof.jsonc` is local-only; NEVER deploy that proof Worker. Run `bun run wp-object-cache:build` (dry-run), `bun run wp-object-cache:e2e` and `bun run check`.
- Explicitly dispose returned RPC results/stubs. No paid plan, billing or public WordPress route changes.
