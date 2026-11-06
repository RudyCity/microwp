# microWP Remaining Work to Production

Date: 2026-11-06
Repository: `G:\project\microWP`
Branch: `main`
Baseline commit reviewed: `696730b`
Current release decision: **NO-GO FOR PUBLIC PRODUCTION WORDPRESS**

## Purpose

This document is the single backlog of what is still missing before microWP can honestly claim:

1. authentic WordPress 7.1.4 server-side execution on Cloudflare Free,
2. query-native D1 persistence instead of opaque SQLite snapshot persistence,
3. R2-backed WordPress media,
4. correct WordPress authentication/admin/editorial behavior,
5. recoverable migration, backup and rollback,
6. verified Cloudflare Free CPU, memory and quota compliance,
7. production security and operator release approval.

Local proofs are valuable but do not satisfy remote platform or production evidence gates.

---

## Current verified baseline

The following work is already implemented and locally verified.

### Runtime / WordPress

- Authentic WordPress 7.1.4 and PHP-WASM run locally under Workerd.
- WordPress installation, login, dashboard, REST publishing/update, media upload/delete and restart persistence pass local E2E.
- D1-backed SQLite snapshot persistence remains the active WordPress database path.
- R2 media write-through, rehydration and deferred deletion journal behavior pass local E2E.
- Durable and staging bundles build successfully in dry-run mode.

### D1 research coverage

Private, non-installed query-native D1 proofs now cover:

- bounded `wp_options` reads,
- autoload reads,
- bounded option batch reads,
- option UPSERT,
- fixed schema metadata inspection,
- `wp_posts` batch reads,
- `wp_postmeta` batch reads,
- minimal `wp_users` auth lookup,
- `wp_usermeta` batch reads,
- taxonomy three-table JOIN reads,
- bounded post INSERT and UPDATE,
- postmeta INSERT / UPDATE / DELETE,
- approved comment COUNT,
- ordered comment reads,
- comment INSERT,
- commentmeta batch reads.

All of these are capability-gated, site-scoped research helpers. They are **not** connected to the active WordPress `wpdb` path.

### Latest local verification

- Full suite: **364 PASS, 0 FAIL, 2,880 assertions across 64 test files**.
- Local Workerd D1 proof: PASS before and after restart.
- Authentic WordPress local E2E: PASS.
- Durable/staging dry-run build: PASS.
- Production preflight: **2 / 14 gates PASS**.

---

# P0 — hard production blockers

These must be solved before any public production launch.

## P0.1 Real query-native WordPress `wpdb` integration

**Status: NOT DONE**

The active WordPress runtime still uses SQLite Integration inside PHP-WASM and persists opaque SQLite database bytes through D1. The typed D1 helpers are research modules only.

Required work:

- Build an actual WordPress database adapter that routes supported `wpdb` operations to D1.
- No generic unsafe raw-SQL passthrough.
- No guessed SQL parser based only on categorical R36 census output.
- Preserve WordPress `wpdb` behavior for:
  - `prepare()`,
  - escaping,
  - result modes,
  - `rows_affected`,
  - `insert_id`,
  - `last_error`,
  - `num_rows`,
  - transactions/errors,
  - duplicate-key behavior,
  - NULL semantics.
- Add explicit unsupported-query failure instead of falling back silently.
- Prove every production-relevant query actually reaches D1 query API rather than the SQLite snapshot.

**Definition of done:** a real WordPress install/admin/editorial/media E2E runs with SQLite snapshot persistence disabled and query-level D1 enabled, with no hidden fallback.

---

## P0.2 Exact WordPress SQL-template corpus

**Status: NOT DONE**

R36 intentionally stores categorical SQL shapes only. It does not retain exact WordPress SQL templates.

Required work:

- Build a local-only privacy-safe SQL template collector.
- Strip literals/content/passwords/cookies/secrets.
- Preserve exact structural SQL needed for compatibility:
  - table names,
  - selected columns,
  - JOIN shapes,
  - WHERE operators,
  - GROUP/ORDER/LIMIT,
  - INSERT column order,
  - UPDATE field sets,
  - `ON DUPLICATE KEY UPDATE`,
  - SHOW/DESCRIBE variants.
- Collect templates for:
  - fresh install,
  - login/logout,
  - dashboard,
  - publish/update/delete post,
  - revisions/autosave,
  - media,
  - comments,
  - users,
  - taxonomy,
  - settings,
  - cron,
  - plugin activation/deactivation.
- Generate a deterministic compatibility corpus and tests.

