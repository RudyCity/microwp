# microWP Stage-3 Worker B: WordPress CPU critical path

Date: 2026-11-06. Source/profiler prototype only; no runtime modification, deployment, public route, or Cloudflare account changes.

## Critical path

The existing `src/php/native.ts` creates one `loadPHPRuntime` and PHP instance, mounts the pinned WordPress ZIP as lazy MEMFS, writes `wp-config.php`, then calls `php.run` for `/www/wp-admin/install.php`. PHP config immediately `require_once ABSPATH . 'wp-settings.php'`; the installer also loads additional admin includes and database bootstrap. The on-demand MEMFS read/decompression, PHP compilation and includes, SQLite initialization and WordPress hooks may dominate cold request CPU. ZIP central-directory indexing is only a small subset. The existing staging log markers record elapsed time to WASM, ZIP mount and config completion, but **do not isolate wp-settings from installer execution or measure actual Worker CPU**.

## Prototype

New standalone `scripts/profile-wordpress-php-bootstrap.ts` implements:
- `--inspect`: SHA-256-check the pinned PHP archive; bounded offline inspection of selected PHP files and literal include hints (not PHP execution);
- `--workerd`: spawn **only a self-owned** local Wrangler Native Workerd child, binding `127.0.0.1:18879`, GET fixed local health and two installer pages, record end-to-end request wall times and existing WASM/ZIP/config elapsed-time markers when available, kill only its child. It never changes a Worker entrypoint, Cloudflare deployment, DB, or user PHP files. It declines to invent CPU and RSS fields where workerd process instrumentation is not available (null).
- Process output is bounded; each fetch, startup, and output is limited. No arbitrary path, SQL or remote host inputs.

Execute:
```sh
bun scripts/profile-wordpress-php-bootstrap.ts --inspect
bun scripts/profile-wordpress-php-bootstrap.ts --workerd
bun test tests/bootstrap-cpu-profile.test.ts
bun run check
```

## Measurement and limitations

Record exact command outputs below after execution. Interpretation: first installer request includes runtime initialization, mount and full WordPress PHP; second request omits init but still runs wp-settings and installer. These are **overlapping composite phases**, not isolated CPU measurements. Local wall time is not Cloudflare billed CPU, and PHP engine initialization may differ under Workers production compatibility. No Cloudflare 10-ms Free Worker CPU claim can be made from an observed ~2s bootstrap.

## Safe optimization hypothesis and alternative architecture

Do not prematurely eliminate WordPress filters, hooks, core file includes or database initialization: such transformations may silently alter WordPress semantics/security. A bounded low-risk prototype is staged local measurement plus per-phase cold/warm comparison without caching request-specific global PHP state. If local workerd consistently reports CPU far above the production tier budget, the defensible architecture is to run full WordPress/PHP on a CPU-appropriate backend (dedicated service/container/VM), use Cloudflare Workers as edge/cache/authorization router, and use D1/R2 only via explicitly validated storage adapters. A static/pre-rendered edge frontend with a separate privileged WordPress backend is another option; neither implies direct-D1 compatibility. Inspect real CPU/heap traces, installer success, SQLite safety and complete WP E2E **before** declaring feasibility.

## Verified run observations (2026-11-06, Bun 1.4.2 / Wrangler 4.157.0, Windows)

