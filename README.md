# microWP

**Real WordPress on Cloudflare Workers, powered by PHP WebAssembly.**

[![License: GPL-2.0-or-later](https://img.shields.io/badge/license-GPL--2.0--or--later-blue.svg)](LICENSE)
[![Status: Experimental Alpha](https://img.shields.io/badge/status-experimental%20alpha-orange.svg)](CHANGELOG.md)
[![CI](https://github.com/RudyCity/microwp/actions/workflows/ci.yml/badge.svg)](https://github.com/RudyCity/microwp/actions/workflows/ci.yml)

> **Experimental alpha v0.2.0-alpha.1 — NOT production-ready.** Never deploy with real accounts, production databases or live traffic. Public dynamic WordPress requests are intentionally blocked by default.

microWP runs **official WordPress 7.1.4** and **PHP 8.4.27 WebAssembly** inside the Cloudflare Workers runtime. It is not a static-site exporter or a replacement CMS. This project is **not affiliated with or endorsed by WordPress Foundation, Automattic, or Cloudflare**.

## Features verified in local workerd

- Official WordPress install, login, authenticated dashboard, REST post creation/update and theme page rendering.
- Single-site Durable Object with SQLite Database Integration 3.1.3 and versioned, SHA256-verified SQLite snapshot chunks (8 MiB preview DB limit).
- **Normal process restart** preserves WordPress installation, published/edited article, login session and public pages.
- **Local R2** upload, serve, reload and delete a PNG media file using WordPress's authenticated REST API.
- Reproducible WordPress and SQLite source downloads, pinned SHA256 checks, lazy ZIP-mounted PHP and theme/block metadata, and separate edge static assets.
- 40 unit tests plus the full WordPress local workerd E2E script. Tests and Worker bundle builds run in GitHub Actions.
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
bun run durable:build
bun run durable:dev
```

Open **http://127.0.0.1:8796/wp-admin/install.php**. Use **demo accounts and demo content only**. Local Durable Object and R2 storage is under the ignored `.wrangler/` directory.

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
| `bun run durable:dev` | Native WP + local Durable Object snapshot + R2 |
| `bun run staging:build` | Publicly gated staging Worker **dry-run**; no deployment |
| `bun run production:preflight` | Strict production go/no-go gate; currently **expected to fail** |

## Architecture

```text
HTTP request
  -> Cloudflare Worker (path guards / static assets / R2 media GET)
    -> one Durable Object per local demo site
      -> PHP 8.4 WASM / WordPress 7.1.4
        -> lazy ZIP-mounted immutable WordPress source + theme metadata
        -> SQLite Database Integration in WASM filesystem
        -> transactional versioned DB snapshots in Durable Object storage
        -> WordPress-uploaded media to/from R2
```

Limits are intentionally conservative: **8 MiB** per SQLite snapshot; **32 files** and **16 MiB** per cold-start R2 media hydration. The source is packaged in a Worker module; theme/plugin writes are disabled. Native page caching is off pending safe invalidation.

## Important production limitations

- WordPress SQLite file writes and Durable Object storage snapshots are distinct transactions; crashes in between can lose the latest change. Full crash injection/atomicity validation is **not complete**.
- Cloudflare live staging (with privately configured account resources), CPU time, and peak **128 MiB** isolate memory are **not verified**. The CLI credential has not been available to the development session.
- No production-grade backup/restore drills, rate limiting, WAF, plugin compatibility audit, cross-site auth testing, or complete image transformation/media stress tests.
- No public WordPress functionality is enabled. Static/staging safety checks cannot substitute for application and operational review.

See [CHANGELOG.md](CHANGELOG.md), [Getting started](docs/GETTING_STARTED.md), [Operations and release gates](docs/OPERATIONS.md), and [master plan](docs/plans/2026-11-05-microwp-master-plan.md).

## Contributing and license

Original microWP code is **GNU GPL-2.0-or-later**; see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Please read [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before contributing.
