# microWP R36 continuation: native D1 core read families

Date: 2026-11-06
Decision: **PRIVATE LOCAL D1 READ PROOFS PASS; ACTIVE NATIVE WORDPRESS WPDB REMAINS NO-GO**
Checkout: existing G:\project\microWP main checkout, no new branch/worktree.

## Motivation from authentic WordPress SQL census

The R36 genuine WordPress 7.1.4 PHP-WASM query-hook census observed 1,723 logical SQL statements across 18 sampled PHP requests. After wp_options, the largest sampled core read families included:

- SELECT / wp_posts / WHERE+LIMIT: 35
- SELECT / wp_usermeta / WHERE+ORDER+IN: 34
- SELECT / wp_users / WHERE+LIMIT: 19
- SELECT / wp_postmeta / WHERE+ORDER+IN: 18
- taxonomy joins over wp_term_relationships + wp_term_taxonomy + wp_terms: 20 for the largest JOIN/DISTINCT/IN family, plus additional two-table taxonomy families.

The census is structural and categorical; it did not retain raw SQL text or WordPress content. Therefore this milestone deliberately implements fixed host-owned operations matching those structural needs rather than pretending to have reconstructed a general WordPress SQL parser.

## Implemented posts / postmeta reads

Module: src/php/d1-wpdb-conformance/core-reads.ts.

### Posts

readPrivateCorePostsByIds() accepts 1–16 distinct positive post IDs plus an opaque posts-read capability. It executes exactly one fixed prepared D1 SELECT over a research wp_posts fixture.

- Returns the 23 canonical WordPress core post columns (ID through comment_count), excluding the fixture-only site_id.
- Uses a trusted host scope, fixed table/columns, ID IN bindings, deterministic ID ordering and an overflow witness.
- All 18 text columns are projected through SQL-side type/byte guards (32 KiB per text field); invalid or oversized data becomes NULL and is rejected because canonical post fields are non-null in this proof.
- Aggregate returned text is capped at 256 KiB.
- Any malformed row, duplicate/out-of-order ID, foreign ID, unexpected column, wrong capability or malformed/sparse ID list fails closed before returning partial data.
- No caller raw SQL, table, projection, ORDER, LIMIT or site ID is accepted.

### Postmeta

readPrivatePostMetaByPostIds() accepts 1–32 distinct positive post IDs and a separate opaque metadata capability.

- Executes one fixed SELECT of meta_id, post_id, meta_key and meta_value using post_id IN (...) ORDER BY meta_id ASC.
- Returns at most 256 rows; row 257 is an overflow witness and causes a complete failure.
- meta_key/meta_value are nullable in WordPress. SQL projection preserves genuine NULL, while invalid type or values over 8 KiB become a non-string sentinel and are rejected. This avoids silently converting oversized metadata into NULL.
- Aggregate metadata text is capped at 256 KiB.
- The operation structurally matches the purpose of WordPress metadata-cache reads, but is NOT connected to update_meta_cache() and does not implement every plugin/meta edge case.

## Implemented user auth / usermeta reads

Module: src/php/d1-wpdb-conformance/user-reads.ts.

### Minimal auth lookup

readPrivateUserAuthByLogin() accepts exactly one bounded login and an auth-only capability.

- Executes one fixed prepared query scoped to the trusted site.
- Returns only ID, user_login, user_pass and user_status. No email, URL, activation key, display name or arbitrary profile data is returned by this proof.
- user_login is limited to 60 UTF-8 bytes and user_pass to 255 bytes.
- The password hash is a bound/result value and is never interpolated into SQL, logs or diagnostic errors.
- Duplicate matching login rows, oversized hashes, malformed rows and wrong capabilities fail closed.
- This is sensitive host-only research. It must never be exposed through an HTTP diagnostic route in production or logged.

### Usermeta

readPrivateUserMetaByUserIds() accepts up to 32 distinct user IDs using a different capability.

- One fixed prepared user_id IN (...) ORDER BY umeta_id ASC query.
- At most 256 rows with an overflow witness.
- Nullable metadata uses the same invalid-value sentinel pattern as postmeta.
- Aggregate metadata text is capped at 128 KiB.

The research fixture adds site_id to wp_users/usermeta. Canonical WordPress multisite user tables have different scoping semantics, so this is NOT proof of canonical schema parity.

## Implemented fixed taxonomy JOIN