**Definition of done:** every query emitted by the supported WordPress workflow maps to an explicit tested adapter operation or an intentional hard failure.

---

## P0.3 Canonical WordPress schema on D1

**Status: NOT DONE**

Current D1 research fixtures use an artificial `site_id` column. That is useful for isolation tests but is not canonical WordPress schema.

Required work:

- Define canonical WordPress 7.1.4 D1 schema.
- Decide single-site versus multisite mapping.
- Preserve expected primary/unique/index behavior.
- Map MySQL types/collations/index prefixes to SQLite/D1 semantics.
- Verify:
  - `wp_options`,
  - `wp_posts`,
  - `wp_postmeta`,
  - `wp_users`,
  - `wp_usermeta`,
  - taxonomy tables,
  - comments/commentmeta,
  - links,
  - termmeta.
- Support plugin-created tables safely.
- Version schema and migrations.

**Definition of done:** WordPress install creates or validates the intended D1 schema without research-only columns or manual fixtures.

---

## P0.4 ID generation / `insert_id` semantics

**Status: NOT DONE**

Current post/comment mutation proofs use explicit fixture IDs.

Required work:

- Implement safe WordPress-compatible auto-generated IDs.
- Return correct `wpdb->insert_id`.
- Verify concurrent insert behavior.
- Verify rollback/failure does not reuse or corrupt identity state.
- Test post, comment, metadata, users, terms and plugin tables.

**Definition of done:** WordPress can create all supported entities without caller-supplied IDs and observes correct IDs immediately.

---

## P0.5 Transactions, atomicity and concurrency

**Status: NOT DONE**

Required work:

- Determine which WordPress workflows need multi-statement atomicity.
- Use D1 batch/transaction-compatible patterns where valid.
- Add revision/fencing where multiple operations cannot be one transaction.
- Test concurrent:
  - option writes,
  - post edits,
  - metadata changes,
  - comment insert/count updates,
  - taxonomy assignment.
- Prevent partial writes after Worker/DO interruption.
- Add idempotency/retry rules.

**Definition of done:** fault injection cannot leave WordPress-visible partial state for supported workflows.

---

## P0.6 Safe post deletion and dependent-data cleanup

**Status: INTENTIONALLY NOT IMPLEMENTED**

Post DELETE is currently blocked.

Required work:

- Delete or detach postmeta.
- Delete taxonomy relationships.
- Handle comments/commentmeta according to WordPress semantics.
- Handle revisions/autosaves.
- Reconcile media references.
- Invalidate caches.
- Make deletion retry-safe and crash-safe.
- Verify no cross-site deletion.

**Definition of done:** repeated post deletion is idempotent and cannot leave dangling or cross-tenant records.

---

## P0.7 Reversible migration from SQLite snapshot storage to query-native D1

**Status: NOT DONE**

Required work:

- Read existing WordPress SQLite snapshot.
- Create target D1 schema.
- Transform all rows losslessly.
- Verify row counts, content hashes and important invariants.
- Freeze/cut over writes safely.
- Keep source snapshot until verification completes.
- Build rollback procedure.
- Rehearse failed migration and recovery.
- Never initialize an empty WordPress database when legacy data exists.

**Definition of done:** migration + verification + rollback passes repeatedly on realistic databases with no data loss.

---

# P0 — Cloudflare Free platform proof

## P0.8 Real remote ingress Worker CPU

**Status: NOT VERIFIED**

Local wall-clock time is not Cloudflare CPU evidence.

Required work:

- Run authenticated private remote canary.
- Measure actual Cloudflare CPU for:
  - health/edge path,
  - cold WordPress request,
  - warm WordPress request,
  - login,
  - admin,
  - REST GET,
  - REST write,
  - media workflow.
- Correlate exact invocation IDs with platform telemetry.
- Keep ingress Worker within actual Free CPU constraints.

**Definition of done:** independent remote CPU evidence exists for every critical request class.

---

## P0.9 Real SQLite Durable Object CPU

**Status: NOT VERIFIED**

Required work:

- Run actual WordPress/PHP-WASM work inside the intended Durable Object boundary.
- Measure Cloudflare-reported DO CPU, not client wall time.
- Test cold and warm invocation behavior.
- Verify failures/outcomes and retry behavior.

**Definition of done:** all required DO invocation classes fit verified Free-account CPU limits.

---

## P0.10 Peak isolate memory below 128 MiB

**Status: NOT VERIFIED**

Required work:

- Obtain trustworthy peak isolate memory evidence.
- Do not infer memory from:
  - local RSS,
  - ZIP size,
  - WASM file size,
  - wall-clock time,
  - CPU time.