| Command | Observed result |
| --- | --- |
| \`bun scripts/profile-wordpress-php-bootstrap.ts --inspect\` | Exit 0; archive SHA-256 \`7daf6f588d70f6fa15d86c12c244158ec1240c10119d25b2e06d5975bf0224b9\`; 6,979,199 ZIP bytes; 2,565 indexed entries; \`wp-settings.php\` 33,152 source bytes; \`wp-admin/install.php\` 18,375 source bytes; \`wp-includes/class-wpdb.php\` 121,437 source bytes. Static size is **not** CPU. |
| \`bun test tests/bootstrap-cpu-profile.test.ts\` | Exit 0; 4 pass, 0 fail, 15 expectations. |
| \`bun run check\` | Exit 0 on later rerun; TypeScript succeeded and 142 tests passed, 0 failed, 548 expectations across 23 test files; concurrently contributed files included. |
| \`bun scripts/profile-wordpress-php-bootstrap.ts --workerd\` | Exit 1: started self-owned local Wrangler, startup log said Ready on \`http://127.0.0.1:18879\`, but every fixed \`/__microwp/native-health\` probe returned **503** for 45 seconds. No PHP initialization, wp-settings, installer CPU or RAM data are available. Script terminated its own child and failed closed. |

During first \`bun run check\` attempt, another concurrently edited file \`tests/d1-wpdb-contract.test.ts\` had a syntax error; Worker B's TS issue was also corrected. A subsequent run passed 142/142.

### Phase CPU / memory data availability

| Phase | Local workerd wall (ms) | Actual workerd CPU (ms) | Peak workerd memory |
| --- | --- | --- | --- |
| PHP-WASM init | Not obtained (health 503) | Not measured | Not measured |
| ZIP/MEMFS mount + config | Not obtained (health 503) | Not measured | Not measured |
| wp-settings PHP boot | Not isolated | Not measured | Not measured |
| WordPress installer PHP | Not executed successfully in this profile | Not measured | Not measured |

Do **not** substitute local HTTP 503 response latency or parent Bun RSS for PHP CPU or workerd isolate memory. The source-inspection command provides file sizes, not runtime resource measurements. Diagnosing the 503 needs isolated reproducibility against a known-good local entrypoint and DevTools CPU profiling, which is integration/orchestrator-owned.

## External platform facts verified

Cloudflare's official Workers limits (updated 2026-10-29) list **10 ms CPU per HTTP request on Workers Free** and **128 MB isolate memory** on both Free and Paid. Waiting for I/O does not count toward CPU. Source: https://developers.cloudflare.com/workers/platform/limits/ . Cloudflare's 2026-10-08 CPU profiling guide directs operators to the Wrangler DevTools Profiler for CPU hotspots: https://developers.cloudflare.com/workers/observability/dev-tools/cpu-usage/ . Neither source claims PHP/WordPress can fit this budget, and local wall measurements cannot demonstrate compliance.

**Stage-3 Worker B decision: NO-GO for claiming Free Workers full-WordPress viability, CPU-bottleneck resolution, or production direct-D1 WordPress support.** The script and tests are bounded diagnostic artifacts only; no active runtime change.


## Orchestrator independent reproduction (2026-11-06)

The first `--workerd` execution failed with HTTP 503 because the profiler launched Wrangler using Bun's executable (`process.execPath`). Wrangler/Miniflare's local routing uses undici's dispatcher and does **not** work when Wrangler itself is executed under Bun (the response explicitly stated this requirement). A manual `wrangler dev` launched via Node returned HTTP 200 on `/__microwp/native-health`; the profiler was corrected to start its child with `node`.

On the fixed Node-based local profiler, the actual fixed installer request returned **HTTP 200** twice and the expected installer form was present:

| Local workerd measurement | Observed wall time |
| --- | ---: |
| First installer (PHP-WASM init + MEMFS + WordPress PHP) | 3,215.701 ms |
| Repeated installer (same isolate) | 1,522.496 ms |
| Existing WASM/ZIP/config log markers | 474 / 824 / 829 ms |

The script intentionally records `cpuMs: null` and RSS fields as `null` because it measures the client and not the Worker isolate's actual CPU or heap. The values are one local diagnostic run, not statistical bounds, and do **not** establish Free-tier compatibility. The prior **real** private Cloudflare trace in `docs/reports/2026-11-05-cloudflare-private-runtime-canary.md` recorded `exceededCpu` after about **2,010 ms Cloudflare CPU** during WordPress installer bootstrap. Full remote WordPress hosting remains **NO-GO** without an approved CPU budget/architecture and complete PHP+WordPress memory E2E.
