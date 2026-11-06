# microWP contributor instructions

Workspace: G:\project\microWP. Never create a new worktree or branch without permission.
Status: public open-source experimental alpha v0.2.0-alpha.5; staging locked; NOT production-ready.

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

## Private D1 transactional autoload read prototype (2026-11-06)

- The experimental `src/php/d1-wpdb-conformance/options-atomic.ts` uses one trusted private D1 `batch()` containing 11 prepared SELECT statements. D1 documents this batch as a SQL transaction; never replace it with separate `all()` or multi-batch reads and then claim an atomic snapshot.
- This helper is **not** an installed `wpdb` adapter. Its table and site scope are host-owned, never supplied through PHP/HTTP; projection limits prevent oversized option data from being materialized as unbounded JS strings. Refuse 501+ options, large values and malformed/partial results. Only WordPress's pinned autoload query is allowed.
- `bun run d1:atomic-e2e` runs a separate `microwp-d1-atomic-options-local-only` Workerd Worker and placeholder D1 binding at localhost; it must **never** be deployed. D1 Free has 50 query API requests per invocation; Cloudflare counts ONE D1 batch() call as ONE request toward that limit even when it executes 11 statements. Each SQL statement still has individual limits and rows-read/written usage; do not conflate statements and D1 API requests. Include daily read quotas, full WordPress SQL compatibility and remote CPU/memory in release gates.
- All code, docs, tests, comments, prompts and commit messages must be English. Existing shared checkout only; never create a new worktree.

## D1/R2 Free durability and recovery hardening (2026-11-06)

- Always keep the **independent Durable Object D1 snapshot recovery marker** separate from D1. Arm the marker before the first live WordPress D1 snapshot commit; if it exists but the D1 manifest is gone, fail with 503. Never delete the marker to bypass recovery. An empty D1 without a marker is only permitted for a truly new local WordPress installation.
- D1 Free is limited to 50 queries per Worker invocation and 100 bound SQL parameters per query. `src/storage/d1-sqlite.ts` must combine up to 32 canonical media journal entries into one prepared insert, commit the D1 image and journal atomically, and bulk-ack the journal only after **both** canonical and legacy R2 bulk deletions succeed. R2 supports arrays of up to 1,000 keys; two bulk deletes protect Free subrequest headroom.
- `bun run d1:absence-e2e` deliberately deletes a D1 manifest **only in an ignored local Workerd state** for a locally installed WordPress site. Never run this destructive fault-injection test against remote D1, Cloudflare staging, or user data.
- Local budget tests, correctness, crash recovery and dry-run bundles do **not** prove Cloudflare Free daily quotas, isolated CPU/memory, encrypted backups, full native `wpdb` or production readiness. The separately authenticated remote DO canary, operator approval and backup rehearsal remain required. All code, tests, comments, reports and commit messages must be in English.

## Private WordPress option write proof (2026-11-06)

- The non-installed host-only module src/php/d1-wpdb-conformance/options-mutation.ts performs prepared site-scoped D1 UPSERT in one query and protected DELETE in one atomic two-query batch. It requires distinct opaque operation capabilities and a trusted table/site identity; never allow PHP/HTTP to choose SQL, site identity or a capability.
- The UPSERT requires UNIQUE(site_column, option_name) in the actual D1 schema; DELETE refuses duplicate matches without destructive effects. Inputs and outputs are bounded. This is not complete WordPress wpdb, not an active driver and does not provide D1/R2/cache atomicity.
- bun run d1:option-mutation-e2e uses an isolated localhost Workerd D1 fixture (placeholder UUID ending in 0013) to verify insert, update, site isolation, restart persistence, scoped delete and a wrong capability denial. Never deploy the local proof or run it on remote/staging D1.
- Real Cloudflare Free CPU, isolate memory, daily quotas, a lossless reversible full wpdb migration and complete WordPress query conformance remain release blockers. Keep public WordPress routes disabled. Code and docs must remain English; same checkout, no new worktree.

## Offline Free DO CPU log correlation (2026-11-06)

