# microWP Stage-2 — Independent Security & E2E Audit
Date: 2026-11-05 (Asia/Jakarta)

Scope: read-only source review of branch `main` in `G:\project\microWP`, with offline unit regressions only. No Cloudflare reads/writes, deploy, git commits, or production penetration testing.

## Verdict
**NO-GO for public WordPress hosting** until the P1 items below are addressed and exercised with controlled failure injection. **No confirmed remote P0 exploit** was found in the reviewed paths. This is a code/isolated-test verdict, not a production security certification.

## Evidence and findings

### P1-01 — Authorized "read-only" private probe has destructive write side effects
Evidence: `src/index-durable.ts:101-125`. After passing `isAuthorizedProbe`, the `storage-write-test` scope calls `saveD1SQLite`, `drainD1MediaDeleteJournal` (R2 deletes), and then unconditional cleanup of three D1 tables filtered by a fixed canary site ID. The probe's high-level description says "fixed read-only PHP" (`src/index-durable.ts:103`, `src/staging-probe.ts:4-6`), which is false for this scope. The cleanup could remove concurrent canary evidence and can leave intermediate state if cleanup fails; it is safe only with a truly isolated binding and operator-only authorization. `wrangler.staging.jsonc:11-12` currently names staging bindings, but runtime does not assert their identity. **Not a bypass of the secret check**.
Repro (static): inspect lines 108-125; request method must be HTTPS POST, correct key, staging flag. No live request was sent.
Action: remove this scope from any externally reachable route or require out-of-band operator control; use unique per-invocation canary site IDs, finally cleanup with bounded retries and explicit durable cleanup tracking, and validate dedicated resource bindings. Separate docs and permissions for mutating diagnostics.

### P1-02 — R2-first writes leave orphaned media on failed D1 commit
Evidence: `src/php/uploads.ts:68-75` persists R2 and updates the in-memory digest before `src/index-durable.ts:69-85` captures/saves SQLite. If D1 batch fails after an upload, the DO sets a permanent 503 latch (`index-durable.ts:87-90`) but R2 already contains the object. `src/storage/r2-orphan-audit.ts:103-132` is a dry-run planner, not cleanup; its trusted reference extractor is a dependency, not yet proven exhaustive. This is a **crash-consistency/cost correctness gap**, not evidence of unauthorized access.
Repro design (offline only): stub `MEDIA.put` success, `DB.batch` rejection; assert R2 object persists while request returns 503. Restart and verify reconciliation is fail-closed unless full attachment, meta, GUID, content, derivatives and extension/plugin references are proven.
Action: introduce persistent upload intent journal/reconciliation with protected key ranges; never automatically purge from a partial reference list.

### P1-03 — Content-length is not an early streaming memory limit
Evidence: `src/php/native.ts:61-66` validates a declared Content-Length but then calls `await request.arrayBuffer()` before verifying the actual size. A chunked or missing-length POST can consume arbitrarily large request memory before the 1 MiB rejection. Serialized handling does not bound pre-buffering (body read occurs before `oneAtATime`). `src/php/native.ts:103-106` similarly checks response size only after PHP constructs it.
Repro: construct a large Request stream with no Content-Length in an isolated runtime and observe full consumption before status 413. Do not use real ingress for this test.
Action: enforce a counting bounded stream reader / request-body cancellation (and an ingress Content-Length cap). Bound PHP output at source and consider CPU/time budget.

### P1-04 — Snapshot/R2 read amplification and sticky availability failure
Evidence: `src/storage/d1-sqlite.ts:41-53` reassembles up to 8 MiB across up to 32 chunks, hashes a copy (`src/storage/sqlite-snapshot.ts:18-21`), then `src/php/native.ts:116-126` duplicates bytes into WASM. `src/php/uploads.ts:16-39` may fully materialize 16 MiB in another runtime heap. `src/index-durable.ts:21-55` stores `firstLoad` even when rejected, while `failed` becomes sticky on requests (`87-90`): recovery needs an isolate replacement/operator action. This favors integrity over availability but lacks a measured peak-memory and restart policy.
Action: quantify peak memory under worst allowed snapshot+media, bounded isolate restart/circuit-breaker policy, and partial-read fault injection. Do not weaken integrity checks just to restore availability.

### P1-05 — Path key validation differs across independent layers
Evidence: `src/media.ts:13-18` accepts URL-reserved/control characters within a path after its prefix as long as extension and dot-segment constraints pass, while `src/storage/r2-orphan-audit.ts:49-55` rejects control chars, `?#%`, and backslash. E.g. an internal `r2MediaKey('/wp-content/uploads/a%2fb.png')` can be non-null yet the orphan auditor refuses its key. The public HTTP gateway uses `safePathname` (`src/security.ts:8-21`) and thus mitigates direct traversal on its entry path; this is **not** proof of a public traversal exploit. However legitimate persisted entries using these unusual names can block conservative audit/recovery. The media hydration path separately uses `mediaKey` rather than the stricter audit key predicate.
Action: share one canonical, round-trip-safe uploads key predicate across write, hydrate, journal, and reconciliation. Explicitly deny controls, percent encoding ambiguity, query/hash delimiters, Unicode normalization ambiguity, and trailing problematic segments. Preserve read-only compatibility for historical objects, never unsafe deletion.

