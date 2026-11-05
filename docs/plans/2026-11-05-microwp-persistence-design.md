# microWP SQLite Durable Object persistence architecture (experimental)

One Durable Object serializes access to one PHP-WASM interpreter and its transient WordPress filesystem. The WordPress SQLite Database Integration plugin uses PDO SQLite to write /private/microwp.sqlite in a MEMFS isolate. After each PHP request finishes, the executor loads SQLite bytes and writes SHA256-verified versioned chunks (256KiB each) atomically into SQLite-backed Durable Object storage; only then does the Worker send the response. Each chunk is at most 256KiB; the database maximum is 8MiB, so at most 32 chunks. On a new Durable Object execution, restore occurs before booting WordPress. Corrupt/missing snapshots or media synchronization failures fail closed.

R2 write-through scans WordPress uploads after a request, rejects unexpected files and bad MIME signatures, and stores approved uploads before committing a database snapshot. PHP-side read hydration for previously uploaded media is not yet implemented, so media is NOT production ready.

Unresolved correctness: PHP SQLite file commits and the Durable Object storage transaction are separate; abrupt process failure between them can lose the last PHP changes. Need crash-injection proof and durable transactional architecture or an alternative native database bridge. Stable WordPress salts, auth sessions, safe multipart upload, cache invalidation, backup/export/restore, plugin compatibility, live memory/CPU, Cloudflare staging and rollback are also NOT VERIFIED. Public dynamic routes intentionally return HTTP 503.

DO storage supports point-in-time recovery, but actual WordPress restoration and operational rehearsals have not been done. Do not deploy for real traffic based on this document alone.
