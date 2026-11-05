## What changed?

Briefly explain the user-visible behavior and why this change is needed.

## Verification

- [ ] `bun run check`
- [ ] `bun run durable:build`
- [ ] `bun run e2e:local` (if runtime, database, media, auth, or routing changed)
- [ ] No credentials, database snapshots, upload data, or generated PHP/WordPress binaries included
- [ ] Security and 128 MiB isolate-memory implications considered
- [ ] Documentation / changelog updated when relevant

## Production readiness

microWP is experimental alpha. **Do not present a green test run as permission to deploy real sites.** If this PR changes a production gate, provide evidence of independent staging tests and recovery.
