# microWP WordPress bootstrap CPU profile and optimization plan

**Date:** 2026-11-05  
**Worker:** Delegate Worker B (read-only source review plus two new standalone files)  
**Repository:** `G:\project\microWP`, existing `main` branch  
**Status:** Diagnosis documented; **production NO-GO**. No live Cloudflare invocation, billing change, deployment, branch, worktree, commit or push was performed.

## Executive finding and confidence

The only directly verified **Cloudflare CPU outcome** available in the repository is the prior **private isolated staging canary**: PHP 8.4.27 + PDO SQLite completed at **8 ms CPU / 10 ms wall**, whereas a fixed GET of WordPress installer ended **`exceededCpu` at 2,010 ms CPU / 2,108 ms wall**. The failure occurred after `WORDPRESS_INSTALLER_BEGIN` and before `WORDPRESS_INSTALLER_READY`. See `docs/reports/2026-11-05-cloudflare-private-runtime-canary.md:10-21`.

**High-confidence localization:** a real `php.run({scriptPath:"/www/wp-admin/install.php"})` invocation and its WordPress initialization path is the failing phase, not an inability to instantiate PHP-WASM or load PDO SQLite. **Unknown:** the exact function, include, SQLite translation query, filesystem operation, or effective CPU policy that caused termination. A single exceeded-CPU trace is not a per-function CPU profile. The 8 ms and 2,010 ms observations are independent requests (potentially different cold/warm isolate conditions), so their difference is **not** an isolated measurement of WordPress PHP CPU.

The `2,010 ms` observation is **not proof of an exactly 2,000 ms configured limit**; the checked-in `wrangler.staging.jsonc` has no `limits.cpu_ms` entry. The actual effective invocation budget/account tier was **not audited from the live Cloudflare account**, and should not be guessed.

## Verified source-to-workload map

| Phase | Evidence in this repo | Confidence / implication |
| --- | --- | --- |
| PHP and WASM instantiate | `src/php/native.ts:20-42` imports compiled PHP 8.4.27 WASM, calls `loadPHPRuntime`, constructs `PHP`, and memoizes the promise per isolate. | Verified source path; not an attribution of CPU for the failed request. |
| Archive indexing and mount | `src/php/zip-files.ts:13-40,55-93` indexes the central directory and creates directories plus **one MEMFS node per archive entry**; payloads are decompressed lazily in each node's first `read`. | Eager *metadata/node creation*, lazy *file-byte inflation*. Both may have CPU and memory cost; not proven dominant in Cloudflare. |
| PHP config and WordPress loader | `src/php/config.ts:10-34` generates `wp-config.php` including `wp-settings.php`; `src/php/native.ts:135-163` executes one fixed installer after a successful fixed PHP/SQLite check. | Installer phase performs considerably more PHP work than fixed `echo PHP_VERSION` canary. |
| WordPress installer | Archived `wp-admin/install.php` requires `wp-load.php`, then `wp-admin/includes/upgrade.php`; `wp-load.php` resolves config and bootstrap. | Verified by inspecting the packaged WordPress archive locally; file execution time **not** profiled. |
| SQLite integration | `scripts/prepare-wordpress.py:47-60` packages the pinned integration and a `wp-content/db.php` drop-in. One included SQL-translation class is `class-wp-mysql-on-sqlite.php` (~302 KiB uncompressed). | A possible source of parser/translation CPU or allocations; **no attribution established**. |
| Persistent database/media | `src/index-durable.ts:16-93` handles D1/DO/R2 restoration and snapshots on local-only site routes. | The isolated staging probe at `src/index-durable.ts:101-139` calls PHP directly instead of the public/local-site `SITE_DO` request path. **Do not blame D1 snapshot or media restoration for this specific installer canary.** |
| Request serialization | `src/php/native.ts:43-46,56-113` serializes PHP requests, reuses one PHP runtime per isolate, and blocks public preview. | Helps avoid concurrent mutable PHP state; not a proven optimization for first installer run. |

