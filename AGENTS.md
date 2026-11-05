# microWP contributor instructions

Workspace: G:\project\microWP. Never create a new worktree or branch without permission.
Status: public open-source experimental alpha v0.2.0-alpha.4; staging locked; NOT production-ready.

- Pinned official WordPress 7.1.4 and SQLite Integration 3.1.3 are sha256 verified; do not replace with latest without a separate audit.
- WordPress PHP runs in PHP 8.4.27 WASM via a lazy ZIP-mounted MEMFS. Never expose PHP sources or wp-config through static assets.
- WordPress uses transient PHP-WASM PDO SQLite; Cloudflare D1 is the authoritative verified SQLite image snapshot store (8MiB preview cap). A single-site Durable Object serializes requests and stores per-site auth secret. Do not describe this as native D1 SQL WordPress wpdb.
- R2 stores uploads in wp-content/uploads/ and read-only trusted static assets in wp-content/themes, plugins and mu-plugins. Executable PHP must remain in pinned immutable archives.
- Deletion journal migration 0002 atomically records R2 media deletions with each D1 snapshot; upload orphan cleanup is not yet production ready.
- No public dynamic routes. Do not deploy to Cloudflare production until production preflight is genuinely verified and operator approves.
- Never log auth tokens/salts, login cookies or real site content. Do not commit .dev.vars, vendor sources or generated binary bundles.
- After changes run: bun run check; bun run durable:build; bun run staging:build; bun run e2e:local. All staging remote mutations require orchestrator authorization and public route smoke tests.
- Cloudflare isolate memory limit 128MB including WASM. Worker package <=64MiB. Do not turn on WP page cache until edit invalidation.
- PHP WASM, WordPress, SQLite Integration are GPL-2.0-or-later. Comply with notices and source distribution.

## Delegated multi-chat development

- Delegate workers operate on non-overlapping file scopes in the same repo and `main`, without branches or worktrees. Orchestrator assigns scopes and is the only actor to commit, push or deploy.
- Workers do not claim success without tested repository changes; CPU and security research must distinguish local proxy measurements from Cloudflare platform metrics.
- Independent new modules or tests may be developed concurrently; shared entrypoints, migrations, lockfiles and releases are orchestrator-owned.
- Do not treat experimental SQL message transport as native WordPress wpdb/D1 query support. All public WordPress routes remain blocked until production gates pass.
