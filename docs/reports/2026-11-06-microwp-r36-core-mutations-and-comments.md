# microWP R36 continuation: native D1 core mutations and comments

Date: 2026-11-06
Decision: **PRIVATE LOCAL D1 MUTATION/COMMENT PROOFS PASS; ACTIVE WORDPRESS WPDB REMAINS NO-GO**
Checkout: existing G:\project\microWP main checkout; no branch/worktree.

## Motivation

The R36 authentic WordPress 7.1.4 PHP-WASM query census observed write and comment families that remained unverified after the read-side milestone:

- INSERT / wp_posts / simple: 5 sampled statements.
- UPDATE / wp_posts / WHERE: 4 sampled statements.
- INSERT / wp_postmeta / simple: 5 sampled statements.
- DELETE / wp_postmeta / WHERE: 2 sampled statements.
- SELECT / wp_comments / WHERE+IN+COUNT: 24 sampled statements.
- SELECT / wp_comments / WHERE+ORDER+LIMIT+IN: 8 sampled statements.
- INSERT / wp_comments / simple: 1 sampled statement.

The census is categorical, not a raw-SQL corpus. This milestone therefore adds typed host-owned operations, not a guessed WordPress SQL parser.

## Post and postmeta mutation proof

Module: src/php/d1-wpdb-conformance/core-mutations.ts.

### Post insert

insertPrivateCorePost() accepts a complete bounded core post row plus an opaque post-insert capability.

- Fixed wp_posts table and trusted site scope.
- One prepared INSERT with all values bound; content cannot become SQL.
- Explicit positive ID is required by the research fixture. Canonical WordPress AUTO_INCREMENT/last_insert_id semantics are NOT implemented.
- Text fields are capped at 32 KiB each.
- Duplicate scoped ID, malformed result metadata, wrong capability, unexpected fields, invalid values and database errors fail closed.

### Post update

updatePrivateCorePost() accepts a positive post ID and 1–8 explicitly allowlisted fields.

- ID and site scope cannot be changed by the patch.
- One prepared UPDATE scoped by server-owned site_id + ID.
- A missing or cross-site ID returns changed:0 rather than touching another tenant.
- Post DELETE is deliberately absent. Safe deletion requires verified dependent postmeta, taxonomy, comments, media references, cache invalidation and crash/retry semantics.

### Postmeta insert/update/delete

insertPrivatePostMeta() uses one INSERT ... SELECT ... WHERE EXISTS statement so the parent post must exist in the same trusted site. A foreign/missing parent is a zero-row no-op.

updatePrivatePostMeta() and deletePrivatePostMeta() are bound to the server-owned site scope and meta_id. The update permits only meta_key/meta_value; it cannot re-parent metadata to another post.

Meta key is capped at 255 bytes and meta value at 8 KiB in this proof. Canonical plugin metadata may exceed this and must fail, never truncate.

## Comments and commentmeta proof

Module: src/php/d1-wpdb-conformance/comments.ts.

### Count

countPrivateApprovedCommentsByPostIds() executes one fixed GROUP BY query over 1–16 post IDs and 1–4 explicit approval states. Returned groups must be unique, ordered and limited to the requested post IDs.

### Ordered comments

readPrivateCommentsByPostIds() executes one fixed site-scoped comment_post_ID IN (...) ORDER BY comment_ID query, capped at 128 comments and 256 KiB aggregate text. All core comment fields are type/size validated.

### Insert

insertPrivateComment() uses one INSERT ... SELECT ... WHERE EXISTS statement. The comment is inserted only if its parent post exists in the same trusted site. No caller SQL, table, scope, projection or WHERE clause is accepted.

The proof uses an explicit comment_ID and does not implement canonical AUTO_INCREMENT/last_insert_id, moderation hooks, notifications, spam handling or comment-count update transactions.

### Commentmeta

readPrivateCommentMetaByCommentIds() reads up to 32 comment IDs, at most 256 rows, ordered by meta_id. Genuine NULL and empty strings are preserved; invalid/oversized values fail closed.

## Real Workerd D1 evidence

The localhost-only Workerd fixture now includes research wp_comments and wp_commentmeta tables in addition to the earlier posts/users/taxonomy/options tables.

bun run d1:option-mutation-e2e proves on real local D1:

- approved comment count and ordered read exclude site B;
- commentmeta read excludes site B;
- parent-guarded comment insert succeeds for site-A post 1;
- post ID 5 insert succeeds under site A;
- post ID 5 title/status update is visible through the independent core read path;
- postmeta ID 30 insert/update is visible through the independent postmeta read path;
- post/postmeta writes and inserted comment survive Workerd restart;
- postmeta delete after restart removes only the site-A row;
- all prior options, schema metadata, UPSERT, users/usermeta and taxonomy proofs continue to pass.

The local proof endpoints are fixed developer-only operations. They accept no SQL, IDs, login names, comments, table names, site IDs or arbitrary values from HTTP. Never deploy this Worker.

## Why db.php is still not connected

The current R36 census intentionally discards raw SQL text for privacy and minimizes data retention. That means it provides structural families but not the exact WordPress 7.1.4 prepared SQL templates required for a safe write parser. Extending src/php/d1-wpdb/db.php now would require guessing SQL spellings and MySQL/wpdb semantics.

Therefore:

- the new write/comment helpers are NOT imported by db.php, native.ts, index-durable.ts or staging;
- no raw SQL fallback was added;
- no active WordPress storage path changed;
- a future opt-in adapter must use a separately captured, sanitized/template-only WordPress SQL corpus or direct typed WordPress integration, plus exact last_insert_id/affected-row/hook/cache semantics.

## Final local verification

- bun run check: **364 PASS, 0 FAIL, 2,880 assertions across 64 test files**; TypeScript pass.
- bun run d1:option-mutation-e2e: PASS on real localhost Workerd D1 for post/postmeta writes, comments/count/commentmeta, all prior read families, and restart persistence.
- bun run e2e:local: PASS for authentic WordPress install, login, REST publishing/update, R2 media lifecycle, restart persistence and deletion-journal cleanup.
- bun run durable:build and bun run staging:build: PASS in dry-run mode. Existing generated PHP-WASM direct-eval/duplicate-key warnings remain unchanged.
- bun run production:preflight: expected fail-closed at **2/14 gates**. No production readiness flag was changed.

## Known blockers

1. Research tables contain artificial site_id columns; this is not canonical WordPress schema parity.
2. WordPress AUTO_INCREMENT IDs, insert_id, affected rows, transactions, retries and conflict semantics are incomplete.
3. Post DELETE/cascade, taxonomy writes, comment update/delete, comment_count synchronization and cache invalidation are not implemented.
4. WordPress hooks, auth/nonces, plugin SQL, media references, revision/autosave behavior and rollback remain outside this proof.
5. Remote Cloudflare Free CPU/RAM, actual D1/R2 quota behavior, backup/restore and production security gates are still unverified.

Production must remain fail-closed.
