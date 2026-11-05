# Security Policy

## Supported releases

microWP is **experimental alpha software**. There are currently **no production-supported versions** and no security patch service-level agreement.

| Version | Production security support |
| --- | --- |
| Experimental alpha / main | No |

Do not expose admin login, upload paths, database contents, or real user data to public internet traffic. In particular, crash recovery, WordPress login/session correctness, plugin compatibility, R2 upload rehydration, and Cloudflare resource constraints have not passed production validation.

## Reporting a vulnerability

Please use **GitHub's private vulnerability reporting / Security advisories** feature for this repository, if enabled by the repository owner. If that option is not available, contact the repository maintainer through an existing private channel. Do **not** post exploitation details, private tokens, or sensitive files publicly.

Include the affected commit/version, a safe reproduction, the impact, and any mitigations. Avoid scanning or attacking deployment sites you do not own.

## Operational safety

Do not commit Cloudflare credentials, real WordPress secrets, database snapshots, or media uploads. The `production:preflight` script must fail closed until every operational gate is genuinely satisfied. Passing unit tests is not production authorization.