Module: src/php/d1-wpdb-conformance/taxonomy-reads.ts.

readPrivateObjectTerms() accepts:

- 1–16 distinct object IDs,
- 1–8 explicitly validated lowercase taxonomy names,
- one host-owned taxonomy-read capability.

It executes one fixed prepared SELECT DISTINCT with these joins:

wp_term_relationships
  INNER JOIN wp_term_taxonomy
  INNER JOIN wp_terms

All three tables receive the host-owned research site scope. The query filters object_id IN (...) and taxonomy IN (...), then orders by (object_id, term_id, term_taxonomy_id) for deterministic validation.

Returned fields: object_id, term_id, name, slug, term_taxonomy_id, taxonomy, description, parent, count, term_order.

Bounds:

- term name <= 200 bytes,
- slug <= 200 bytes,
- taxonomy <= 32 bytes,
- description <= 8 KiB,
- <= 128 returned rows,
- <= 128 KiB aggregate textual output.

Malformed joins, unexpected taxonomy/object IDs, duplicate relationship identity, non-deterministic order, oversized fields and extra columns fail closed. This is NOT a generic JOIN parser and does not cover arbitrary WP_Term_Query SQL.

## Real local Workerd D1 proof

The existing localhost-only D1 proof fixture (placeholder UUID ending 0013) now also creates research versions of wp_posts, wp_postmeta, wp_users, wp_usermeta, wp_terms, wp_term_taxonomy and wp_term_relationships.

bun run d1:option-mutation-e2e verifies on actual local Cloudflare Workerd D1:

- posts [3,2,1] returns only site-A IDs [1,3], excluding site-B ID 2;
- postmeta batch returns three site-A rows and no site-B value;
- login "admin" returns only the fixed site-A hash fixture and never the site-B hash;
- usermeta batch returns only site-A rows;
- taxonomy three-table DISTINCT JOIN returns exactly (object 1/category), (object 1/post_tag), (object 3/category), with no site-B taxonomy data;
- every read remains correct after Workerd restart;
- existing option batch read, metadata SHOW/DESCRIBE, pinned UPSERT and delete proofs continue to pass.

The fixed HTTP endpoints exist only inside the localhost proof Worker. They contain fixed fixture operations; they do not accept arbitrary SQL, IDs, taxonomies, login names, table names, credentials or site IDs from the HTTP caller. Never deploy this proof Worker.

## Explicit limitations

1. The local research tables contain an artificial site_id column for strong isolation tests. This is **not the canonical WordPress schema** and does not solve production multi-tenant table/database mapping.
2. These functions are NOT imported into src/php/native.ts, src/index-durable.ts or src/php/d1-wpdb/db.php. Active WordPress still uses PHP-WASM SQLite Integration with D1 snapshot persistence.
3. No post INSERT/UPDATE/DELETE, postmeta mutations, user password mutation, role/capability interpretation, comments, taxonomy writes, SQL GROUP/COUNT, search, LIKE, date query, pagination or arbitrary WP_Query semantics are implemented here.
4. The auth proof deliberately handles a password hash but does not validate WordPress phpass/bcrypt/application-password behavior; WordPress authentication remains a separate integration/security gate.
5. Local Workerd correctness is not remote Cloudflare Free CPU, memory, daily quota or real wpdb production evidence.

## Final local verification

- bun run check: **350 PASS, 0 FAIL, 2,797 assertions across 62 test files**, TypeScript pass.
- bun run d1:option-mutation-e2e: PASS on real localhost Workerd D1 before and after restart for options, schema metadata, pinned UPSERT, posts/postmeta, users/usermeta and taxonomy.
- bun run e2e:local: PASS for authentic WordPress install, login, REST publishing/update, R2 media, restart persistence and deletion journal cleanup.
- bun run durable:build and bun run staging:build: PASS in dry-run mode; existing generated PHP-WASM direct-eval/duplicate-key bundler warnings remain unchanged.
- bun run production:preflight: expected fail-closed, **2/14 gates pass**. No production readiness state was changed.

## Release decision

This milestone materially increases typed query-native D1 coverage for the largest non-options read families observed by R36, while keeping production routes unchanged and fail-closed. It does not justify enabling native D1 wpdb.

**Research read-family milestone: PASS locally. Production: NO-GO until full schema/migration/wpdb/auth/security/backup/remote CPU-memory gates pass.**