**Archive inspection (read-only, 2026-11-05):** `generated/wordpress-php.bin` was **6,979,199 compressed bytes**, **2,565 indexed entries**, **1,550 PHP entries**, **28,941,803 total uncompressed entry bytes**. The archive SHA-256 matches `generated/wordpress-manifest.json`. Largest checked PHP source examples include `wp-includes/formatting.php` (357,678 bytes), `wp-includes/post.php` (305,589), and the SQLite translation class (~302 KiB). `wp-settings.php` has **329 textual occurrences** of require/include keywords (including possible comments and branches); this is **not 329 executed includes**. All these figures are static source/package facts.

## Bounded offline proxy measurement (not Cloudflare bootstrap)

Added **only** `scripts/profile-wordpress-bootstrap.ts`. It verifies archive SHA-256, checks the archive size (`<=16 MiB`), invokes the project's existing ZIP indexer, and inflates at most 12 fixed bootstrap-related files, limited to **512 KiB each** and **3 MiB total uncompressed**. It makes **no network calls**, executes **no PHP**, loads **no credentials**, modifies **no data**, and does **not** start Wrangler or WordPress.

Measured once on the connected Windows host, using Bun **1.4.2**:

| Local operation | CPU measured by Bun process | Wall time | Scope |
| --- | ---: | ---: | --- |
| `indexZip` over packaged archive | 16 ms | 6.851 ms | 2,565 ZIP entries |
| `inflateEntry` for 12 selected files | 46 ms | 18.877 ms | 1,083,091 bytes decoded |
| RSS before/after combined script work | — | — | 56,078,336 -> 72,052,736 bytes (**+15,974,400 bytes**) |

CPU can exceed wall time where runtime process measurement includes multiple threads. RSS is the **entire local Bun process**, not an isolate, not a memory peak, and not directly comparable with Cloudflare's 128 MB cap. These numbers should **never** be substituted for remote `cpuTime`, and the script cannot find PHP execution hot spots by itself. All 12 sample paths were present.

Command: `bun scripts/profile-wordpress-bootstrap.ts`

## Official Cloudflare constraint checks (as of 2026-11-05)

