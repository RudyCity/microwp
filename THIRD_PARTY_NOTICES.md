# Third-party source and license notices

microWP's original source is offered under **GPL-2.0-or-later**. The repository's `LICENSE` contains the GNU GPL version 2 text, and the project grants the option to follow any later version published by the Free Software Foundation.

The runtime builds on independently maintained projects and is **not affiliated with or endorsed by the WordPress Foundation, Automattic, or Cloudflare**.

| Component | Version pinned for experimental runtime | Project and license |
| --- | --- | --- |
| WordPress | 7.1.4 | https://wordpress.org/ — GPL-2.0-or-later |
| SQLite Database Integration | 3.1.3 | https://wordpress.org/plugins/sqlite-database-integration/ — GPL-2.0-or-later |
| WordPress Playground PHP-WASM packages | 3.1.62 | https://github.com/WordPress/wordpress-playground — GPL-2.0-or-later |
| fflate | 0.8.3 | https://github.com/101arrowz/fflate — MIT |
| Cloudflare Workers types / Wrangler | see lockfile | https://github.com/cloudflare/workers-sdk — respective package licenses |
| Bun | build and test tooling | https://bun.sh/ — MIT |

Pinned official WordPress and SQLite ZIPs are fetched and verified during local builds. Neither WordPress source ZIPs nor compiled PHP-WASM modules are committed to this repository; see `scripts/fetch-sources.ts`, `scripts/prepare-wordpress.py`, and `scripts/prepare-php-wasm.ts` for reproducible build steps. Other transitive dependency license notices remain the responsibility of their respective maintainers and should be preserved when redistributing assembled artifacts.

The **WP** acronym is used descriptively, not as a claim of WordPress sponsorship. WordPress trademarks remain with their owners.