### P1-06 — Shared singleton prevents tenant isolation assumptions
Evidence: `src/index-durable.ts:153` selects a constant DO name, and `src/storage/d1-sqlite.ts:14` uses a default static site ID; `src/php/config.ts` pins WP table prefix to `wp_`. This supports a single site, not multi-tenant isolation. Any future host-based tenancy without per-tenant DO IDs, DB keys, secrets, R2 namespace, policy scopes and tests risks cross-site exposure.
Action: publicly document single-site-only; no multi-tenant claims. Before expanding, enforce trusted host-to-site routing and a separate tenant-aware threat model.

### P1-07 — Orphan evidence is caller-asserted, not independently attested
Evidence: `src/storage/r2-orphan-audit.ts:116-119` trusts an injected `extractReferences` function's `complete:true` flag; it correctly fails closed on false, truncated listings, >32 objects, and revision changes. No snapshot parser here proves completeness in the presence of unknown plugin references, thumbnail derivatives or embedded URLs. Its `deletionAuthorized:false` is correct; it must remain a planning-only output.
Action: do not promote candidates to deletion while plugin and external references remain unprovable; record explicit INCOMPLETE status.

## Controls verified by inspection
- D1 snapshot reads use bound `site_id` queries and SHA-256 verification, manifest and chunk size guards (`d1-sqlite.ts:20-54`).
- D1 SQL prototype (`src/php/d1-protocol/protocol.ts`, `worker.ts`) denies raw SQL, validates identifiers, binds values, injects server-owned scope where provided, caps 50 rows and responses. No public SQL route observed. **Security still depends on the server policy always specifying scope for tenant-owned tables.**
- Private probe (`src/staging-probe.ts:10-26`) requires HTTPS POST, exact probe pathname, no query, staging flag, 64-128-character secret and digest comparison. No unauthenticated bypass identified in inspected code.
- Gateway blocks non-local routes after health/private-probe branches (`index-durable.ts:141-154`); public media/asset paths remain gated. `/__microwp/health` intentionally exposes small capability metadata even on public staging.
- R2 public media reads permit only GET/HEAD and typed extensions; PHP/HTML/SVG are denied at write (`src/media.ts:13-74`), and static overlay is separately extension-gated.
- Snapshot+journal changes use one D1 batch transaction (`d1-sqlite.ts:67-81`); replay deletes R2 before acknowledging the journal (`109-121`). Crash recovery is correctly fail-closed in intent.

## E2E release gate (not performed on live resources)
1. Run `bun test tests/stage2-security-regression.test.ts` and `bun run check` locally.
2. Simulate bad SQL, denied tenant policy, malformed R2 key, encoded path traversal and wrong/missing private probe key. Assert no D1/R2 methods are reached.
3. Inject D1 batch fault after successful R2 upload; verify fail-closed behavior and durable orphan audit evidence without deletion.
4. Inject crash at every journal boundary (before D1 commit, after commit/before R2 delete, after R2 delete/before journal ACK). Restore from fresh isolate and compare D1/R2 state.
5. Validate public host rejects WordPress, uploads and theme assets, including HEAD/OPTIONS; probe requires HTTPS POST/key; health metadata scope reviewed.
6. Profile worst-case 8 MiB DB, 32 media objects/16 MiB hydration, 1 MiB request and 2 MiB response ceilings. Include chunked requests and R2 truncated listings.
7. Before any production launch, remove or fully isolate mutating staging probes; audit actual Cloudflare route/bindings, auth secrets and resource isolation.

## Audit limitations
No authenticated live staging calls, billing mutations, performance measurements, full WordPress plugin enumeration, Cloudflare account inspection, or destructive fault injection. The review is source-based and isolated; P1 labels indicate release blockers/risk, not demonstrated external exploitability. Concurrent workers may add prototype files after this review; re-audit the final merged working tree before release.

## Verification results (executed on this branch)
- bun test tests/stage2-security-regression.test.ts: PASS, 5 tests, 0 failures, 22 assertions.
- bun run check: PASS; tsc --noEmit succeeded; bun test: PASS, 110 tests across 18 files, 0 failures, 425 assertions.
- git status --short: only newly created Stage-2 worker files were untracked; Worker D authored exactly the two files listed in this report.
- No Cloudflare account operations or live E2E tests were performed.

## Orchestrator remediation after independent audit (2026-11-05)

After Worker D finished its read-only audit, the orchestrator addressed two of the identified P1 code findings in separate, tested changes: **P1-03** now streams request bodies with a real 1 MiB limit and early cancellation for oversized chunked bodies; **P1-05** now denies ambiguous upload key characters/normalization across the R2 write path. The audit text above remains the original snapshot of findings; do not read its P1-03/P1-05 source references as describing the final code after these corrections. Additional integration and local WordPress E2E tests are required before these remediations count as shipped. All other findings remain open.
