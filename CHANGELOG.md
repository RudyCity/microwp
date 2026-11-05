# Changelog

All notable user-visible changes to microWP are documented here.

## [0.2.0-alpha.2] — Cloudflare runtime diagnostics and durability hardening (2026-11-05)

**Experimental Alpha, production NO-GO.**

- Deployed a narrowly scoped, secret-protected private Cloudflare diagnostic that never exposes public WordPress routes or arbitrary PHP execution.
- **Live Cloudflare PHP 8.4.27 + PDO SQLite canary PASS** (CPU 8 ms, wall time 10 ms).
- **Live Cloudflare WordPress installer bootstrap FAIL** with `exceededCpu` (CPU 2,010 ms, wall time 2,108 ms); startup CPU is a verified blocker. No paid plan or CPU-spending changes were made.
- Public staging gate and private probe non-disclosure tested with 10 security smoke checks.
- Durable Object media delete now occurs **after** the database snapshot commit, preventing a failed snapshot from deleting still-referenced R2 media.
- Added simulated DB/R2 failure tests; **45 unit tests** and full local WordPress E2E pass. True abrupt crash atomicity, remote memory, backups, and independent security remain unverified.
- Detailed observed results in `docs/reports/2026-11-05-cloudflare-private-runtime-canary.md`.

## [0.2.0-alpha.1] — Experimental Alpha (2026-11-05)

**Preview release only; NOT suitable for production WordPress sites or real user data.**

- Official WordPress 7.1.4 and SQLite Database Integration 3.1.3, pinned and hash-verified for reproducible builds.
- PHP 8.4.27 WebAssembly runs native inside local Cloudflare workerd.
- Lazy ZIP filesystem supplies WordPress PHP, theme templates, CSS and block metadata.
- One single-site Durable Object serializes requests and stores versioned, SHA256-verified SQLite snapshots.
- Durable per-site WordPress auth secret persists across normal Worker restarts.
- WordPress login, authenticated REST post create/update, REST media upload/delete, and persistence across restart have passed local end-to-end tests.
- R2 media write-through and bounded, signature-validated rehydration on isolate initialization.
- Login secrets and WordPress config are not bundled into static assets; native page cache disabled pending verified invalidation.
- 38 unit tests and a workerd E2E script; reproducible build in GitHub Actions.
- Explicit fail-closed production preflight and public staging safety gate.

### Known blockers for production

- Abrupt crash injection and atomic commit across PHP SQLite and Durable Object state not validated.
- Locked Cloudflare staging is now deployed with a dedicated R2 bucket, and eight public safety smoke checks pass. Remote PHP-WASM execution and live CPU/memory telemetry are still **unverified**.
- 8 MiB SQLite snapshot cap, 32 media objects and 16 MiB media hydration cap are experimental limits.
- Plugin compatibility, multipart upload and rich media transformations, authentication abuse testing, backup/restore drills, rate limiting and Cloudflare WAF not completed.
- External WordPress/public routes are blocked and should remain so until independent security sign-off.

GPL-2.0-or-later; third-party attribution in THIRD_PARTY_NOTICES.md.
