# microWP — Transactionally consistent WordPress autoload reads on private D1

Date: 2026-11-06. Status: **experimental private D1 read prototype; real local Workerd proof PASS; WordPress production NO-GO**.

## Motivation

The previous WordPress 7.1.4 autoload reader had a 50-row page limit and a two-pass comparison to identify many mid-read changes. Two separate passes, however, do **not** provide an atomic snapshot. Cloudflare D1 documents `D1Database.batch()` as a **single SQL transaction**. This implementation replaces independently dispatched reads with one **read-only transactional batch**, preserving authoritative site isolation and strict fail-closed resource bounds.

Official references:
- https://developers.cloudflare.com/d1/worker-api/d1-database/#batch
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/d1/platform/pricing/

## Implementation

- `src/php/d1-wpdb-conformance/options-atomic.ts` is an **experimental trusted-host-only** reader that first validates the exact supported pinned WordPress `wp_load_alloptions()` SQL template (official autoload values `yes`, `on`, `auto-on`, `auto` or a permitted subset). It accepts a trusted site/table configuration, not an HTTP request or PHP-provided scope.
- The helper prepares **11 read-only SELECT statements** (10 pages of 50 options, plus one overflow probe) and executes all 11 in **one D1 `batch()` transaction**. Cloudflare D1 guarantees that statements in a batch execute sequentially within one SQL transaction. The prepared SQL binds all autoload values and the host-owned site identifier. All identifiers are validated and quoted. No arbitrary SQL is accepted.
- Every SELECT enforces a SQL-side 191-byte option-name and 2,048-byte option-value projection limit, using `CASE ... ELSE NULL`, so even a large stored option cannot be materialized as an unbounded JavaScript string. Any `NULL`, unexpected type, malformed row, inconsistent name ordering, duplicate, or non-string value causes the **entire read** to fail; data is never silently omitted.
- The result must contain **at most 500 options** and **256 KiB** aggregate name+value bytes; each page's result is capped at 64 KiB. The 11th query must return zero rows. Any 501st option causes a hard failure, not a truncated WordPress options cache. Results are frozen null-prototype maps to prevent prototype pollution from option keys such as `__proto__`.
- Compared with the old two-pass maximum 22 read requests, the atomic path performs **one D1 batch call containing 11 queries**, which Cloudflare counts as 11 queries, **not** one query. The 11-query count fits the **Workers Free D1 limit of 50 queries per invocation**, but this does not account for any other WordPress queries that might run in the same invocation. It is a research prototype, not a performance claim or guaranteed WordPress quota fit.

## Verified tests

`tests/d1-wpdb-atomic-autoload.test.ts` validates the read with real local SQLite transactional batches, server-owned site separation, 65/500/501 options, 150-KiB stored values projected to `NULL` then refused, overlarge UTF-8 keys, 256-KiB payload overflow, malicious table/scope/query rejection, malformed D1 responses, and failure containment.

`tests/d1-wpdb-atomic-config.test.ts` verifies the Workerd proof has no public route, has a distinct local-only D1 UUID and is absent from the active WordPress staging/runtime.

`bun run d1:atomic-e2e` starts **real local Cloudflare Workerd with a D1 binding** using `wrangler.d1-atomic-autoload-local.jsonc`. The proof initializes an isolated local D1 database with 65 options for each of two sites and verifies:

- HTTP GET is rejected (404), local-only POST proof is fixed and does not accept arbitrary SQL.
- The actual Cloudflare D1 `batch()` API returns 65 complete site-A options, excluding all site-B values.
- A committed option UPDATE becomes visible on a subsequent transactional batch.
- A fixed local-only fixture increases the option count to 501, and the next read fails closed (503, no partial data).
- No local fixture or proof Worker is deployed to Cloudflare. All state remains under ignored `.wrangler/` files.

## Remaining concerns

1. This is **not** a complete WordPress `wpdb` driver and **not installed** in the PHP-WASM runtime. The active WordPress storage still uses the existing SQLite snapshot path backed by D1. No WordPress core, DNS, public route, remote D1/R2, billing or Cloudflare account configuration was changed.
2. The transaction guarantees a consistent snapshot of the **D1 batch statements** under Cloudflare's documented `batch()` semantics. It does not guarantee consistency with WordPress writes in a different database system or transaction, or provide a transactional cross-resource boundary with R2/cache.
3. Some WordPress options exceed 2,048 bytes, some sites have more than 500 autoloaded options, and the original `wp_load_alloptions()` has fallback and plugin-specific paths not covered here. Those cases are intentionally refused rather than loading incomplete data.
4. A fixed 11 D1 query budget may be inefficient for small sites. Free has a 50-query per-invocation limit and daily read/write quotas, so a production design requires a measured query plan, index policy, caching and realistic usage tests. A single-query bounded snapshot alternative may be more efficient, but is **not implemented** by this milestone.
5. Actual Free Cloudflare Durable Object CPU/memory and full WordPress native D1 driver compatibility are still unverified. Local Workerd E2E is correctness evidence, not production certification.

## Reproduction

```bash
bun run check
bun run d1:atomic-e2e
bun run e2e:local
bun run wp-cache:editorial-e2e
bun run canary:e2e
bun run staging:build   # dry-run, never deploy
```

**Release decision: private atomic D1 batch proof PASS locally; production remains NO-GO.**
