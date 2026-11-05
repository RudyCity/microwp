# PHP 8.4.27 WASM proof in Cloudflare workerd

**Status:** Proof passed locally on 2026-11-05: `GET /__microwp/php-probe` returned `200 microWP PHP 8.4.27` from local Wrangler/workerd (NOT a Cloudflare production deployment).

```sh
bun run wasm:prepare
bun run wasm:build
bun run wasm:dev
curl http://127.0.0.1:8798/__microwp/php-probe
```

The PHP wasm binary (~19 MB) is imported as a Worker WebAssembly module. The standard WordPress Playground browser loader relies on `new URL(..., import.meta.url)`, which fails at workerd startup. `scripts/prepare-php-wasm.ts` reproducibly replaces only that URL in a generated, ignored Emscripten JS loader. `instantiateWasm` passes the compiled Worker module to Emscripten. No uncommitted edits inside `node_modules` are required.

This is *only* a PHP string echo proof, not a working WordPress runtime. Still necessary: WordPress core bootstrapping, bounded filesystem packaging, PHP extensions, HTTP/cookies/server vars, database and wpdb bridges, R2 file writes, concurrency serialization, 128 MB high-water accounting, compatibility and security tests.

**Licensing:** `@php-wasm/universal` and `@php-wasm/web-8-4` are GPL-2.0-or-later. Generated Emscripten source is upstream-derived; preserve license obligations if distributing it.

## HTTP bridge proof (2026-11-05)
Local workerd probe also passed GET query parsing and POST form/cookie handling inside PHP 8.4.27: method, REQUEST_URI, $_GET, $_POST and $_COOKIE match request. The probe serializes access to one PHP instance to avoid cross-request mutable state overlap. Its PHP code is fixed at build time; there is no arbitrary request-driven eval.