- bun run cpu:correlate-canary correlates the private 7-task HTTP canary response with exactly one normalized ingress Worker and one SQLite Durable Object invocation per opaque UUID. Input files are fixed ignored paths under .wrangler/; it never fetches logs or changes Cloudflare account settings.
- The operator-normalized telemetry is **not authenticated** by the script: even when all reported CPU/memory values are within the nominal Free budgets, the result is diagnostics only and **never** authorizes production or public WordPress routes.
- Missing DO/ingress records, duplicates, unexpected probe modes, absent cpuTime, overbudget CPU, absent/excess memory, failed outcomes and mismatched HTTP status must not be interpreted as successful measurements. Never use client wall time as CPU.
- Independent Cloudflare platform invocations and deployment identity, trusted source provenance, operator-installed canary secret and actual Free-account eligibility still need verification. Do not use Paid-only Tail Workers or enable paid services. Source, tests and docs in English.

## Composable private D1 options store (2026-11-06)

- `src/php/d1-wpdb-conformance/options-store.ts` combines the private GET, canonical autoload SELECT, bounded UPSERT and duplicate-safe DELETE behind three independent host-owned capability objects. It snapshots the server-owned site and table configuration, and never accepts caller-supplied SQL or site IDs. The backend still uses the pinned SQLite snapshot for real WordPress; do not install this module as `wpdb`.
- Its 50-D1-query limit is deliberately **per store instance**, not complete Worker invocation accounting: GET/ALL/PUT cost one query, DELETE costs two; all attempted D1 work is budgeted before executing, and unsupported/oversized/duplicate operations fail closed.
- `bun run d1:option-mutation-e2e` now additionally exercises the composable store against a real *local* Workerd D1 binding: site isolation, fresh GET/ALL after PUT, 50-query guard, restart persistence and DELETE. This is not remote Cloudflare Free CPU/memory proof and does not permit production deployment.
- Run `bun test tests/d1-wpdb-option-store.test.ts` and the full test/build/WordPress E2E gates before committing. Full `wpdb` core/plugin parity, migration/rollback, Cloudflare CPU and memory remain NO-GO prerequisites. Keep all code and documentation in English, using the existing shared checkout and main branch.

## R36 real WordPress local query census and Free feasibility (2026-11-06)

- Keep the real WordPress PHP-WASM execution path and pinned SQLite Integration; no static-export substitution. The R36 MU-plugin, probe Worker and Wrangler config are **localhost-only**. Do not deploy them to Cloudflare, reuse staging D1/R2, or allow arbitrary HTTP SQL, PHP, paths or credentials.
- Run bun run r36:sql-census-e2e to collect only aggregate WordPress SQL shapes and per-PHP-request counts from the WordPress query filter, after the plugin loads. The plugin does **not** observe early bootstrap/direct PDO paths, arbitrary plugins, or every SQL dialect case. Regex feature labels are heuristic, never complete SQL templates.
- Run bun run r36:sql-matrix to generate docs/reports/2026-11-06-microwp-r36-sql-family-matrix.md from **sanitized** ignored Workerd evidence. Never commit .wrangler runtime snapshots, auth fixtures, raw SQL, credentials, or user content.
- R36 sampled 1,723 logical SQL statements / 18 PHP requests / 79 SQL families in the last replay (1,724 in another replay), including 6 PHP requests with more than 50 SQL statements (peak 559). These are PHP SQLite query calls, **not D1 invocations**. One-to-one forwarding into D1 would risk violating Free 50-D1-query/invocation limits; independent remote workload and batching evidence remain mandatory.
- bun run r36:bootstrap performs three independent self-owned local Workerd tests. Its min/median/max client wall time and app phase markers are **not Cloudflare CPU or peak isolate RAM**; retain all actual CPU and memory fields as null. Do not infer the SQLite Durable Object's real Free CPU limit from local results.
- Full wpdb SQL semantics, migration/rollback, plugin queries, authenticated remote Free DO CPU telemetry, peak memory, R2 quotas and production preflight remain NO-GO. Source, tests, prompts, reports and commits must be English; use the existing main checkout without branches/worktrees.

