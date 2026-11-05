# Contributing to microWP

Thanks for considering a contribution. microWP is an **experimental alpha** WordPress/PHP-WASM runtime for Cloudflare Workers, not a production-ready hosting platform.

## Getting started

1. Use Bun 1.4.x, Python 3.12+, and Node.js 24+ on an authorized development computer.
2. Run `bun install`, `bun run sources:fetch` and `bun run wordpress:prepare`.
3. Run `bun run check`, `bun run native:build`, and `bun run durable:build` before a pull request.
4. Describe the problem, explain the change, include regression tests, and note any security or memory implications.

## Design constraints

- Do not commit `.dev.vars`, credentials, tokens, user uploads, SQLite databases, generated WordPress/PHP WASM binaries, or local machine paths containing user details.
- Keep third-party WordPress, SQLite Database Integration, and PHP-WASM source dependencies pinned and verified by SHA256.
- Test the 128 MiB Cloudflare isolate limit and transaction recovery before claiming production support.
- Preserve license information and attribution of third-party projects.
- Please avoid breaking PHP, WordPress, or Cloudflare runtime compatibility without a documented migration.
- Do not enable public WordPress requests or deploy to others' infrastructure as part of a pull request.

## Contributor license

By submitting code, you agree that your contribution may be distributed under the project's **GNU GPL-2.0-or-later** license. You must have permission to contribute the code you submit.

## Issues and pull requests

Report reproducible bugs and feature requests through GitHub Issues. For suspected security vulnerabilities, **do not open a public issue**; see `SECURITY.md`.
