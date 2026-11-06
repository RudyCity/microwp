# microWP — Cloudflare Free D1/R2 write-budget and missing-snapshot recovery hardening

Date: 2026-11-06. Status: **implemented, local tests and real Workerd fault-injection passed; production NO-GO**.

## Purpose

microWP must serve real WordPress 7.1.4 through PHP-WASM in a SQLite-backed Cloudflare Durable Object. WordPress SQLite bytes currently persist as checksummed chunks in D1 and media objects live in R2. This is not yet a native WordPress `wpdb` D1 driver.

Two production-safety gaps existed: a maximum-size database update with 32 deferred media removals could exceed Free invocation query/subrequest budgets, and losing an already-provisioned site's D1 manifest could look like a fresh WordPress install on DO restart.

Cloudflare documentation, checked 2026-11-06:
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/): Workers Free has 50 D1 queries per invocation, a 500 MB D1 database cap, and 100 bound parameters per SQL query.
- [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/): `R2Bucket.delete(string | string[])` supports up to 1,000 keys per call.
- [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/): SQLite-backed DO default per-request CPU is 30 seconds; memory and account-level Free quotas require independent verification.

## Implemented D1/R2 budget changes

`src/storage/d1-sqlite.ts` now:
1. Packs up to 32 validated, canonical WordPress media-deletion journal paths into **one** parameterized `INSERT OR IGNORE ... VALUES (?,?), ...` (64 binds, below 100). D1 snapshots, manifest update, old-chunk deletion and the journal remain in **one atomic D1.batch() transaction**.
2. Refuses a write if its command count plus the preceding manifest SELECT would exceed the 50-query Free cap.
3. Deletes up to 32 canonical R2 objects in **one R2 bulk call**, then deletes their 32 legacy-alpha aliases in a second bulk call, rather than issuing up to 64 individual R2 operations.
4. Acknowledges the completed media journal in **one bound D1 DELETE** after **both** R2 operations succeed. If a bulk operation fails after any partial deletion, the journal remains durable and all deletes can be retried idempotently on a subsequent startup.

The worst-case tested **new site / 8 MiB SQLite image / 32 deferred media deletes** requires 37 D1 operations plus two R2 calls. A revision update with an old snapshot also stays below the D1 query ceiling. The existing 8 MiB SQLite cap, 32-media cap and per-request WordPress memory/CPU caps remain unchanged.

This is a **test-based budget for the specific storage write-and-drain path**, not a complete measurement of every possible WordPress invocation or a proof of daily Free quotas. Do not infer production fitness from mocked D1/R2 subrequest counts.

## Independent snapshot-existence guard

`src/storage/d1-absence-guard.ts` introduces a separate, non-secret DO storage marker: `microwp:private:d1-snapshot-expected:v1`.

- An empty site with **no marker and no D1 snapshot** may use the normal WordPress installation process.
- On a cold start with an existing D1 snapshot, the marker is armed **before** PHP loads.
- On the first write to a new site, the marker is persisted in DO storage **before** the D1 snapshot is committed.
- On restart, if the marker exists but the D1 manifest is absent, corrupted or inaccessible, the Durable Object fails closed with HTTP 503. It **never silently bootstraps a blank WordPress site**.
- If the marker's value is unexpectedly malformed, initialization fails closed.
- If a crash happens after the marker is persisted but before the first D1 snapshot commit, operator recovery may be necessary. This favors refusing further writes over accidentally recreating a site.

The marker is **not a backup**. It does not recover missing D1 bytes, survive deletion of the independent DO instance/storage by itself, guarantee external transaction atomicity between D1 and DO storage, or replace encrypted backup and restore rehearsals.

## Actual local tests

The new `tests/d1-free-query-budget.test.ts`, `tests/d1-snapshot-absence-guard.test.ts`, and `tests/d1-recovery-local-config.test.ts` cover:

- 8 MiB snapshot and 32 media deletes within the Free D1/R2 request budget.
- Entire old D1 image and journal rolling back when an injected SQL transaction fails.
- An 8 MiB revision update and canonical/legacy R2 media bulk deletion.
- Failed second R2 bulk operation retaining all journal entries.
- Wrong or missing recovery marker and missing previously-installed snapshot failing closed.
- Media path validation, limit enforcement, and no remote staging resource re-use.

`scripts/d1-absence-recovery-local-e2e.sh` runs **real WordPress/PHP-WASM** locally on Workerd, installs WordPress, logs in, publishes a post, confirms persistence, **stops only its own local Worker**, deletes only the manifest in its isolated local D1 state, restarts the Worker, and confirms `HTTP 503 DB_PERSISTENCE_FAILED` followed by `HTTP 503 DB_STORAGE_UNAVAILABLE`. The ordinary WordPress installer must not reappear. It never runs `--remote` or changes Cloudflare staging.

## Reproduce

```bash
bun run check
bun run d1:absence-e2e
bun run e2e:local
bun run wp-cache:editorial-e2e
bun run staging:build        # dry-run only
bun run production:preflight # expected to fail until real external evidence exists
```

## Recovery and backup runbook (operator-controlled)

1. Keep the site behind the **private gate** and stop writes; preserve the independent DO recovery marker. Never clear it to bypass `DB_PERSISTENCE_FAILED`.
2. Verify the D1 manifest, its revisions/chunks and SHA-256. Locate a verified recoverable point via [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) (Free has 7-day retention) or separately maintained backups.
3. Export and inspect a **consistent D1 snapshot** and related R2 media state under an authorized maintenance workflow; backups may contain WordPress user data and auth secrets, so encrypt and keep them **outside Git and public storage**.
4. Rehearse recovery into a **new isolated D1/R2 environment** first. Check WordPress login, current articles, options, media, deletion journal, authorization and the original site identity before approving any production restoration.
5. Confirm remote Free CPU (10 ms ingress vs 30-second SQLite DO), isolate peak memory, D1 query/subrequest budget, daily D1 quotas and R2 traffic on authentic Cloudflare invocations.
6. Require explicit operator approval for any production deployment or rollback; no unattended restore, secret upload or DNS cutover is performed by these tests.

**Production decision:** local D1/R2 storage hardening gate PASS; full production is **NO-GO** pending live resource evidence, verified backup/recovery and native WordPress `wpdb` conformance.
