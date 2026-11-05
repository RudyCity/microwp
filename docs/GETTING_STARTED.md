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
6. Build: `bun run durable:build`
7. Run: `bun run durable:dev`

Visit `http://127.0.0.1:8796/wp-admin/install.php`. The WP installer is genuine. Use fictional email and a randomly generated test password; do **not** connect a public domain.

The configuration uses the local Durable Object and R2 emulator. The media bucket name is `microwp-preview-media`; this is a local binding and does **not** imply that the bucket exists in your Cloudflare account.

## Fully automated local acceptance

`bun run e2e:local` exercises:
- Install and login WordPress
- Create and edit a published post with an authenticated REST nonce
- Upload a small PNG to R2 via WP REST
- Restart workerd and reuse the same DO/R2 state
- Verify the post, admin login session and PNG survive
- Delete the media and verify the R2 object is gone

The generated test account and state are ignored by Git in `.wrangler/`. The test script deletes only its own `.wrangler/e2e-ci-state` directory, **never** your normal local `.wrangler/state` data.

## Troubleshooting

- Missing WordPress ZIP: `bun run sources:fetch`, then `bun run wordpress:prepare`.
- PHP loader import/type error: `bun run wasm:prepare`.
- Wrangler port occupied: stop the previous Wrangler instance before starting another.
- Auth/login failures: rerun isolated E2E; do not copy production sessions.
- `wrangler whoami` says token expired: interactive `bunx wrangler login` is required before remote **staging** deployment. Local workerd does not require it.
- Do not disable runtime safety gates to get public traffic working. That requires security validation and explicit project operator approval.
