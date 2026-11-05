# Stage-3 microWP private WordPress db.php proof

**Experimental, opt-in, read-only, NOT a production WordPress database driver.**

## Grounded baseline
- `scripts/prepare-wordpress.py` pins WordPress 7.1.4 and SQLite Database Integration **3.1.3**, hashes the archives, and places the plugin's `db.copy` into the packaged `wp-content/db.php`. This new file is **not** copied or activated by the existing build.
- `src/php/native.ts` demonstrates PHP-WASM `post_message_to_js(...)` with `php.onMessage(...)` using a fixed readiness probe. It does **not** install a general SQL callback.
- `src/php/d1-protocol/worker.ts` implements a structured, versioned v1 SELECT/INSERT protocol with strict server policy. `runtime-adapter.ts` requires caller-key identity and a mandatory server-owned scope; the host must separately authenticate PHP message origins.

## Supported proof contract

Only when **trusted bootstrap** defines `MICRO_WP_D1_READONLY_PROOF === true`, the `wpdb` class already exists, and `post_message_to_js` exists, this drop-in installs `$GLOBALS['wpdb']` as `MicroWpD1ReadOnlyWpdb`. Never enable it on the production runtime. Without opt-in the include returns without changing WordPress state. If enabled without prerequisites, it throws.

Supported SQL grammar (single statement only):

```sql
SELECT id, title FROM wp_posts WHERE id = 7 LIMIT 2
SELECT id FROM wp_posts WHERE slug = 'hello' LIMIT 1
```

- Identifier-only 1–16 columns; single table; optional single equality condition with unsigned integer or SQL doubled-quote string literal; optional LIMIT (1–50, default 25).
- The SQL string is parsed in PHP and **never sent to JS/D1**. Only `{version:1,id,op:"select",table,columns,where,limit,offset:0}` JSON is sent; output is a strictly checked response with matching ID, bounded scalar rows, and `ok:true`.
- D1 table/column allowlist and tenant scope must be built **only in trusted Worker code**. The PHP flag is a local opt-in, *not* authorization. The host must establish the caller identity and reject unapproved PHP messages; arbitrary PHP code can otherwise invoke `post_message_to_js`. Do not wire this adapter into `fetch` or any public SQL route.
- Unsupported SQL, malformed replies, transport errors or denied policies throw, leaving no partial `last_result`. No fallback execution and no arbitrary SQL HTTP endpoint.

## Exact compatibility gaps

This is **not** WordPress wpdb compatibility: no installation, MySQL connection handshake, INSERT/UPDATE/DELETE, DDL, schema introspection, joins, aggregate functions, LIKE, OR/IN, ORDER BY, OFFSET, prepared placeholder expansion, escaping fidelity, transactions, collation, SHOW/DESCRIBE, `SELECT *`, backtick identifiers, `SQL_CALC_FOUND_ROWS`, `found_rows()`, full `wpdb` method and state semantics, plugin SQL, or site/multisite compatibility. The superclass's methods were not integration-tested against WordPress 7.1.4. The pinned SQLite Database Integration drop-in remains the active runtime path.

PHP CLI tests exercise only the isolated class/query contract with a fake `wpdb` base and a fake `post_message_to_js`; they do not prove WASM execution, D1 backing, correct tenant isolation in production, or WordPress E2E. The real host needs bounded origin authentication, safe onMessage lifetime, method/state conformance tests, independent production security review and real WordPress integration before activation.
