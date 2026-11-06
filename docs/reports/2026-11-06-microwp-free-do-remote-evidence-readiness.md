# microWP Free SQLite Durable Object: Remote CPU Evidence Readiness

Date: 2026-11-06
Status: **CODE HARDENING COMPLETE; REMOTE CPU AND MEMORY UNVERIFIED**

## Scope and design

The separate `microwp-free-do-cpu-probe` Worker remains a private-token-gated diagnostic, not a public WordPress server. Only the fixed CPU sample set, PHP-WASM PDO SQLite check, and fixed GET-only WordPress installer probe are accepted. No arbitrary SQL/PHP/path, D1/R2 binding, database writes by this worker, paid CPU setting, plan mutation, or service lifecycle operation was introduced.

The ingress Worker authenticates and forwards only; `MicroWPFreeCpuDO.fetch()` runs the actual PHP-WASM/WordPress canary inside the SQLite-backed Durable Object. Each authenticated probe has an opaque UUIDv4 `requestId`. It appears in a bounded response and in structured `microwp-free-do-cpu-trace` log entries for `ingress-worker` and `sqlite-durable-object`, with distinct `begin`, `completed`, or `failed` stages. A CPU termination may have a `begin` event without a `completed` event.

The remote operator script allows only the dedicated HTTPS `workers.dev` origin, does not follow redirects, uses a locally ignored secret without logging it, caps response bodies at 8 KiB, runs exactly seven fixed sequential tasks with explicit timeouts, checks protocol/response ID/checksum/PHP and installer fields, and writes a sanitized local report. It never claims the client clock or PHP `requestMs` is Cloudflare CPU.

## Required evidence (not yet collected here)

1. Have an authorized operator provision the existing strong key using an approved secret-management process. If that process is blocked, stop; never circumvent platform controls or paste the secret into chat.
2. Deploy updated canary code only through the orchestrator's separately approved deployment workflow. The previous deployed version will not provide the new protocol/ID fields and must fail closed against the upgraded client validator.
3. With the secret actually provisioned, the operator may explicitly run `bun run canary:remote` from the registered repository with `MICROWP_CPU_PROBE_URL` set to the exact service origin. This worker did **not** run any remote probe.
4. For each `requestId`, use authenticated Cloudflare observability to retrieve the distinct **ingress Worker invocation** and **SQLite Durable Object invocation** with their platform `cpuTime`, `outcome`, and available wall-time values. Compare ingress against the Free 10 ms CPU budget and the SQLite DO invocation against its distinct 30 s default CPU limit (subject to current Cloudflare rules). A successful HTTP request alone is not a CPU pass. Match the `begin` event for CPU-terminated calls even when no JSON response returns.
5. Record provenance from the platform logs, execution scope, task, correlation ID, timestamp, deployment version, and raw invocation outcome in an appropriately access-controlled report. `bun run cpu:evidence-audit` is a diagnostics-only offline review of operator-supplied observations, **not authenticated provenance**.

Peak memory remains **not measured** unless independently supplied by trustworthy Cloudflare instrumentation. Never infer peak isolate RAM from `cpuTime`, local process RSS, archive size, an empty result field, or client wall time. No production GO decision can follow from these probes alone.

The repository uses a pinned WordPress 7.1.4 source archive and PHP-WASM 8.4.27. The fixed WordPress installer HTTP 200/form probe tests real PHP execution, but the HTTP result is not independently sufficient to attest a deployed artifact hash, full WordPress administration/database fidelity, or production readiness.

## Local verification and remaining gate

Changes are limited to `src/probes/free-do-cpu.ts`, `src/probes/free-do-cpu-policy.ts`, `scripts/free-do-cpu-remote-probe.ts`, new `tests/free-do-cpu-remote-evidence.test.ts`, and this report. The orchestrator owns integration, deployment, secret provisioning, and Cloudflare log review. There were no remote probes, deployment, secret writes, git commits, pushes, or service mutations by this worker.

Verified locally: `bun test tests/free-do-cpu-policy.test.ts tests/free-do-cpu-remote-evidence.test.ts` passed **11/11 tests, 87 assertions**; `bun run typecheck` passed; `git diff --check` passed. A local Workerd E2E or bundle build was not run because this worker was not authorized to start services or change generated files outside its ownership. Unrelated concurrent D1 conformance files were observed and left untouched. **Release gate: NO-GO until authenticated remote platform CPU and independent memory evidence exist.**
