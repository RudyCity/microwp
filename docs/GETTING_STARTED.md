# Getting started with microWP alpha

microWP is intended for developers experimenting with WordPress on Cloudflare Workers. Use demo data only.

## Prerequisites

- Bun 1.4.x, Python 3.12+, Node.js 24+
- Git and an Internet connection for downloading pinned official WordPress and SQLite archives
- No Cloudflare API token is needed for **local** development

## Steps

1. Clone: `git clone https://github.com/RudyCity/microwp.git && cd microwp`
2. Install: `bun install --frozen-lockfile`
3. Download: `bun run sources:fetch`
4. Package PHP code and public assets: `bun run wordpress:prepare`
5. Test: `bun run check`
6. Set up **local D1**: `bunx wrangler d1 migrations apply microwp-local-dev-db --local --config wrangler.durable.jsonc`
7. Build: `bun run durable:build`
8. Run: `bun run durable:dev`

Visit `http://127.0.0.1:8796/wp-admin/install.php`. The WP installer is genuine. Use fictional email and a randomly generated test password; do **not** connect a public domain.

The configuration uses **local D1, Durable Object** request serialization/auth state and the **R2 emulator**. This does not access the remote D1 database. The media bucket name is `microwp-preview-media`; this is a local binding and does **not** imply that the bucket exists in your Cloudflare account.

## Fully automated local acceptance

`bun run e2e:local` exercises:
- Install and login WordPress
- Create and edit a published post with an authenticated REST nonce
- Upload a small PNG to R2 via WP REST
- Restart workerd and reuse the same D1/DO/R2 state
- Verify the post, admin login session and PNG survive
- Delete the media and verify the R2 object is gone, and the D1 deletion journal has no pending rows

The test also seeds one non-executable R2 theme stylesheet and verifies it is served by the Worker. The generated test account and state are ignored by Git in `.wrangler/`. The test script deletes only its own `.wrangler/e2e-ci-state` directory, **never** your normal local `.wrangler/state` data.

## Troubleshooting

- Missing WordPress ZIP: `bun run sources:fetch`, then `bun run wordpress:prepare`.
- PHP loader import/type error: `bun run wasm:prepare`.
- Wrangler port occupied: stop the previous Wrangler instance before starting another.
- Auth/login failures: rerun isolated E2E; do not copy production sessions.
- `wrangler whoami` says token expired: interactive `bunx wrangler login` is required before remote **staging** deployment. Local workerd does not require it.
- Do not disable runtime safety gates to get public traffic working. That requires security validation and explicit project operator approval.

For storage tradeoffs, D1 schema, R2 namespace and migration cautions see [D1 + R2 architecture](ARCHITECTURE_D1_R2.md). Native D1 SQL dispatch and arbitrary plugin/theme PHP installation are **not** supported in this alpha.
