# Experimental WordPress `get_option()` → Native D1 Conformance

Date: 2026-11-06. **Local tests PASS; production implementation remains disabled.**

## Scope

The user requires real server-side WordPress PHP-WASM in Cloudflare Workers Free/Durable Objects, with a native D1 `wpdb` adapter as the longer-term goal. The existing experimental private D1 protocol already has structured SELECT/INSERT and narrowly authorized UPDATE/DELETE, but does not yet implement the full WordPress MySQL dialect.

This milestone adds one intentionally narrow, safe `get_option()` SQL-template compatibility slice at `src/php/d1-wpdb-conformance/options-get.ts`.

A trusted pre-prepare caller provides exactly this WordPress SQL template:

```sql
SELECT option_value FROM wp_options WHERE option_name = %s LIMIT 1
```

The option name is a separately supplied string, bounded to 191 UTF-8 bytes. The translator refuses all other SQL text and emits only a bounded version-1 structured SELECT request. It rejects already interpolated SQL, statements with extra clauses, unsupported tables or wildcards, missing parameters, and invalid request identifiers. No source SQL reaches `D1.prepare()`.

A real in-memory SQLite test uses the existing D1 runtime adapter to prove the server-owned `site_id` scope is appended as a prepared binding, one site's option cannot read another site's data, and an injection-like option name remains a bound value rather than executable SQL.

## Tests and outcome

```bash
bun test tests/d1-wpdb-conformance-get-option.test.ts
bun run check
```

The independent translator tests PASS. This is a conformance research slice, **not an installed WordPress `db.php`** and not full WordPress `get_option()` coverage. WordPress's normal Options API also loads autoloaded options, may use serialized values and additional SQL forms, and requires site-aware table-prefix mapping and error/transaction semantics. The next implementation stage must catalog those queries and expand the structured protocol safely before enabling WordPress native D1.

The separate Free Durable Object CPU canary still requires an authorized remote secret, deploy/readiness workflow and genuine Cloudflare invocation CPU/memory evidence. No remote deployment, billing changes or staging activation was performed in this milestone.

**Release status: experimental, locally tested, production NO-GO.**