- Test worst-case:
  - WordPress bootstrap,
  - admin/editor,
  - media,
  - plugin/theme loading,
  - large query result.

**Definition of done:** independently measured peak memory remains under the Cloudflare isolate limit with safety margin.

---

## P0.11 Real D1/R2 Free quota accounting

**Status: NOT VERIFIED**

Required work:

- Count actual D1 API calls per Worker invocation.
- Separate:
  - SQL statement count,
  - D1 API/subrequest count,
  - rows read,
  - rows written,
  - daily quotas.
- Verify D1 database size and growth.
- Verify R2 request/storage usage.
- Measure WordPress install/admin/editorial/media workloads.
- Ensure one request cannot accidentally exceed Free limits.

**Definition of done:** worst-case supported workflow has measured quota headroom and explicit guards.

---

# P1 — WordPress behavioral compatibility

## P1.1 WP_Query coverage

**Status: PARTIAL**

Missing or incomplete:

- general WHERE combinations,
- status/type filters,
- author filters,
- date queries,
- `LIKE` / search,
- pagination/offset,
- ORDER BY variants,
- GROUP BY,
- DISTINCT,
- aggregate COUNT,
- meta query JOINs,
- taxonomy query combinations.

**Definition of done:** supported front-end/admin query corpus passes against D1 with result parity.

---

## P1.2 Taxonomy writes

**Status: NOT DONE**

Reads are proven; writes are not.

Required work:

- term INSERT/UPDATE,
- term_taxonomy INSERT/UPDATE,
- term_relationship assignment/removal,
- counts,
- duplicate slug/name behavior,
- delete semantics,
- cache invalidation.

---

## P1.3 Comment update/delete and comment_count synchronization

**Status: PARTIAL**

Comment read/count/insert is proven locally.

Missing:

- update,
- trash/spam/unspam,
- delete,
- commentmeta mutation,
- post `comment_count` synchronization,
- moderation hooks,
- notification behavior,
- retry/rollback.

---

## P1.4 Users, roles and authentication

**Status: PARTIAL**

Minimal user/password-hash lookup is proven, but full WordPress auth is not query-native.

Required work:

- full user fields,
- user create/update/delete,
- usermeta mutation,
- roles/capabilities,
- password upgrade/rehash,
- application passwords if supported,
- cookie/session behavior,
- login/logout,
- nonce lifecycle,
- auth across restart.

---

## P1.5 Revisions, autosave and editor behavior

**Status: NOT VERIFIED ON NATIVE D1**

Required work:

- Gutenberg save/update,
- revisions,
- autosave,
- draft/publish transitions,
- concurrent edit behavior,
- REST preconditions,
- metadata changes,
- recovery after interrupted write.

---

## P1.6 Plugin/theme compatibility boundary

**Status: NOT DEFINED**

Required work:

- Define supported compatibility level.
- Test representative plugins that use:
  - custom tables,
  - dbDelta,
  - complex JOINs,
  - transactions,
  - schema inspection,
  - option/meta APIs.
- Explicitly reject unsupported SQL instead of corrupting data.
- Decide whether arbitrary third-party MySQL-specific plugins are in scope.

---

## P1.7 Cron / scheduled WordPress tasks

**Status: NOT VERIFIED**

Required work:

- WordPress cron behavior,
- locking,
- retries,
- duplicate execution prevention,
- Cloudflare scheduling integration if needed.

---

# P1 — R2 media completeness

## P1.8 Full media variants and lifecycle

**Status: PARTIAL**

Already proven locally: basic upload/download/delete/rehydration.

Still needed:

- generated thumbnails and intermediate sizes,
- metadata consistency,
- duplicate files,
- filename collision,
- large media,
- failed R2 upload after DB update,
- failed DB update after R2 upload,
- orphan reconciliation,
- backup/restore,
- remote Cloudflare R2 E2E.

---

# P1 — Security and isolation

## P1.9 Production auth/CSRF security proof

**Status: LOCAL BEHAVIOR EXISTS; PRODUCTION EVIDENCE MISSING**

Required work:

- login/logout,
- cookie flags,
- nonce/CSRF,
- REST authentication,
- admin authorization,
- cross-site request denial,
- restart/session behavior,
- secret rotation,
- staging/probe isolation.

---

## P1.10 Final multi-tenant isolation model

**Status: RESEARCH FIXTURE ONLY**

Current `site_id` columns are testing constructs.

Required work:

- Define whether production isolation is:
  - database per site,
  - table prefix per site,
  - database key/scope,
  - another explicit model.
