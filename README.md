# microWP

**Real WordPress on Cloudflare Workers, powered by PHP WebAssembly.**

[![License: GPL-2.0-or-later](https://img.shields.io/badge/license-GPL--2.0--or--later-blue.svg)](LICENSE)
[![Status: Experimental Alpha](https://img.shields.io/badge/status-experimental%20alpha-orange.svg)](CHANGELOG.md)
[![CI](https://github.com/RudyCity/microwp/actions/workflows/ci.yml/badge.svg)](https://github.com/RudyCity/microwp/actions/workflows/ci.yml)

> **Experimental alpha v0.2.0-alpha.5 — NOT production-ready.** Never deploy with real accounts, production databases or live traffic. Public dynamic WordPress requests are intentionally blocked by default.

microWP runs **official WordPress 7.1.4** and **PHP 8.4.27 WebAssembly** inside the Cloudflare Workers runtime. It is not a static-site exporter or a replacement CMS. This project is **not affiliated with or endorsed by WordPress Foundation, Automattic, or Cloudflare**.

## Features verified in local workerd

- Official WordPress install, login, authenticated dashboard, REST post creation/update and theme page rendering.
- **Cloudflare D1** is the durable database store: SQLite Database Integration 3.1.3 runs PDO SQLite in PHP-WASM while D1 persists versioned, SHA256-verified snapshots in transactional BLOB chunks (8 MiB preview DB cap). **This is a bridge, not yet native SQL query execution on D1.** A single-site Durable Object only serializes requests and stores the auth secret.
- **Normal process restart** preserves WordPress installation, published/edited article, login session and public pages. D1 now journals media deletions in the same transaction as each SQLite image, replaying incomplete R2 deletes after an interrupted process.
- **Cloudflare R2 wp-content** stores WordPress uploads under `wp-content/uploads/`; read-only theme/plugin static assets can be supplied from R2 with bundled files as fallback. PHP theme/plugin code remains immutable and is never executed from R2.
- Reproducible WordPress and SQLite source downloads, pinned SHA256 checks, lazy ZIP-mounted PHP and theme/block metadata, and separate edge static assets.
- 144 unit tests plus the full WordPress local workerd E2E script. Tests and Worker bundle builds run in GitHub Actions.
- Fail-closed security controls: no public native WP routes, blocked config/secret paths, media file signature checks, request limits, disabled WP core/plugin auto-edit, and disabled dynamic page cache.

## Run locally

Install Bun 1.4.x, Python 3.12+ and Node.js 24+. You need an Internet connection to fetch the verified source archives.

```bash
git clone https://github.com/RudyCity/microwp.git
cd microwp
bun install --frozen-lockfile
bun run sources:fetch
bun run wordpress:prepare
bun run check
bunx wrangler d1 migrations apply microwp-local-dev-db --local --config wrangler.durable.jsonc
bun run durable:build
bun run durable:dev
```

Open **http://127.0.0.1:8796/wp-admin/install.php**. Use **demo accounts and demo content only**. Local D1, Durable Object auth state and R2 emulator data are under ignored `.wrangler/`. The D1 config is local-only; do not deploy the local Wrangler config to your account.

### Automated end-to-end test

```bash
bun run e2e:local
```

This provisions a separate **local test state**, installs WordPress with generated demo credentials, logs in, publishes/edits an article, uploads a PNG through WordPress REST, restarts workerd, verifies persisted content/auth/media, and deletes the PNG. It makes **no** real Cloudflare account calls and does **not** publish a site.

### Runtime modes

| Command | Use |
| --- | --- |
| `bun run dev` | Small edge router only; PHP disabled |
| `bun run wasm:dev` | Isolated PHP-WASM runtime probes |
| `bun run native:dev` | Native PHP-WASM + WP with **ephemeral** local SQLite |
| `bun run durable:dev` | Native WP + locally emulated **D1 SQLite snapshot store** + Durable Object request serialization + R2 |
| `bun run staging:build` | Publicly gated staging Worker **dry-run**; no deployment |
| `bun run production:preflight` | Strict production go/no-go gate; currently **expected to fail** |

## Architecture

```text
HTTP request
  -> Cloudflare Worker (path guards / static assets / R2 media GET)
    -> one Durable Object per local demo site
      -> PHP 8.4 WASM / WordPress 7.1.4
        -> lazy ZIP-mounted immutable WordPress source + theme metadata
        -> SQLite Database Integration (ephemeral PDO SQLite in WASM)
        -> transactional, SHA256-verified SQLite image chunks in Cloudflare D1
        -> WordPress media uploads + read-only static theme/plugin overlay in R2
```

Limits are intentionally conservative: **8 MiB** per SQLite snapshot; **32 files** and **16 MiB** per cold-start R2 media hydration. The source is packaged in a Worker module; theme/plugin writes are disabled. Native page caching is off pending safe invalidation.

## Direct D1 driver feasibility (experimental only)

A secret-protected Cloudflare diagnostic proved that PHP-WASM `post_message_to_js()` can call an asynchronous Worker D1 query and receive the result back in PHP. This is an **API capability proof**, **not** a native WordPress D1 SQL driver or a general-purpose SQL gateway. See [native D1 adapter design](docs/plans/2026-11-05-native-wordpress-d1-sql-adapter-gates.md).

## Live Cloudflare staging (locked)

[View the staging health endpoint](https://microwp-alpha-staging.hrudy715.workers.dev/__microwp/health). WordPress homepage, admin, login, REST routes, media and static assets deliberately return HTTP 503 to public requests. This endpoint is **not a usable WordPress site**. Run `MICROWP_STAGING_URL=https://microwp-alpha-staging.hrudy715.workers.dev bun run staging:smoke` to verify the lock. No custom DNS or production traffic was switched.

## Delegated experimental hardening (unreleased)

Three isolated ChatGPT Delegate workstreams have produced **standalone prototypes only**:

- A strict private D1 SQL protocol (structured SELECT/INSERT, mandatory Worker-owned scope, bound values and bounded responses); **not** a native WordPress wpdb driver.
- A local, checksum-verified WordPress ZIP/bootstrap profiling script; measured local Bun CPU/RSS **must not** be confused with actual Cloudflare PHP-WASM CPU or isolate memory.
- A conservative R2 orphan audit module that verifies a D1 snapshot and creates a **dry-run report only**. It requires an exhaustive trusted WordPress media-reference extractor and never deletes any object.

See [multi-chat integration evidence](docs/reports/2026-11-05-microwp-delegate-orchestration.md) and [bootstrap bottleneck report](docs/reports/microwp-bootstrap-profile-and-optimization.md). These prototypes are not wired into public routes, do not change production readiness, and need additional conformance/security tests before activation.

## Stage-2 parallel Delegate engineering (unreleased)

Four distinct ChatGPT Delegate tabs completed separate, file-scoped tasks, with all tabs retained. The result includes a **private D1 runtime adapter prototype**, a measured but **not enabled** fast ZIP metadata indexer, a conservative **offline-only WordPress media reference scan** that never authorizes deletion, and an independent security audit. In response to that audit, PHP request bodies now use a bounded stream reader rather than unbounded `arrayBuffer()` and R2 uploads use a canonicalized key policy. No public WordPress routes were opened.

See [Stage-2 orchestration and test results](docs/reports/2026-11-05-microwp-stage2-orchestrated-delivery.md) and [independent security findings](docs/reports/2026-11-05-microwp-stage2-security-and-e2e-audit.md). These modules remain experimental. In particular, **the direct WordPress-to-D1 `wpdb` driver does not exist yet**, and the live WordPress installer CPU blocker remains unresolved.

## Stage-3 WordPress CPU and query-native D1 work (experimental)

The CPU/DB critical-path implementation is recorded in [the detailed Stage-3 outcome](docs/reports/2026-11-06-microwp-critical-path-outcome.md):

- A new **opt-in, read-only** PHP `db.php` query-transport proof demonstrates a guarded `SELECT` subset via PHP→JavaScript. It is **not** installed in WordPress and does **not** support production `wpdb` methods or transactional SQL.
- A new **offline** WordPress SQLite-to-query-native-D1 migration planner preserves full SQL schema/index/sequence fidelity in a local roundtrip (real E2E snapshot: 21 tables / 29 indexes). It is intentionally marked `productionReady:false`, `remoteExecutionAllowed:false` and does not run on remote D1.
- The PHP bootstrap profiler now launches Wrangler with **Node.js** instead of Bun/Miniflare. First local Workerd installer HTTP 200: **3,215.701 ms wall**; repeated HTTP 200: **1,522.496 ms wall**. Neither is a Cloudflare CPU or memory measurement.
- Independent Cloudflare CPU and native D1 `wpdb` readiness gates are required by the production preflight. The prior **real Cloudflare** WordPress installer probe was still `exceededCpu` (~2,010 ms CPU). Cloudflare Workers Free allows 10 ms per request; this architecture has not been shown to fit that budget.

**Production NO-GO persists.** No plan/billing or staging/public route change was made in Stage-3. The existing D1-backed SQLite snapshot adapter remains the active implementation.

> **Product direction clarification (2026-11-06):** The user requires **real server-side WordPress PHP on Cloudflare Workers Free**, not static HTML publication. The Free static preview documented below is an **unused, disabled experiment**, not the planned production replacement. See [research on running actual WordPress in Workers Free](docs/research/2026-11-06-real-wordpress-cloudflare-workers-free.md) for the Durable Objects CPU-limit ambiguity, JSPI/OpCache possibilities and verification gates. Full WordPress remains production NO-GO.

## Redis-like cache inside Cloudflare Workers (no Redis server)

A dedicated **Cloudflare Worker + one Durable Object per site** now implements the needed internal Redis-style cache operations (`GET`, `SET`, `ADD`, `DEL`, `INCR`, `EXPIRE`, `TTL` and group/site invalidation). It uses **Service Binding RPC exclusively**; the dedicated Worker does not expose a public HTTP route or a TCP Redis endpoint. **No Upstash, external database or paid plan.**

- `bun run worker-cache:build` — dry-run only.
- `bun run worker-cache:e2e` — two real local Worker processes communicating via Service Binding and site-specific Durable Objects.
- `wrangler.worker-cache.jsonc` — isolated Worker uploaded to Cloudflare as `microwp-worker-cache`; deployment reports **No targets deployed** (`workers_dev:false`, no public routes). A separate example binding is at `wrangler.worker-cache-binding.example.jsonc`.
- Hard limit per site: **8 MiB logical cache, 1,024 keys, 64 KiB/string, TTL up to one day**. Cache is volatile, LRU, and may be lost at any time on DO eviction; WordPress data must remain authoritative in D1.

This is **not** a full Redis engine, Redis TCP/RESP protocol or a drop-in replacement for the WordPress Redis Object Cache plugin. A PHP-WASM object-cache bridge and correct WordPress invalidation still need separate validation before enabling the cache for live WordPress. This does not itself solve WordPress `exceededCpu`. Details: [Worker-only Redis-like cache design and safety](docs/reports/2026-11-06-microwp-worker-only-redis-cache.md).

## Development update: Free Durable Object CPU scope, resilient cache and bounded D1 mutations

Three separate non-production gates have advanced:

- **CPU scope:** Cloudflare's default per-request CPU budget is **10 ms for a Free ingress Worker** but **30 seconds for a SQLite-backed Durable Object**, with **128 MiB memory per isolate**. The earlier 2,010 ms `exceededCpu` private canary ran `runNativeStagingProbe()` in the **ingress Worker**, not the DO. It does not establish that WordPress exceeds the Free SQLite DO budget. The separate authenticated DO canary still requires actual remote CPU/memory evidence. `bun run cpu:evidence-audit` accepts only bounded, operator-supplied evidence under ignored `.wrangler/`; never substitute local wall time for CPU.
- **Cache resilience:** `bun run wp-cache:resilience-e2e` uses two **local-only** Worker cache implementations: one always throws on RPC; after real WordPress D1 writes are verified, it is replaced by the healthy internal cache Worker. The same isolated WordPress site recovers cache hit/invalidation while native transients remain database-backed. No real Cloudflare resources are touched.
- **D1 experimental mutations:** private structured `UPDATE` and `DELETE` now enforce unique-key equality, immutable table/site policy and distinct opaque host write capabilities with bound D1 SQL arguments. This is **not installed** into WordPress `wpdb`; no live D1 WordPress query migration has occurred.

See [Free CPU scope audit](docs/reports/2026-11-06-microwp-free-cpu-scope-audit.md), [WordPress cache failure/recovery](docs/reports/2026-11-06-microwp-worker-cache-failure-recovery.md), and [experimental D1 mutation security](docs/reports/2026-11-06-microwp-d1-experimental-mutation-safety.md). All features remain on Cloudflare Free; **production still NO-GO**.

## Hybrid WordPress object cache with native database-backed transients

In opt-in mode, only immutable, revisioned `microwp_public` keys use the internal Worker cache. WordPress's ordinary `transient` and `site-transient` groups use the native database-backed options path. The pinned WordPress cache initializer sets `wp_using_ext_object_cache(false)` because this is not a universal persistent object cache. The only patched core source is mounted read-only into the isolated PHP-WASM filesystem; the original WordPress ZIP is never modified.

Full local WordPress tests verify transient set/get/update, TTL expiry, deletion, anonymous access rejection and survival across Worker restart, alongside editorial REST and R2 media. Cloudflare staging remains unchanged. See [hybrid transient parity](docs/reports/2026-11-06-microwp-wordpress-transients-hybrid-parity.md).

## WordPress editorial + Worker cache: post-commit invalidation (local proof)

The real PHP-WASM WordPress + D1/R2 site now supports **opt-in post-commit invalidation** of the separately hosted, internal Redis-like Worker cache. On HTTP POST/PUT/PATCH/DELETE, the Durable Object only clears derived `microwp_public` cache keys **after** authoritative D1 snapshot and media journal commit; the API call does not invent success if the Service Binding is unavailable. Immutable, content-revision-derived keys remain mandatory because invalidation is best-effort.

- `bun run wp-cache:editorial-build` — isolated local-only dry-run, no deployment.
- `bun run wp-cache:editorial-e2e` — two Workers in local Workerd, with real WordPress installer, login, REST create/update post/category/site title, R2 upload/delete, cache seed→hit→miss on writes, restart preservation and D1 journal check.
- The existing Cloudflare staging **still does not enable this cache** and public WordPress routes remain locked. Broader plugin-specific transient compatibility and actual Cloudflare Free CPU/RAM are pending, so production is NO-GO.

See [full WordPress editorial cache invalidation E2E evidence](docs/reports/2026-11-06-microwp-wordpress-cache-editorial-invalidation.md).

## WordPress `wp_cache_*` → dedicated Worker cache (opt-in, local proof)

The PHP-WASM runtime now supports a **disabled-by-default** object-cache drop-in. It preserves WordPress's pinned `wp_cache_*` API and sends only the explicit, immutable, revision-keyed `microwp_public` group to the internal cache Worker via PHP→JavaScript→Service Binding. Other WordPress cache groups stay request-local; no user/session/private data is sent to the Worker cache. The caller never accepts an HTTP-supplied site identity.

- `bun run wp-object-cache:build` is a dry-run only. `bun run wp-object-cache:e2e` proves cross-request cache hits, invalidation and real WordPress installer execution **inside a local Durable Object**, while public admin routes remain blocked.
- The existing staging does **not** have the Service Binding or the opt-in flag, and was not changed. This is not a general Redis protocol or full WordPress Redis Object Cache drop-in.
- Native Transients API passes in local Workerd; broader plugin compatibility and actual Free CPU/RAM still require verification before staging activation. **Production remains NO-GO.**

See [object-cache bridge implementation, limitations and evidence](docs/reports/2026-11-06-microwp-wordpress-object-cache-bridge.md).

## Real WordPress inside Free Durable Object — protected CPU canary

**The production target remains real WordPress/PHP server-side on Cloudflare Free, NOT a static-HTML replacement.** A separate isolated service is now available for verifying the CPU limit of the actual Durable Object invocation:

- `src/probes/free-do-cpu.ts` executes fixed CPU samples, PHP 8.4 + SQLite, and a real WordPress 7.1.4 installer inside a **SQLite-backed Durable Object**. The ingress Worker only authenticates and forwards; no route executes PHP without a private secret.
- `bun run canary:build` is a dry-run, and `bun run canary:e2e` runs local Workerd against the actual PHP-WASM installer. Only 5 bounded CPU iteration counts are possible; the endpoint cannot run arbitrary PHP, SQL, or WordPress paths.
- Isolated Cloudflare canary service `microwp-free-do-cpu-probe` is deployed but **locked**: root and unauthenticated private probe both return HTTP 404. Automated secret provisioning was blocked by security controls; real Free CPU measurements remain **unverified** until a secret is installed by the operator.
- `bun run canary:remote` is a separately authenticated operator tool; it does **not** deploy. CPU must be determined from Cloudflare invocation logs, not the client's wall time.

See [full canary evidence and safe operator setup](docs/reports/2026-11-06-microwp-free-do-canary-development.md). The previously recorded WordPress `exceededCpu` happened in **Worker ingress**; it has not yet established the actual Durable Object CPU limit on Free. WordPress production remains **NO-GO** until the remote canary, memory test and `wpdb` E2E pass.

## Workers Free only — optional static publishing preview

**No paid plan is required or authorized.** The 10 ms Workers Free CPU limit makes the current full PHP-WASM WordPress bootstrap unsuitable for public requests. An **experimental, disabled-by-default alternative** is now implemented separately:

- `src/index-free.ts` / `src/free-site/public-edge.ts`: publicly readable pre-rendered static pages via Cloudflare ASSETS (no PHP), fixed **read-only native D1 SQL** for the approved published-post index, and bounded R2 `wp-content/uploads/` media GETs. WordPress admin/login/PHP and writes are blocked.
- `wrangler.free-preview.jsonc`: isolated **local placeholder** D1/R2 bindings, `workers_dev:false`, `MICROWP_FREE_PREVIEW_MODE=disabled` by default, and no increased CPU limit. `migrations_free/` contains only a local demo schema. The existing staging and WordPress runtime remain untouched.
- `bun run free:build` is a **dry-run only**; `bun run free:dev` launches a disabled local preview. See [Workers Free-only architecture and test instructions](docs/plans/2026-11-06-microwp-workers-free-only-rearchitecture.md).

**Tradeoff:** full WordPress authoring would run offline/local or on a separately arranged compute backend; Cloudflare serves only the published output. A safe real-WordPress static export/publish pipeline is **not implemented yet**. The Free mode is a research prototype, not a ready site or proof of 10 ms Cloudflare CPU fitness. Never deploy or activate it as a replacement for full WordPress without explicitly accepting this architecture.

## Important production limitations

- WordPress SQLite file writes and Cloudflare D1 snapshot persistence are distinct transactions; crashes in between can lose the latest change. Full crash injection/atomicity validation is **not complete**.
- Locked Cloudflare staging gateway is **deployed**, with public route safety smoke tests passing. A secret-gated private probe confirms **PHP 8.4.27 + SQLite works live** (Cloudflare invocation: 8 ms CPU), but **WordPress bootstrap is terminated with `exceededCpu`** (observed 2,010 ms CPU). Peak **128 MB** isolate memory and full real-WordPress execution remain **unverified**; see [Cloudflare runtime evidence](docs/reports/2026-11-05-cloudflare-private-runtime-canary.md).
- Although R2 media deletion now has a crash-recoverable D1 journal, uploads can still leave orphaned objects when the DB commit fails. No production-grade backup/restore drills, rate limiting, WAF, plugin compatibility audit, cross-site auth testing, or complete image transformation/media stress tests.
- No public WordPress functionality is enabled. Static/staging safety checks cannot substitute for application and operational review.

See [D1 + R2 storage design](docs/ARCHITECTURE_D1_R2.md) and [D1 + R2 validation report](docs/reports/2026-11-05-d1-r2-validation.md), plus [alpha.4 recovery and D1 bridge results](docs/reports/2026-11-05-alpha4-journal-and-d1-bridge.md), [CHANGELOG.md](CHANGELOG.md), [Getting started](docs/GETTING_STARTED.md), [Operations and release gates](docs/OPERATIONS.md), and [master plan](docs/plans/2026-11-05-microwp-master-plan.md).

## Contributing and license

Original microWP code is **GNU GPL-2.0-or-later**; see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Please read [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before contributing.