- **Request CPU:** Cloudflare documents Workers Free as **10 ms per HTTP invocation**, while the Workers Paid default is **30 seconds** and may be configured up to **300,000 ms / 5 minutes**. Occasional overrun flexibility does not establish an account's effective budget. Changing paid settings or plan can affect cost and requires operator approval. Source: [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/), [Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/).
- **Isolate memory:** **128 MB** for JS heap **plus** WASM allocations, per isolate, not merely the PHP `WP_MEMORY_LIMIT` setting. A larger CPU allowance does not increase this memory ceiling. Source: [Cloudflare Workers Limits — Memory](https://developers.cloudflare.com/workers/platform/limits/).
- **Worker global-scope startup:** **1 second** separate from an HTTP request's CPU execution. An over-budget *global module initialization* is commonly reported as a startup-limit validation error; the current trace is instead a **request invocation `exceededCpu` after the installer marker**. Do not conflate the two. Source: [Cloudflare Workers Limits — Startup](https://developers.cloudflare.com/workers/platform/limits/).
- **Timing instrumentation caution:** `performance.now()` and `Date.now()` may be frozen during synchronous CPU work in deployed Workers and advance on I/O. Therefore a measured `runtimeInitMs:0` or `mountMs:0` does not imply zero CPU. Cloudflare's invocation `cpuTime` and native Profiler are the authoritative tools. Source: [Cloudflare Performance and Timers](https://developers.cloudflare.com/workers/runtime-apis/performance/), [Cloudflare CPU Profiling](https://developers.cloudflare.com/workers/observability/dev-tools/cpu-usage/).
- Durable Objects also inherit Worker CPU and memory considerations; do not assume splitting bootstrap into a DO automatically avoids request CPU limits. Source: [Durable Objects Limits](https://developers.cloudflare.com/durable-objects/platform/limits/).

**Key unresolved anomaly:** a trace terminated at ~2.01 seconds despite published plan tiers of 10 ms or 30 seconds default. Possible explanations include an effective runtime-specific configuration or enforcement behavior not present in the repository's static configuration. **No theory is verified**. Next authorized session should read, not modify, the account's current limit and the specific invocation's outcome/metadata.

## Optimization priorities, evidence gates, CPU–memory tradeoffs

| Priority | Proposed experiment (requires separate authorization to edit runtime) | Expected CPU impact / risk | Memory tradeoff | How to prove |
| --- | --- | --- | --- | --- |
| **P0** | Obtain **actual** per-invocation CPU profiles for fixed private installer (and fixed PHP-only baseline) using Wrangler DevTools or Cloudflare dashboard Profiler; retain cold and warm trace labels, account limit, and `exceededCpu` outcome. No public PHP route or client-supplied scripts. | Required to stop guessing; none by itself. | Profiling overhead; do offline first. | Native self-time/call tree identifies major sites; compare staged runs without secrets. |
| **P0** | Separate `loadPHPRuntime`, archive index, MEMFS node creation, config write, PHP `wp-settings.php`, SQLite drop-in initialization, and installer/template rendering **by phase** in a private local instrumented build, or use native profiler attribution. | Accurate breakdown before rewrites. | Trace buffers consume memory; use few bounded samples. | Capture CPU profiles and known phase markers; no reliance on timers frozen in deployed Workers. |
| **P1** | Reduce eager MEMFS metadata work (2,565 nodes, per-entry stream closures) with a **prototype** lazy lookup / directory-on-demand or precomputed manifest. Preserve `stat`, `fileExists`, `realpath`, `opendir`, and PHP include semantics. | Could reduce cold mount CPU and JS allocations; per-lookup overhead may increase warm PHP requests. Not yet shown to affect the 2,010 ms failure. | Potentially fewer persistent JS nodes, but additional lookup indexes/cache and complex FS semantics. | A/B cold/warm installer CPU plus ZIP path/permissions tests. |
| **P1** | Profile WordPress `wp-settings.php` include/eval chain, default hooks, SQLite drop-in loader, schema creation. Trim only **unnecessary optional behavior** under a feature-flagged compatibility matrix; never remove installer-critical hooks blindly. | Candidate for large CPU savings if PHP parsing/initialization dominates; greatest compatibility/security regression risk. | Avoid eager loading of optional modules; additional instrumentation temporarily increases memory. | Installer, admin, REST, auth, locale/theme/plugin conformance tests and PHP/WASM CPU profiles. |
| **P1** | Investigate WASM PHP opcode compilation caching or precompiled immutable includes **only if the pinned runtime actually supports it**. Verify `@php-wasm` build's OPcache availability before proposing implementation. | Potentially reduce repeat parsing; cold start may not improve if caches begin empty. | Persistent compiled code can **increase** 128 MB isolate pressure; eviction policy required. | Distinguish first vs second installer on same isolate, and record isolate memory. |
| **P2** | Improve ZIP hot-file layout and selective inflate cache using measured required-file set; avoid duplicating both compressed and inflated copies without limits. | Small-to-moderate only if inflation dominates. | Compression CPU vs decompressed heap/MEMFS growth; cache increases memory. | First-read histogram and verified byte budget under memory pressure. |
| **P2** | Separate safe static resources, installer/admin workflows, and DB accesses so non-PHP routes do not instantiate WASM. Static assets already use `ASSETS`/R2; **do not disable authenticated cache invalidation**. | Saves PHP CPU on requests that genuinely need no WordPress; will not solve installer itself. | Smaller isolate for static requests, more architectural complexity. | Route-level CPU p50/p95 and function/security parity. |
| **P3** | Consider remote compute or a redesigned rendering/admin pipeline if authentic WordPress PHP cannot meet both CPU and memory limits. Evaluate a paid CPU budget **only as an explicitly approved operational option**, not an automatic fix. | Could change cost/architecture materially; does not improve PHP efficiency. | 128 MB isolate cap still applies; external hosting changes latency, isolation and state model. | Approved cost, latency, deployment, license and security review. |

Existing mitigations **already present**: lazy ZIP *payload* inflation, memoized per-isolate PHP runtime, serialized PHP request execution, disabled WP cron and file modifications, restricted public staging routes, fixed private probe, and static asset offload. Avoid listing these as missing work.

## Safe next measurement protocol

1. **Do not run another live installer probe during this read-only task.** In a separately authorized measurement session, first inspect read-only staging deployment metadata and actual CPU policy; keep Cloudflare billing/plan untouched.
2. If authorized, capture CPU profiles with `wrangler dev`/DevTools on **local isolated bindings**. Set a bounded request count, no live state, no secret logging, no remote bindings by default. Label cold vs reused isolate and distinguish worker global startup from installer `php.run`.
3. Reproduce a minimal fixed PHP-only check, fixed `wp-settings.php` bootstrap where safe, and fixed WordPress installer step 1 with identical pinned binaries. Run at least 3 cold and 3 warm samples for preliminary direction, then an authorized statistically meaningful series if needed. Preserve failure outcomes, not just successes.
4. For any later live staging validation, use the **existing secret-gated fixed probe only**, no arbitrary SQL/PHP public routes, no user content. Collect platform invocation `cpuTime`, wall time, `outcome`, and isolation/memory evidence; do not print tokens or site data. A failed `exceededCpu` call may not return application JSON or end-of-handler counters.
5. Require a full installer run within **the account's verified budget with meaningful CPU headroom**, plus measured isolate memory below 128 MB with safety margin, followed by admin/login/REST/media validation, fault recovery, security and cost gates. Never infer memory safety from an 8 ms PHP-only success.

**Current decision:** Production **NO-GO**. WordPress installer is not verified to complete on deployed Cloudflare; neither exact top CPU frame nor peak isolate memory has been established.

## Verification and scope accounting

- `bun scripts/profile-wordpress-bootstrap.ts` — **PASS**, SHA verified, 12/12 selected paths found, bounded offline instrumentation only.
- `bun run check` — **PASS**, `tsc --noEmit`, **62 tests initially, 71 tests on the final run (including 9 concurrent Worker A tests)**, 0 failed (from this session's connected terminal).
- `git status --short --branch` before work — `main...origin/main`, clean; after creating script — only that new untracked script (report created thereafter); final Git status additionally shows untracked Worker A files in src/php/d1-protocol/ and tests/d1-protocol.test.ts, which Worker B did not modify.
- Permitted new files only: `docs/reports/microwp-bootstrap-profile-and-optimization.md` and `scripts/profile-wordpress-bootstrap.ts`.
- No existing runtime source, tests, Cloudflare configuration, shared document, deploy, production infrastructure, branch/worktree, commit, or push touched.

## Sources

Repository: `docs/reports/2026-11-05-cloudflare-private-runtime-canary.md`; `docs/reports/2026-11-05-alpha4-journal-and-d1-bridge.md`; `src/php/native.ts`; `src/php/zip-files.ts`; `src/php/config.ts`; `src/index-durable.ts`; `scripts/prepare-wordpress.py`; `wrangler.staging.jsonc`; `generated/wordpress-manifest.json`.

Platform: [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/), [Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/), [CPU Profiling](https://developers.cloudflare.com/workers/observability/dev-tools/cpu-usage/), [Performance and Timers](https://developers.cloudflare.com/workers/runtime-apis/performance/), [Durable Objects Limits](https://developers.cloudflare.com/durable-objects/platform/limits/).
