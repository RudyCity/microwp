# microWP contributor instructions

Workspace: G:\project\microWP. Never create a new worktree or branch without permission.
Status: private local WordPress preview; NOT production-ready.

- Pinned official WordPress 7.1.4 and SQLite Integration 3.1.3 are sha256 verified; do not replace with latest without a separate audit.
- WordPress PHP runs in PHP 8.4.27 WASM via a lazy ZIP-mounted MEMFS. Never expose PHP sources or wp-config through static assets.
- Single-site Durable Object with snapshot persistence is experimental; DB is limited to 8MiB and media rehydration remains incomplete.
- No public dynamic routes. Do not deploy to Cloudflare production until production preflight is genuinely verified and operator approves.
- Never log auth tokens/salts, login cookies or real site content. Do not commit .dev.vars, vendor sources or generated binary bundles.
- After changes run: bun run check; bun run durable:build; curl local install and static assets.
- Cloudflare isolate memory limit 128MB including WASM. Worker package <=64MiB. Do not turn on WP page cache until edit invalidation.
- PHP WASM, WordPress, SQLite Integration are GPL-2.0-or-later. Comply with notices and source distribution.