- Prevent one tenant from selecting another tenant's schema/data.
- Test all CRUD and migration paths across tenants.

---

## P1.11 Production security review

**Status: NOT COMPLETE**

Required work:

- dependency review,
- route/binding audit,
- secret audit,
- staging probe removal/isolation,
- path traversal regression,
- upload content validation,
- SQL injection regression,
- SSRF/URL handling review,
- R2 object authorization,
- D1 mutation authorization,
- security-focused final E2E.

---

# P1 — backups and disaster recovery

## P1.12 D1 backup/export/restore

**Status: NOT PROVEN**

Required work:

- documented backup procedure,
- restore to fresh environment,
- row/hash verification,
- schema version compatibility,
- R2 media correlation,
- rollback rehearsal.

---

## P1.13 R2 backup/reconciliation

**Status: PARTIAL**

Required work:

- safe inventory,
- referenced-versus-orphan validation,
- restore ordering with D1,
- protection against deleting pending journal objects,
- remote recovery rehearsal.

---

## P1.14 Full crash/restart/fault injection

**Status: PARTIAL LOCAL**

Required work:

- kill during:
  - post insert,
  - metadata update,
  - taxonomy update,
  - comment insert,
  - media write,
  - DB commit,
  - R2 cleanup.
- Verify retry and rollback behavior.
- Repeat after isolate/DO restart.

---

# P2 — production deployment work

## P2.1 Stable WordPress salts/secrets

**Status: BLOCKED IN PREFLIGHT**

Required work:

- provision stable secrets in Cloudflare,
- never commit secrets to Git,
- verify restart/session behavior,
- document rotation procedure.

---

## P2.2 HTTPS staging/production domain

**Status: BLOCKED IN PREFLIGHT**

Required work:

- operator-approved domain,
- HTTPS,
- WordPress home/site URL configuration,
- trusted proxy/origin handling,
- canonical redirects.

---

## P2.3 Private staging deployment

**Status: NOT COMPLETED AS RELEASE EVIDENCE**

Required work:

- deploy isolated staging,
- no public production traffic,
- use staging D1/R2,
- run remote installer/admin/REST/media tests,
- collect Cloudflare telemetry.

---

## P2.4 Monitoring and operational telemetry

**Status: NOT COMPLETE**

Required work:

- error rates,
- Worker/DO outcomes,
- D1 failures,
- R2 failures,
- latency,
- CPU telemetry where available,
- storage growth,
- migration failures,
- media deletion journal backlog,
- alert thresholds.

---

# P2 — performance engineering

## P2.5 WordPress bootstrap CPU reduction

**Status: LOCAL WALL-TIME PROFILE ONLY**

Current local three-run profile is not Cloudflare CPU proof.

Required work:

- profile PHP-WASM initialization,
- remove unnecessary cold bootstrap work,
- improve ZIP/filesystem initialization,
- reuse safe immutable state where Cloudflare lifecycle permits,
- cache expensive WordPress lookups without stale security state,
- reduce D1 round trips,
- benchmark every optimization against real remote CPU.

---

## P2.6 Query batching and caching

**Status: PARTIAL**

Options batching and fixed read batching are proven.

Still needed:

- per-request query planner,
- safe option/cache prefetch,
- post/meta prefetch,
- users/meta prefetch,
- taxonomy prefetch,
- cache invalidation after writes,
- exact D1 request accounting,
- concurrency correctness.

---

# P3 — product compatibility and release quality

## P3.1 Supported plugin matrix

**Status: NOT DONE**

Create a release matrix:

- core-only,
- Gutenberg,
- media,
- common SEO plugin,
- forms,
- cache plugin,
- custom-table plugin,
- WooCommerce if in scope.

Each should be PASS / LIMITED / UNSUPPORTED with reasons.

---

## P3.2 Supported WordPress feature matrix

**Status: NOT DONE**

Document:

- install,
- updates,
- posts/pages,
- revisions,
- comments,
- media,
- users,
- themes,
- plugins,
- cron,
- XML-RPC if applicable,
- REST,
- multisite,
- imports/exports,
- background jobs.

---

## P3.3 Upgrade strategy

**Status: NOT DONE**

Required work:

- WordPress core upgrades,
- DB schema upgrades,
- PHP-WASM upgrades,
- D1 migration versioning,
- rollback after failed upgrade.

---

# Current 14 production-preflight gates

Current result: **2 / 14 PASS**.

