# microWP bootstrap ZIP-index fastpath prototype — 2026-11-05

**Scope:** standalone prototype, never connected to runtime. No deployment, route, branch, worktree, commit or push.

## Inspected baseline and trusted input

Existing `src/php/zip-files.ts:indexZip` parses ZIP central-directory metadata, lazily inflating PHP content later in `mountWordPress`. `scripts/profile-wordpress-bootstrap.ts` measures a bounded local Bun proxy, **not** Worker CPU or WordPress PHP execution. Pinned input `generated/wordpress-php.bin` (WordPress 7.1.4) was SHA-256-verified against `generated/wordpress-manifest.json`: `7daf6f588d70f6fa15d86c12c244158ec1240c10119d25b2e06d5975bf0224b9`, 6,979,199 bytes, 2,565 ZIP entries / 1,550 PHP files, declared uncompressed bytes 28,941,803.

## Implementation

New `src/php/zip-index-fastpath.ts` exports `indexZipFastpath`. The hot path reuses one TextDecoder for ASCII names and avoids allocating a split-component array for each filename. Every call creates bounded temporary entries and duplicate-name set; **no unbounded or persistent cache**. The 4,096-file, 1-MiB-per-entry and 40-MiB-total legacy constraints are preserved. Non-ASCII, malformed and unsupported ZIP entries fall back to the legacy validator. No decompression or PHP execution is performed. All 2,565 pinned-archive entries were identical to the existing index by full JSON metadata/order comparison, not just entry count.

## Measured outcomes

Bun 1.4.2, local Windows machine, 80 iterations **per parser**, sequential in one process after hash verification. This measures fresh index builds on **already resident bytes in a warm process**; not a real first-request cold Worker. Benchmark order, JIT, GC and OS caches can skew results.

| Wall time | Existing `indexZip` | Prototype |
| --- | ---: | ---: |
| Median | 1.5426 ms | 0.8465 ms |
| p90 | 2.2580 ms | 1.0486 ms |
| Minimum | 1.3598 ms | 0.7397 ms |
| Maximum | 15.3692 ms | 11.9975 ms |

Observed median ratio **1.82×**; **0.6961 ms** shorter median index time. Baseline offline profiler measured 6.141 ms index and 20.41 ms inflation for 12 selected entries, plus +15,515,648 bytes process RSS across both stages. RSS is not isolated to the index and cannot be attributed to this prototype.

## Validation

- `bun test tests/zip-index-fastpath.test.ts`: **7 pass, 0 fail**, including matching entries/offsets, sliced backing buffer, Unicode fallback, unsafe path rejection, corrupt/truncated archives, actual duplicate central-directory name rejection, and no persistent result cache.
- Final `bun run check`: `tsc --noEmit` succeeded; **110 pass, 0 fail, 426 expectations, 18 files** (other concurrent workers contributed tests).
- `bun scripts/profile-wordpress-bootstrap.ts`: passed SHA-256 verification and all 12 sample paths found.
- Inline pinned input A/B: SHA-256 checked; all 2,565 entries match; 80 measured runs each.

## CPU/memory tradeoffs and limitations

Indexing still allocates a bounded array and name set; fallback can redo scanning on unusual/invalid archives, and duplicated parser logic increases maintenance and fuzz-testing needs. Avoiding a global cache prevents memory growth and stale references, but offers no cross-request metadata reuse. No precise per-index heap allocations or isolate peak RAM were measured. PHP-WASM initialization, MEMFS nodes, PHP includes, WordPress bootstrap, D1, R2 and actual Cloudflare Worker CPU were **not profiled**.

**This does not show that Cloudflare `exceededCpu` is fixed.** Saving ~0.7 ms locally does not explain prior ~2-second WordPress installer bootstrap behavior. Keep prototype unused until independently verified with genuine cold-start and Worker CPU/memory traces, representative parity/fuzz testing and an explicit integration decision. Existing `zip-files.ts` and runtime remain unchanged.
