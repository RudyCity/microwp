# microWP: Real WordPress cache Service Binding failure and recovery

Date: 2026-11-06. **Local E2E passed.** This is not a Cloudflare production readiness attestation.

## Why this test exists

WordPress PHP-WASM runs inside a SQLite-backed Durable Object. A separate internal Worker/Durable Object holds a bounded, volatile Redis-like cache for the `microwp_public` group. WordPress SQLite state in D1 and media in R2 remain authoritative. Cache RPC failures must never be misreported as successful cache flushes, never drop WordPress database writes and never corrupt authentication or native WordPress transients.

## Local-only implementation

- `src/probes/wp-cache-rpc-failure-local.ts`: a local-only `WorkerEntrypoint` with `execute()` that **always throws**; all HTTP requests return 404. No authentication cookies or cache data are read.
- `wrangler.worker-cache-fault-local.jsonc` and `wrangler.worker-cache-recovered-local.jsonc`: two alternative local configurations with the **same local-only** service name. The second configuration runs the real Redis-like Worker cache after recovery. Neither config shares a name with the actual deployed `microwp-worker-cache` service.
- `wrangler.wp-cache-fault-editorial-local.jsonc`: WordPress PHP-WASM/D1/R2 configuration with a Service Binding to the fault/recovery worker, placeholder D1 UUID `00000000-0000-4000-8000-000000000009`, distinct test-only R2 bucket, and no public routes.
- `scripts/wp-cache-resilience-local-e2e.sh`: starts fault Worker and real WordPress locally; installs WordPress, logs in, publishes/updates posts, verifies D1 persistence, and **requires** the warning that cache invalidation was unavailable after D1 commit. Then it stops only its local children, starts the healthy cache Worker under the same local-only service name, restarts the WordPress Worker, verifies existing data, tests public cache seed→hit→post-commit invalidation→miss, category changes, site title changes and WordPress transient/site-transient storage.
- `tests/worker-cache-resilience-config.test.ts`: fail-closed config checks for isolated D1/R2 identities, no public routes, same local-only service name and no accidental production Worker name reuse.

The local E2E succeeded in one complete failure/recovery cycle. No remote Cloudflare cache Worker, D1, R2, WordPress staging or account settings were modified.

## What is proven and what is not

The real WordPress installer, authentication, published post, and SQLite-backed D1 state survived intentional RPC exceptions on cache invalidation. In recovery, WordPress still rendered the original content, normal cache RPC returned hits, post/category/site changes triggered post-commit invalidation, and native WordPress transients remained database-backed.

**Limitations:**
- The fault probe represents an RPC exception and service replacement in **local Workerd**, not a global Cloudflare outage, partition, rate limit or cold-evicted Durable Object.
- A cache invalidation failure after a D1 commit cannot be rolled back atomically. Remote `microwp_public` keys must be immutable and derived from authoritative content revisions; otherwise they can remain stale for the bounded TTL.
- This does not establish live Cloudflare Free CPU, 128 MB memory safety, maximum concurrency, or full native D1 `wpdb` compatibility.
- This local-only fault Worker must **never be deployed**. Deployed staging remains opt-in disabled and publicly locked.

## Reproduce

```bash
bun run check
bun run wp-cache:resilience-e2e
bun run wp-cache:editorial-e2e
bun run staging:smoke
```

**Decision: local failure/recovery gate PASS; production remains NO-GO.**
