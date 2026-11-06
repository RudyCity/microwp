# microWP — Bounded, verified WordPress autoload options reader (experimental)

Date: 2026-11-06. **Local-only conformance tests PASS. Native D1 `wpdb` and production remain NO-GO.**

## Purpose

microWP must continue running real server-side WordPress PHP-WASM inside Cloudflare Workers / SQLite-backed Durable Objects, with D1 and R2 as storage backends and without static-site export or paid Cloudflare dependencies. The private D1 structured-query prototype already recognizes the pinned WordPress 7.1.4 `wp_load_alloptions()` autoload query. Its original translator produces **at most 50 results per page**, so a caller cannot safely treat the first page as a complete WordPress options cache.

This milestone adds `src/php/d1-wpdb-conformance/options-complete.ts`: a **bounded, fail-closed private reader** layered over that existing translator and a separately authorized, host-owned D1 query callback. No public HTTP route, deployment, `db.php` installation, or remote D1 mutation is involved.

## Safety contract

1. **Strict canonical query:** the pinned four WordPress autoload values (`yes`, `on`, `auto-on`, `auto`) or a supported subset must pass the existing parser. Every SQL predicate and site scope still uses the private structured D1 adapter's policy and prepared bindings. The callback must already hold the server-only D1 caller capability; no WordPress PHP or HTTP request gains that credential.
2. **Bounded complete paging:** up to 10 data pages × 50 rows = 500 options per pass. When the tenth data page (page index 9) is full, an additional **empty overflow page** is required: exactly 500 is accepted only after the extra zero-length query; 501 or more is **rejected**. There is no silent truncation.
3. **Two-pass drift detection:** read the complete bounded sequence twice, checking the same keys and values. The reader refuses output if any observed row differs, disappears, appears, is duplicated, or is out of strict UTF-8 binary order. This catches common mid-read changes, including insertion before a page boundary. **Two identical passes do not provide a transactional snapshot or guarantee that no concurrent update occurred between them.**
4. **Bounds and response integrity:** at most 22 private D1 queries per completed read (two passes of 10 pages plus one overflow probe). Strict per-response 64 KiB, per-option value 32 KiB, overall option payload 256 KiB, option name 191 UTF-8 bytes, response version, operation, correlation ID, exact expected fields and row count checks. A query or transport error never yields partial cached options.
5. **No JavaScript prototype pollution:** the result is a frozen, null-prototype record. WordPress option names such as `__proto__` and `constructor` are preserved as ordinary own keys rather than affecting JavaScript prototypes.
6. **No production route:** this implementation is never imported by the live `src/php/native.ts`, `src/index-durable.ts`, or Cloudflare staging configuration.

## Verified local scenarios

`tests/d1-wpdb-complete-autoload.test.ts` exercises an actual in-memory SQLite engine through the private, site-scoped D1 runtime adapter and proves:

| Scenario | Expected result |
| --- | --- |
| 65 options (two pages), another site's options present | Full site-A result only; two passes |
| Exactly 500 options | Accepted only after empty overflow probes; maximum 22 queries |
| 501 options | Rejected without returning partial option data |
| Option updated between verification passes | Rejected |
| Option inserted between paged reads | Rejected |
| Error response, incorrect correlation ID, invalid JSON, thrown callback | Rejected |
| Oversized option value or aggregate options payload | Rejected |
| Repeated/unordered option names | Rejected |
| Active WordPress runtime/staging import gate | No native adapter activation |
| Unsupported SQL/query identifier | Rejected before D1 is called |
| `__proto__` and `constructor` option names | Returned as safe, frozen, null-prototype keys |

Run:

```bash
bun test tests/d1-wpdb-complete-autoload.test.ts
bun run check
bun run e2e:local
bun run wp-cache:editorial-e2e
```

The existing default WordPress runtime continues to use SQLite snapshots persisted through D1; these new results verify a candidate native-query path rather than changing WordPress database execution.

## Remaining production blockers

- **Atomicity:** two-pass comparison is not a real database snapshot or transaction. With concurrent writes it can still theoretically observe the same non-atomic state twice. Implement a genuine transactional/snapshot read or a revision/fencing protocol before production.
- **Completeness:** 500 options is only the prototype's explicit limit. Real sites can exceed this or contain very large serialized option values. Returning incomplete `alloptions` would break WordPress; the code intentionally rejects those cases rather than quietly removing options.
- **MySQL compatibility:** the pinned WordPress options loader has additional paths, including fallback to an unfiltered query and plugin-defined behavior. They are **not supported** by this prototype. The WordPress `db.php` adapter remains uninstalled.
- **Cloudflare Free feasibility:** live SQLite Durable Object invocation CPU, peak 128 MiB isolate memory, quota, and query costs remain unverified. Local wall time is not a substitute.
- **Deployment:** staging, DNS, public WordPress, remote D1/R2, Worker cache, billing and paid settings were not changed.

**Release decision: experimental full-page detection and drift-checked option reads PASS in local tests; WordPress production GO remains blocked.**
