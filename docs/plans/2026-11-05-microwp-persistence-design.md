> **Crash-risk mitigation (2026-11-05):** WordPress-media R2 DELETE is now deferred until after a successful Durable Object SQLite snapshot commit. Tests simulate DB commit and R2 delete failures. This prevents pre-commit destructive deletion of media but does NOT create an atomic transaction across DB/R2 or prove all abrupt crash cases.

> **Cloudflare staging update (2026-11-05):** Live locked staging uses a newly created R2 bucket. All public WordPress and media routes remain blocked. DO migration deployed, but PHP-WASM and durable persistence are not exercised remotely because public dynamic access is deliberately disabled.

# microWP SQLite Durable Object persistence architecture (experimental)

> **Alpha E2E update (2026-11-05):** The media hydration implementation and WordPress-authenticated PNG upload, serve, restart, and delete have now passed **local workerd** tests. Normal restart also retains the authenticated session and published/edited posts. This does not close the crash consistency gap or constitute a live Cloudflare validation.

One Durable Object serializes access to one PHP-WASM interpreter and its transient WordPress filesystem. The WordPress SQLite Database Integration plugin uses PDO SQLite to write /private/microwp.sqlite in a MEMFS isolate. After each PHP request finishes, the executor loads SQLite bytes and writes SHA256-verified versioned chunks (256KiB each) atomically into SQLite-backed Durable Object storage; only then does the Worker send the response. Each chunk is at most 256KiB; the database maximum is 8MiB, so at most 32 chunks. On a new Durable Object execution, restore occurs before booting WordPress. Corrupt/missing snapshots or media synchronization failures fail closed.

R2 write-through scans WordPress uploads after a request, rejects unexpected files and bad MIME signatures, and stores approved uploads before committing a database snapshot. PHP-side read hydration for previously uploaded media is not yet implemented, so media is NOT production ready.

Unresolved correctness: PHP SQLite file commits and the Durable Object storage transaction are separate; abrupt process failure between them can lose the last PHP changes. Need crash-injection proof and durable transactional architecture or an alternative native database bridge. Stable WordPress salts, auth sessions, safe multipart upload, cache invalidation, backup/export/restore, plugin compatibility, live memory/CPU, Cloudflare staging and rollback are also NOT VERIFIED. Public dynamic routes intentionally return HTTP 503.

DO storage supports point-in-time recovery, but actual WordPress restoration and operational rehearsals have not been done. Do not deploy for real traffic based on this document alone.
