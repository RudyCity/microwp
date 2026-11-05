# microWP

**Real WordPress on Cloudflare Workers, powered by PHP WebAssembly.**

[![License: GPL-2.0-or-later](https://img.shields.io/badge/license-GPL--2.0--or--later-blue.svg)](LICENSE)
[![Status: Experimental Alpha](https://img.shields.io/badge/status-experimental%20alpha-orange.svg)](CHANGELOG.md)
[![CI](https://github.com/RudyCity/microwp/actions/workflows/ci.yml/badge.svg)](https://github.com/RudyCity/microwp/actions/workflows/ci.yml)

> **Experimental alpha v0.2.0-alpha.4 — NOT production-ready.** Never deploy with real accounts, production databases or live traffic. Public dynamic WordPress requests are intentionally blocked by default.

microWP runs **official WordPress 7.1.4** and **PHP 8.4.27 WebAssembly** inside the Cloudflare Workers runtime. It is not a static-site exporter or a replacement CMS. This project is **not affiliated with or endorsed by WordPress Foundation, Automattic, or Cloudflare**.

## Features verified in local workerd

- Official WordPress install, login, authenticated dashboard, REST post creation/update and theme page rendering.
- **Cloudflare D1** is the durable database store: SQLite Database Integration 3.1.3 runs PDO SQLite in PHP-WASM while D1 persists versioned, SHA256-verified snapshots in transactional BLOB chunks (8 MiB preview DB cap). **This is a bridge, not yet native SQL query execution on D1.** A single-site Durable Object only serializes requests and stores the auth secret.
- **Normal process restart** preserves WordPress installation, published/edited article, login session and public pages. D1 now journals media deletions in the same transaction as each SQLite image, replaying incomplete R2 deletes after an interrupted process.
- **Cloudflare R2 wp-content** stores WordPress uploads under `wp-content/uploads/`; read-only theme/plugin static assets can be supplied from R2 with bundled files as fallback. PHP theme/plugin code remains immutable and is never executed from R2.
- Reproducible WordPress and SQLite source downloads, pinned SHA256 checks, lazy ZIP-mounted PHP and theme/block metadata, and separate edge static assets.
- 62 unit tests plus the full WordPress local workerd E2E script. Tests and Worker bundle builds run in GitHub Actions.
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

## Important production limitations

- WordPress SQLite file writes and Cloudflare D1 snapshot persistence are distinct transactions; crashes in between can lose the latest change. Full crash injection/atomicity validation is **not complete**.
- Locked Cloudflare staging gateway is **deployed**, with public route safety smoke tests passing. A secret-gated private probe confirms **PHP 8.4.27 + SQLite works live** (Cloudflare invocation: 8 ms CPU), but **WordPress bootstrap is terminated with `exceededCpu`** (observed 2,010 ms CPU). Peak **128 MB** isolate memory and full real-WordPress execution remain **unverified**; see [Cloudflare runtime evidence](docs/reports/2026-11-05-cloudflare-private-runtime-canary.md).
- Although R2 media deletion now has a crash-recoverable D1 journal, uploads can still leave orphaned objects when the DB commit fails. No production-grade backup/restore drills, rate limiting, WAF, plugin compatibility audit, cross-site auth testing, or complete image transformation/media stress tests.
- No public WordPress functionality is enabled. Static/staging safety checks cannot substitute for application and operational review.

See [D1 + R2 storage design](docs/ARCHITECTURE_D1_R2.md) and [D1 + R2 validation report](docs/reports/2026-11-05-d1-r2-validation.md), plus [alpha.4 recovery and D1 bridge results](docs/reports/2026-11-05-alpha4-journal-and-d1-bridge.md), [CHANGELOG.md](CHANGELOG.md), [Getting started](docs/GETTING_STARTED.md), [Operations and release gates](docs/OPERATIONS.md), and [master plan](docs/plans/2026-11-05-microwp-master-plan.md).

## Contributing and license

Original microWP code is **GNU GPL-2.0-or-later**; see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Please read [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before contributing.
