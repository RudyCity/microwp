# Cloudflare Free WordPress CPU: ingress Worker versus SQLite Durable Object

Date: 2026-11-06. **No new remote Cloudflare probe was executed. Production is not certified.**

## Critical correction to historical CPU interpretation

The previously deployed microWP private staging probe logged one successful PHP runtime request (8 ms CPU, HTTP 200) and one failed WordPress installer request (`exceededCpu`, ~2,010 ms CPU, ~2,108 ms wall). The exact historical evidence remains in `docs/reports/2026-11-05-cloudflare-private-runtime-canary.md`.

Inspecting `src/index-durable.ts` establishes that this historical route handled `PROBE_PATH` in the **outer ingress Worker**, calling `runNativeStagingProbe(env,scope)` before forwarding ordinary requests to `env.SITE_DO`. Therefore that 2,010 ms `exceededCpu` observation is **not evidence that a SQLite-backed Durable Object itself exceeded its CPU allowance**.

Cloudflare's official documentation (verified 2026-11-06) differentiates the execution budgets:

| Execution scope | Cloudflare Free default per-request CPU allowance | Reference |
| --- | ---: | --- |
| Ordinary ingress Worker | 10 ms | https://developers.cloudflare.com/workers/platform/limits/ |
| SQLite-backed Durable Object | 30,000 ms (30 seconds) | https://developers.cloudflare.com/durable-objects/platform/limits/ |
| Per-isolate memory (including WebAssembly) | 128 MiB | https://developers.cloudflare.com/workers/platform/limits/ |

The 30-second default applies to the Durable Object invocation itself, **not** to the invoking gateway Worker. The ordinary ingress Worker must still remain within Free limits. Cold-start and memory constraints apply independently.

The separate `src/probes/free-do-cpu.ts` is explicitly designed to call `runNativeStagingProbe()` inside `MicroWPFreeCpuDO.fetch`, which can test this distinction without making WordPress public. However no remote canary secret or authenticated live DO CPU measurement was available in this development pass, and the existing historical ingress outcome does **not** prove the DO will pass.

## Audit tooling (offline only)

- `src/probes/free-cpu-budget-evidence.ts`: checks operator-supplied **remote Cloudflare** invocation evidence against the correct scope; never confuses client-side wall time with actual Cloudflare CPU time and never concludes production readiness from CPU alone.
- `scripts/audit-cloudflare-free-cpu.ts`: reads only a bounded, ignored `.wrangler/*.jsonl` file. It never makes network requests, deploys or reads cloud secrets. Invalid, missing or local Workerd measurements are not promoted to passing remote CPU evidence.
- `tests/cloudflare-free-cpu-evidence.test.ts`: covers 10 ms ingress, 30,000 ms SQLite DO, 128 MiB memory, an `exceededCpu` outcome that overrides an apparent numeric budget pass, missing CPU/memory and a source-level guard proving which runtime executed the historical staging probe.

The input schema is deliberately explicit: one JSON line with `evidenceSource:"cloudflare-remote"`, `scope:"ingress-worker"|"sqlite-durable-object"`, `phase:"php-runtime"|"wordpress-installer"|"wordpress-editorial"`, `outcome`, `cpuTimeMs`, `wallTimeMs`, and `memoryBytes`. Input origin is **not cryptographically attested**, so the report is diagnostics-only; operators must correlate with authenticated Cloudflare invocation details. The tool does not inspect raw logs that could contain cookies or private headers.

Example invocation (only after separately placing reviewed, redacted Cloudflare evidence into ignored local storage):

```bash
bun scripts/audit-cloudflare-free-cpu.ts .wrangler/free-cpu-evidence.jsonl
```

Do not use this tool to fabricate samples or turn local wall measurements into Cloudflare CPU.

## Required next remote gate

1. Use the existing private `microwp-free-do-cpu-probe` design and provision the required strong canary key through an explicit authorized secure workflow; no key is committed to Git.
2. Capture independent **cold/warm** PHP and actual WordPress installer invocation CPU **for the DO**, plus the outer ingress Worker, directly from Cloudflare metrics/tail. Correlate each invocation with its scope.
3. Establish real memory/isolate behavior below 128 MiB under cold and warm WordPress loads; CPU alone is insufficient. Check Worker startup, reliability, R2 and D1 snapshots, request quotas and data isolation.
4. Continue full native D1 WordPress `wpdb` compatibility and reversible migration, with WordPress editorial and plugin tests before any public rollout.

**Decision: historical 2-second failure belongs to the ingress Worker and does not rule out real WordPress inside a Free SQLite-backed Durable Object; production remains NO-GO until a separate real DO canary and memory E2E pass.**