| Gate | Current status | What remains |
| --- | --- | --- |
| Pinned WordPress/SQLite manifests | PASS | Keep pinned and audited |
| Official WordPress checksum | PASS | Keep verified |
| Stable WordPress salts | BLOCK | Cloudflare secret provisioning + restart proof |
| HTTPS WordPress site URL | BLOCK | Approved staging/production domain |
| R2 media end-to-end | BLOCK | Real remote R2 proof |
| Database crash/restart recovery | BLOCK | Production-path crash/recovery proof |
| Cloudflare staging HTTP/admin/REST | BLOCK | Private remote staging deployment and E2E |
| Live memory and CPU | BLOCK | Real platform CPU and peak memory |
| WordPress bootstrap Free CPU | BLOCK | Cold/warm remote CPU evidence |
| Live D1/R2 Free budgets | BLOCK | Real query/subrequest/storage evidence |
| Native query-level D1 wpdb | BLOCK | Full active adapter + migration |
| WordPress auth/CSRF | BLOCK | Remote production-path auth/nonces E2E |
| Security/backups/restore | BLOCK | Independent security and recovery rehearsal |
| Explicit operator production approval | BLOCK | Final human GO after all other gates pass |

---

# Recommended execution order

Do not attack all remaining items in parallel. The shortest critical path is:

1. **Build sanitized exact WordPress SQL-template corpus.**
2. **Define canonical D1 WordPress schema and ID semantics.**
3. **Implement opt-in native D1 wpdb adapter with no fallback.**
4. **Complete core SQL coverage: WP_Query, writes, taxonomy, comments, users.**
5. **Run full WordPress E2E entirely on query-native D1.**
6. **Build reversible SQLite-snapshot -> D1 migration and rollback.**
7. **Deploy isolated private staging.**
8. **Collect real Cloudflare ingress/DO CPU and peak memory evidence.**
9. **Measure D1/R2 Free quotas under realistic workloads.**
10. **Complete remote auth, security, backup and recovery tests.**
11. **Run production preflight until 14/14 PASS.**
12. **Only then request explicit operator production GO.**

---

# Recommended next milestone: R37

## R37-A — exact SQL-template capture

Deliver:

- local-only MU plugin or PHP host hook,
- normalized structural SQL templates,
- literal/content redaction,
- no password/cookie/content retention,
- template hashes and counts,
- workflows for install/login/editorial/media/comments/taxonomy/users/cron,
- deterministic test corpus.

## R37-B — canonical D1 schema + identity semantics

Deliver:

- exact WordPress core tables,
- indexes/unique constraints,
- D1-compatible type mapping,
- ID allocation,
- `insert_id`,
- schema versioning,
- migration tests.

## R37-C — opt-in `wpdb` adapter v1

Deliver:

- disabled by default,
- explicit environment flag,
- no fallback to SQLite when enabled,
- exact supported template registry,
- generic unsupported-query failure,
- full result/affected-row/insert-id mapping,
- query counters and diagnostics without secret/content leakage.

## R37-D — native-D1 WordPress E2E

Must pass:

- install,
- login,
- dashboard,
- create/update/delete post,
- revisions/autosave,
- taxonomy,
- comments,
- media,
- settings/options,
- restart,
- failure injection.

The test must prove the SQLite snapshot path is not used.

---

# Things that must NOT be done yet

- Do not enable native D1 `wpdb` in production.
- Do not delete the SQLite snapshot source of truth.
- Do not silently create a fresh WordPress DB when migration data exists.
- Do not deploy localhost proof Workers.
- Do not expose D1 research endpoints publicly.
- Do not add raw-SQL passthrough from PHP/HTTP.
- Do not guess MySQL semantics from categorical query families.
- Do not claim local wall time is Cloudflare CPU.
- Do not infer isolate memory from local RSS or WASM size.
- Do not claim production-ready before all preflight gates pass.
- Do not change Cloudflare billing or use paid services to bypass Free-tier blockers without explicit operator approval.

---

# Completion criterion

microWP can be considered production-ready only when all of the following are simultaneously true:

- authentic WordPress runs on the intended Cloudflare architecture,
- active WordPress database operations are query-native D1,
- no hidden SQLite-snapshot fallback is used,
- migration and rollback are rehearsed and lossless,
- R2 media lifecycle is complete,
- auth/nonces/admin/editorial workflows pass remotely,
- crash/restart and backup/restore pass,
- real Cloudflare Free CPU and memory fit with margin,
- real D1/R2 Free quotas fit with margin,
- security review passes,
- production preflight reports **14 / 14 PASS**,
- operator explicitly approves production cutover.

Until then, the correct release state remains **NO-GO**.
