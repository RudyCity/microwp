# microWP: private native D1 WordPress option mutation and recovery verification

Date: 2026-11-06
Status: **LOCAL D1 PROTOTYPE PASS; FULL WORDPRESS ON CLOUDFLARE FREE STILL NO-GO**
Repository: G:\project\microWP, main, existing shared checkout only.

## What changed

This stage adds private host-owned typed D1 option operations as another research milestone toward query-native WordPress storage. Nothing is mounted into the live WordPress PHP-WASM runtime or installed as wpdb/db.php. Public routes, real Cloudflare D1/R2, DNS, billing, Free-tier settings, secrets, and remote staging were not changed.

- src/php/d1-wpdb-conformance/options-mutation.ts: prepared SQL only, host-owned site scope, strict option-name/value/autoload limits, distinct opaque object capabilities for PUT and DELETE.
- One-query native D1 UPSERT uses SQLite ON CONFLICT(site_column, option_name) and **requires an actual composite UNIQUE index**. If no suitable unique constraint exists, SQLite rejects the statement and no row is inserted. A request cannot change scope or choose arbitrary SQL.
- A two-query D1 batch reads a match count and deletes only if exactly one matching scoped row exists. If zero rows match, the operation is idempotently unchanged. If two or more rows match, no deletion occurs and the response is rejected rather than silently claiming success.
- The service assumes a host-maintained site_id/options schema that is part of this private fixture, NOT a proven production WordPress schema. Real pinned WordPress SQLite Integration stores tables with separate semantics; its full schema, migrations, SQL dialect, autoload flags, default values, transactions and plugin compatibility must be verified before integration.
- All errors are generic; no token, SQL exception or site-private information is logged.
- Tests in tests/d1-wpdb-options-mutation.test.ts and tests/d1-wpdb-option-mutation-config.test.ts verify capabilities, tenant isolation, forbidden inputs, malformed D1 results, unique-constraint failure, duplicate deletes and noninstallation.
- The dedicated localhost-only Workerd Worker, config, fixture, test script and shell harness exercise real local D1 with a distinct dummy UUID ending in 0013. This fixture is NEVER deployable to production.

## Observed verification

| Check | Outcome |
| --- | --- |
| New option unit/config tests | 12 PASS / 0 FAIL / 65 assertions |
| Full bun run check | 287 PASS / 0 FAIL / 2341 assertions, TypeScript PASS |
| Local Workerd native D1 mutation | PASS: create, update, scope isolation, wrong capability denial |
| Restart and deletion | PASS: committed update survived Workerd restart; single-row delete and repeated no-op left another site intact |
| bun run canary:e2e | PASS: local DO PHP-WASM and real WordPress installer; 4,022 ms client wall for WordPress canary, **NOT CPU evidence** |
| bun run d1:absence-e2e | PASS: real local WordPress missing-D1-manifest injection refused subsequent requests with 503 and did not silently reinstall |
| bun run e2e:local | PASS: real local WordPress install/login/post/media/R2/restart/delete |
| bun run staging:build | PASS dry-run; generated PHP-WASM loader has existing direct-eval / duplicate-key bundler warnings |

The new experimental mutation fixture's SQLite table has a unique (site_id, option_name) index, and its D1 database ID is not reused from staging. The shell harness only deletes its isolated ignored .wrangler state directory. Its fixed local-only routes must never be deployed or used with real D1.

## Cloudflare Free and remaining blockers

Cloudflare Docs verified 2026-11-06:
- Workers Free ingress budget: 10ms CPU per request; DO with SQLite storage documents 30 seconds default CPU per request (the two scopes must be measured separately). https://developers.cloudflare.com/workers/platform/limits/ and https://developers.cloudflare.com/durable-objects/platform/limits/
- D1 Workers Free: 50 queries/invocation, max 100 SQL binds per statement, 500MB/database. https://developers.cloudflare.com/d1/platform/limits/
- Since 2026-09-01, D1 enforces daily Free row read/write quotas and rejects further queries after quota exhaustion. https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/

**Remote CPU and peak isolate RAM remain unverified.** The authenticated remote canary needs a legitimate operator-installed secret, appropriately approved deployment of the current version, and independent per-scope platform cpuTime/outcome plus 128MB peak-memory evidence. Never infer CPU from local wall time or HTTP success, and never bypass secret provisioning / attestation controls.

The typed option operation is only a **small subset**, not an installed wpdb or authentic WordPress query translation: full WordPress MySQL-SQL query catalog, other core tables, plugin SQL, schema constraints and collation, INSERT/UPDATE/DELETE/DDL, transactions, backup/restore and authentication remain incomplete. Live WordPress still operates through the pinned SQLite integration with the D1 snapshot bridge. No full direct-D1 WordPress install/login/editorial E2E exists yet.

R2 durability and loss-of-manifest recovery passed isolated local tests; this is not encrypted production backup, cross-resource atomicity, daily Free quota suitability or live restore validation.

## Reproduce

    bun run check
    bun run d1:option-mutation-e2e
    bun run canary:e2e
    bun run d1:absence-e2e
    bun run e2e:local
    bun run durable:build
    bun run staging:build
    bun run production:preflight  # expected to fail closed pending actual platform evidence

**Decision: keep production and public WordPress routes disabled; no paid plan changes or remote DB mutations.**
