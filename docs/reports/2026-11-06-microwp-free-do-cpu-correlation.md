# microWP: Free SQLite DO private CPU canary log correlation

Date: 2026-11-06
Status: **OFFLINE DIAGNOSTIC JOIN IMPLEMENTED, REAL CLOUDFLARE CPU/MEMORY PROOF STILL MISSING**

## Purpose

The existing authenticated remote CPU canary performs seven fixed requests (five bounded CPU loop sizes, a PHP-WASM runtime probe, and a real WordPress installer GET inside SQLite-backed Durable Object fetch()). Its HTTP output already contains an opaque UUID per probe. A successful HTTP response or local Workerd result **does not** provide authoritative per-invocation CPU or peak memory.

This stage adds an offline, fail-closed correlation helper:
- src/probes/free-do-canary-correlation.ts
- scripts/correlate-free-do-canary.ts
- tests/free-do-canary-correlation.test.ts

The helper cannot contact Cloudflare or authenticate submitted telemetry. It joins a pre-existing local canary HTTP report with operator-normalized Cloudflare invocation entries **only by exact UUID and execution scope**, then compares numeric CPU against separate nominal Free Worker ingress and default SQLite DO budgets. It never estimates CPU from clientWallMs or PHP requestMs, and never sets productionReady=true.

## Operator workflow, no paid services

1. Obtain authorization for the private canary secret provisioning and an approved updated private-canary deployment. If secret installation is blocked, do not try to circumvent it.
2. Run the explicitly authorized remote canary according to docs/reports/2026-11-06-microwp-free-do-remote-evidence-readiness.md. The existing script writes ignored .wrangler/free-do-cpu-remote-results.json and does not include the token in that report.
3. Use independently authenticated Cloudflare platform observability appropriate to the Free account to inspect the real ingress Worker and SQLite Durable Object invocation cpuTime/outcome. Capture the matching opaque correlation IDs from their separate scoped structured traces and record the actual deployment version. Preserve authoritative raw evidence securely outside Git.
4. **Manually normalize** the platform observations into ignored .wrangler/free-do-cpu-platform-invocations.jsonl, one object per invocation. This format is a strict microWP diagnostic schema, not a verbatim Cloudflare API or Wrangler-tail schema:

    {"requestId":"<matching-version-4-uuid>","scope":"ingress-worker","mode":"wordpress","outcome":"ok","cpuTimeMs":null,"memoryBytes":null,"deploymentId":"<verified-version>"}

   Replace the placeholders using genuine observations. Null means **not measured**, not zero. For every one of the seven request IDs, supply independent ingress-worker and sqlite-durable-object entries. The script refuses duplicates, unknown request IDs, malformed modes or invalid numeric fields. Do not put real login cookies, staging secrets, WordPress content or account identifiers in the normalized file.
5. Run bun run cpu:correlate-canary from the repository. The tool accepts no command-line filesystem paths or URLs, reads only the two fixed ignored files, caps their sizes and does not fetch/alter remote state. A nonzero exit reports missing/failed/overbudget observations; a zero exit means **only that untrusted normalized samples meet the diagnostic format and submitted budgets**, not independent evidence provenance or production readiness.

The report always says DIAGNOSTIC_ONLY_PROVENANCE_NOT_AUTHENTICATED and productionReady:false. A fully matching CPU/memory report is not a GO decision. Cloudflare support for individual peak isolate memory metrics may be limited; if no independently trustworthy value exists, keep memoryBytes:null and production NO-GO.

Do not enable Tail Workers: Cloudflare documentation marks Tail Workers available on Paid/Enterprise, conflicting with the project Free-only rule. Use only existing Free-compatible operator observability if actually available.

## Safety and observed local verification

The verifier:
- Enforces the seven *ordered* fixed CPU/PHP/WordPress task labels and seven unique valid UUIDv4 IDs.
- Matches no more than one ingress and one DO invocation for each request, and rejects any extra, unexpected or duplicated identity.
- Tracks ingress budget 10ms CPU, DO default 30,000ms CPU, and isolate memory ceiling 128 MiB, without confusing the scopes.
- Rejects HTTP reports declaring successful verification with non-200 HTTP status.
- Requires numeric CPU and memory actually present for the corresponding diagnostic within-budget flags. Failed/exceeded outcomes, missing samples, overbudget CPU or memory never become a synthetic pass.
- Keeps the platform log source unauthenticated even when all numerical checks appear within limits.

Actual checks performed:
- bun test tests/free-do-canary-correlation.test.ts — **8 PASS, 0 FAIL, 46 assertions**.
- bun run typecheck — **PASS**.
- bun run canary:e2e — local PHP-WASM and WordPress installer inside SQLite DO **PASS**, but logged 4,022ms **client wall only**, with **no independently measured Cloudflare CPU/memory**.

Official platform references (checked 2026-11-06):
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/durable-objects/platform/limits/
- https://developers.cloudflare.com/workers/observability/logs/
- https://developers.cloudflare.com/workers/observability/logs/tail-workers/

**Release gate remains NO-GO** until genuine private remote CPU/memory evidence and full WordPress query-native D1 migration/rollback and admin/plugin E2E exist. No remote canary call, deployment, secret write, paid-plan feature or public WordPress cutover was performed by this milestone.