## R36 private option batch-read (2026-11-06)

- The host-only experimental src/php/d1-wpdb-conformance/options-store.ts adds getMany for 1–96 distinct, dense names in one prepared SELECT with at most 100 bound parameters; all table and site identities come from the trusted host. Reject wrong capabilities, sparse arrays, duplicates, malformed/oversized rows, and values above the 64-KiB aggregate limit; preserve absent versus empty strings using an immutable null-prototype result.
- Run bun run d1:option-mutation-e2e for local real Workerd D1 proof of site isolation, batch read-after-write, restart persistence, and the 50-query per-store ceiling. Store accounting does NOT cover other D1/R2 or Worker invocation calls. Never accept raw SQL from PHP/HTTP.
- This partial query proof is not active WordPress wpdb, not the real WordPress core schema, and not a remote Free CPU or memory measurement. Do not deploy localhost-only Workers, enable public WordPress, mutate paid billing or claim production GO. Continue on the original main checkout; all code and documentation in English.

## R36 native D1 metadata and pinned option UPSERT (2026-11-06)

- The private schema-metadata.ts only allows exact host-pinned wp_options DESCRIBE/SHOW COLUMNS and SHOW TABLES LIKE queries with a separate opaque schema capability, and returns bounded SQLite metadata, not MySQL-compatible wpdb rows. It cannot serve public/remote SQL or arbitrary schema identifiers.
- The private options-upsert-template.ts accepts only the exact pre-prepare WordPress-shaped option INSERT ... ON DUPLICATE KEY UPDATE template with three separately typed values. It uses the trusted site-scoped SQLite ON CONFLICT UPSERT and a real UNIQUE(site_id, option_name) constraint. No generic MySQL parser, source SQL interpolation or installed direct wpdb adapter.
- Cloudflare's current D1 docs count a D1 batch() API call as ONE of the Free per-Worker 50 D1 query requests, even if the batch executes multiple SQL statements. Count SQL statements, D1 API subrequests, rows read/written and daily quotas separately. The existing DELETE per-store cost of 2 is deliberately conservative statement-weighted accounting, not exact API call tracking.
- Run bun run d1:option-mutation-e2e, bun run check and bun run e2e:local, plus the two new unit suites before commit. Never deploy the local D1 fixture or imply full production wpdb, CPU/memory telemetry, migration or backups are certified. English code/docs; original main checkout, no worktree.

## R36 core posts/users/taxonomy read families (2026-11-06)

- Keep core-reads.ts, user-reads.ts and taxonomy-reads.ts private/non-installed. They execute only fixed host-owned prepared D1 SQL over the research site_id fixture. Never convert them into raw-SQL HTTP/PHP gateways or claim the artificial site_id tables match canonical WordPress schema/multisite behavior.
- posts: 1–16 IDs, full bounded core row, one query. postmeta: <=32 post IDs, <=256 ordered rows. users: auth-only lookup by bounded login returning only ID/user_login/user_pass/user_status behind its own capability; never log password hashes. usermeta: <=32 user IDs and <=256 rows behind a separate capability. taxonomy: one fixed DISTINCT three-table JOIN for <=16 object IDs and <=8 explicit taxonomy names.
- Nullable meta uses a sentinel to distinguish genuine NULL from invalid/oversized data; never silently reinterpret overlarge values as absent. All operations fail closed on unexpected result columns, ordering, IDs, duplicated identities, overflow, or wrong capabilities.
- bun run d1:option-mutation-e2e validates all new read families on real localhost Workerd D1 and after restart. Also run all focused unit suites, bun run check, bun run e2e:local and dry-run builds. Do not deploy the local proof Worker.
- Native wpdb activation still requires canonical schema mapping, safe writes, comments/query/count/search coverage, role/auth integration, reversible migration, backups/security, real remote Free D1/R2 quotas and Cloudflare CPU/memory evidence. Production remains fail-closed.
