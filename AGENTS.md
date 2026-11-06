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
- Remote cache is restricted to the explicitly named `microwp_public` group, with **immutable revisioned keys**, classless unserialize and short TTL. Never send auth, users, options, transients or private data to the Worker cache; WordPress transients must stay database-backed in hybrid mode. Never cache secrets.
- The hybrid initializer uses `wp_using_ext_object_cache(false)` to retain database-backed Transients API; real local WordPress tests now cover set/get/update/expiry/delete/restart. Broader plugin/multisite behavior and remote Free CPU remain unverified. Do not enable staging.
- `wrangler.wp-cache-local-proof.jsonc` is local-only; NEVER deploy that proof Worker. Run `bun run wp-object-cache:build` (dry-run), `bun run wp-object-cache:e2e` and `bun run check`.
- Explicitly dispose returned RPC results/stubs. No paid plan, billing or public WordPress route changes.

## WordPress editorial cache invalidation E2E (2026-11-06)

- Source of truth is real PHP-WASM WordPress with its D1 SQL snapshot and R2 media. Only on opt-in `MICROWP_WORKER_CACHE_ENABLED=yes` plus a trusted Service Binding does the Durable Object invalidate `microwp_public` after successful D1/R2 persistence. Mutation methods are POST/PUT/PATCH/DELETE; failed RPC must never be reported as successful invalidation.
- New local-only `wrangler.wp-cache-editorial-local.jsonc`, scripts `wp-cache:editorial-build` and `wp-cache:editorial-e2e` must never be remotely deployed. They use an isolated local D1 namespace, R2 bucket, random demo WordPress credentials, and loopback-only fixed-key diagnostics.
- Editorial E2E covers install/login/post/category/option/media/restart and cache seed→hit→miss. This does not mean core WordPress cache groups are persisted, and now verifies native transient/site-transient parity locally, but does not verify Free Cloudflare CPU. **Do not enable live WordPress cache or public WordPress routes.**

## Hybrid WordPress Transients API parity (2026-11-06)

- Persist only the explicit `microwp_public` group via Worker cache. WordPress `transient` and `site-transient` stay database-backed. The pinned core cache initializer sets `wp_using_ext_object_cache(false)` to avoid incorrectly advertising universal object-cache persistence.
- Mount the minimal patched core initializer read-only when PHP-WASM starts; have the separate `object-cache.php` drop-in `require_once` that exact core file. Never change the shipped WordPress ZIP or write to mounted core files at request time.
- The fixed transient REST proof plugin is injected only by the localhost-only Workerd Durable Object subclass, AFTER original WordPress auth-secret and D1 initialization; its endpoints require authenticated administrator permissions and REST nonces. Never deploy the local proof.
- `bun run wp-cache:editorial-e2e` covers single/site transient set/get/update/expiry/delete/restart, public-cache invalidation and authentic WordPress editorial flows. Real Free CPU/memory, native D1 `wpdb` and broader plugin compatibility remain NO-GO blockers.

## Private Free-tier CPU, cache fault and D1 mutation controls (2026-11-06)

- Do not conflate the **Free Worker ingress 10 ms CPU** budget with **SQLite-backed Durable Object default 30-second CPU** allowance; both have a 128 MiB isolate memory ceiling. The 2026-11-05 WordPress private staging `exceededCpu` was measured on an ingress Worker code path, not a DO. Actual authenticated remote DO CPU, cold/warm PHP and peak memory are still required before claiming Free readiness.
- `bun run wp-cache:resilience-e2e` starts only self-owned, localhost-only Workers and D1/R2 fixtures. Its fault and recovery service is named `microwp-cache-resilience-local-only` and must never be deployed; production cache Worker is a different name. Never use public routes or cloud resources for fault injection.
- `bun run cpu:evidence-audit` reads only an operator-provided `.wrangler/*.jsonl` file. Never fabricate real Cloudflare CPU/memory from local Workerd timings, service logs or wall measurements; diagnostics cannot by themselves set a production GO flag.
- `src/php/d1-protocol/` has experimental, private UPDATE/DELETE only when a server-owned policy declares unique-key identity and site scope, and the host provides a distinct opaque capability for each INSERT/UPDATE/DELETE. Always use SQL bindings, forbid bulk/no-WHERE writes, and do not install the PHP read-only `db.php` prototype as an active WordPress driver. Schema uniqueness must be independently verified, because a post-execution affected-row check cannot rollback unintended updates.
- Continue full WordPress wpdb compatibility, migrations, transactions and authentication reviews before enabling production. Use English for all docs, code, tests, docstrings, commits and agent prompts, regardless of chat language.

## Chrome Delegate hardening follow-up (2026-11-06)

- Code and all documentation must be written in English. Delegates work on the **same current checkout**, never create a branch/worktree, and must report actual tool access, files changed and test outcomes. A browser-only design report is not a successful code edit.
- The isolated Free DO CPU canary now uses versioned request ID correlation between ingress and DO. The remote operator validator must only use the dedicated HTTPS canary origin, fixed modes and bounded responses, and must never claim CPU/memory measurements based on HTTP success, local wall time or user-provided unsourced figures. The remote deploy and secret setup are separate, operator-approved steps.
- The experimental WordPress `get_option()` D1 translator in `src/php/d1-wpdb-conformance/` is not installed in WordPress. It accepts only the fixed, pre-prepare options SELECT template with a typed option-name argument; it emits structured D1 protocol v1 and relies on the existing host-owned table policy/site scope. Never introduce a raw-SQL execution fallback or mark native `wpdb` production ready on a partial translation test.

## Experimental WordPress D1 autoload compatibility (2026-11-06)

- The private versioned D1 SELECT protocol supports one bounded `whereIn` predicate with at most eight distinct, non-null scalar values. Every IN column must be allowed by the trusted host table policy, never the host-owned tenant scope. All SQL values remain prepared bindings and the request size, binding count, row count, output size and offsets stay bounded.
- `src/php/d1-wpdb-conformance/options-autoload.ts` accepts only the pinned WordPress 7.1.4 `wp_load_alloptions()` SELECT expression using the known autoload values. It returns ordered 50-row pages; callers must explicitly handle full pagination, possible concurrent writes and failure on truncated results. **Never use a partial page as a complete WordPress options cache.** Do not attach this translator to live WordPress or add raw SQL fallback without independent conformance and security review.
- Always write code, comments, tests, README/AGENTS/CHANGELOG and documentation in English. Continue to use the existing checkout, without a new worktree.

## Experimental WordPress D1 verified full-read guard (2026-11-06)

- `src/php/d1-wpdb-conformance/options-complete.ts` is a **private, non-installed** compatibility helper. It must fail closed if an autoload read is incomplete, truncated, oversized, inconsistent between verification passes or unauthorized. A fixed 500-option limit with an overflow probe prevents silent truncation. The complete reader uses at most 22 D1 SELECT invocations for its two-pass verification; it must not be treated as an atomic snapshot.
- Never serve a partial result as WordPress `alloptions` or silently activate the reader in `wp-content/db.php`. WordPress 7.1.4 options compatibility, concurrent writes and true transactional consistency require a separate migration/proof plan. The live WordPress PHP-WASM/D1 snapshot runtime and remote Cloudflare staging remain unchanged. Code, tests, reports, commit text and agent instructions must be in English.
