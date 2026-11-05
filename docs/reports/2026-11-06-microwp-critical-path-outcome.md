# microWP Stage-3 critical path: WordPress CPU + native D1 — 2026-11-06

## Scope and disposition

The user asked to finish **full WordPress bootstrap under Cloudflare limits** and a **query-native WordPress D1 driver**. This stage delivered verified, isolated implementation milestones and real WordPress local evidence. **Neither production requirement is fully satisfied**, and public hosting is **NO-GO**. Explicitly distinguish runtime facts from source prototypes and local mock tests. No Cloudflare account plan, billing, DNS, production database, or public WordPress route was changed.

## Verified existing platform / remote observations

- Official Cloudflare Workers CPU budget (latest docs as of 2026-11-06): Free **10 ms CPU/HTTP request**; Paid **30 seconds default** configurable up to **300 seconds**, with **128 MB isolate memory**. See https://developers.cloudflare.com/workers/platform/limits/ and https://developers.cloudflare.com/durable-objects/platform/limits/.
- Existing private staging Cloudflare WordPress installer canary: HTTP 503 / `exceededCpu`, observed **2,010 ms actual Cloudflare invocation CPU** and ~2,108 ms wall; the earlier fixed PHP-only + PDO SQLite canary returned HTTP 200 (~8 ms invocation CPU). See `docs/reports/2026-11-05-cloudflare-private-runtime-canary.md`.
- This stage **did not** run a new Cloudflare PHP installer invocation or increase the account CPU budget. A local Workerd success is not an entitlement to more Cloudflare CPU or a proof of memory fitness.

## Stage-3 concrete work

1. **PHP `wpdb` proof-of-concept** — `src/php/d1-wpdb/db.php`, `README.md`, `tests/d1-wpdb-contract.test.ts`: opt-in, fail-closed read-only `SELECT` subset; parses SQL in PHP into a strict v1 structured envelope for an authenticated D1 callback. Does not send raw SQL to D1 or expose a public endpoint. Unsupported writes, joins, WordPress installation/DDL, transactions and other SQL must fail. Not plugged into running WordPress.
2. **Direct D1 migration proposal** — `src/storage/d1-native-migration-plan.ts`, tests and evidence report: verified the SHA-256-checked local E2E WordPress SQLite image using a bounded, offline bun:sqlite planner; supports the observed 21 tables, 29 indexes, strict/default/collation schema, type fidelity and sqlite_sequence preservation. Original bytes retained for recovery. **No D1 remote schema was changed** and no direct D1 `wpdb` E2E has passed.
3. **WordPress bootstrap profiler** — `scripts/profile-wordpress-php-bootstrap.ts` and tests. The initial profiler returned misleading HTTP 503 because Wrangler ran under Bun; Miniflare requires Node's undici dispatcher. The orchestrator corrected the launcher to `node`, after which a fixed installer GET returned **HTTP 200 twice** on loopback Workerd. First wall 3,215.701 ms, repeated wall 1,522.496 ms; WASM/ZIP/config cumulative markers 474/824/829 ms. Local worker CPU/peak RAM **not independently measured**, and wall is not a Cloudflare CPU figure.
4. **Independent readiness audit** — `docs/reports/2026-11-06-microwp-production-go-no-go-security-audit.md` and `tests/stage3-platform-gates.test.ts`. Covers Free/Paid CPU reality, 128 MB RAM, D1 SQL/transaction gaps, R2 orphan risk and secret-gated mutating diagnostics.
5. **Orchestrator-owned production preflight** — `scripts/production-preflight.ts` now separately requires `MICROWP_WORDPRESS_CPU_VERIFIED` and `MICROWP_NATIVE_D1_WPDB_VERIFIED` attestations. Neither is authorized merely by passing local tests. Production preflight remains intentionally nonzero (2/13 with no credentials/attestations).

## Why not production-ready?

- A true WordPress D1 driver must support all `wpdb` methods and SQL semantics: INSERT/UPDATE/DELETE, DDL, indexes, MySQL compatibility, prepared query escaping, transaction/isolation, error mapping, plugin SQL, and pass real WordPress installation/login/post/edit/media/restart against actual D1 tables rather than an opaque SQLite BLOB. The current PHP proof handles a small SELECT subset; the live runtime still uses PDO SQLite then snapshots the file to D1.
- The existing PHP/WASM WordPress installer requires orders of magnitude more CPU than the **10 ms Free** CPU budget. Optimizing ~0.7 ms of ZIP indexing does not resolve the observed 2,010 ms CPU `exceededCpu`. Do not advertise compliance on Free.
- The **128 MB memory ceiling** stays constant even on Paid Workers; peak memory during WASM + SQLite + media + response remains unproven.
- Direct migration must be fully reversible and tested on staging D1 with safe cutover. The local planner's `productionReady:false` and `remoteExecutionAllowed:false` MUST NOT be overridden.
- The existing R2 upload-before-D1-commit orphan window and other security/backup gates remain open.

## Recommended viable deployment decision

The realistic next integration choice requires explicit owner authorization for compute budget/architecture, not merely source edits:

- **Workers Paid, private staging only:** validate full WordPress PHP startup with a configured, approved CPU budget and peak memory, then independently implement/test full D1 `wpdb` SQL conformance. Do not change plan/billing without approval.
- **Separate PHP backend:** retain actual WordPress/PHP on a compute service or VM suited to multi-second CPU while Cloudflare Workers serves edge/cache and R2 media. D1 remains a separately engineered query API; this changes the all-in-one serverless architecture and requires deployment approval.
- **Headless/static architecture:** pre-render the public site and limit dynamic WordPress authoring to a protected backend; this is a different product shape and requires owner approval.

**No automatic plan upgrades, D1 live migration, data deletion, DNS changes or opening public WordPress were performed during this stage.**
