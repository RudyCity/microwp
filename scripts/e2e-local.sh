#!/usr/bin/env bash
# Local workerd E2E test for experimental microWP. No Cloudflare credentials, real accounts, or public DNS.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .wrangler
TEST_STATE=".wrangler/e2e-ci-state"
LOG=".wrangler/e2e-ci-workerd.log"
rm -rf "$TEST_STATE"
rm -f ".wrangler/e2e-local-auth.json"
# Prepare the isolated local D1 database; never touch the actual Cloudflare staging DB.
./node_modules/.bin/wrangler d1 migrations apply microwp-local-dev-db --local --config wrangler.durable.jsonc --persist-to "$TEST_STATE"
# Seed one distinctive *non-executable* wp-content stylesheet into isolated local R2.
printf '%s
' '/* microwp-r2-overlay-e2e-marker */' > .wrangler/e2e-r2-theme.css
./node_modules/.bin/wrangler r2 object put microwp-preview-media/wp-content/themes/twentytwentyfive/style.css --local --persist-to "$TEST_STATE" --file .wrangler/e2e-r2-theme.css --content-type text/css
PID=""
start_worker() {
  ./node_modules/.bin/wrangler dev --config wrangler.durable.jsonc --ip 127.0.0.1 --port 8796 --persist-to "$TEST_STATE" --show-interactive-dev-session=false >"$LOG" 2>&1 &
  PID=$!
  for attempt in $(seq 1 70); do
    if curl --silent --show-error --fail --max-time 1 http://127.0.0.1:8796/__microwp/health >/dev/null 2>&1; then
      echo "PASS local workerd became ready"
      return 0
    fi
    if ! kill -0 "$PID" 2>/dev/null; then
      echo "FAIL local workerd exited during startup"
      tail -n 40 "$LOG"
      return 1
    fi
    sleep 1
  done
  echo "FAIL local workerd readiness timeout"
  tail -n 40 "$LOG"
  return 1
}
stop_worker() {
  if [[ -n "$PID" ]]; then
    kill "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
    PID=""
  fi
}
trap 'stop_worker' EXIT
echo "Running WordPress install, login, article editing, and R2 upload in local workerd..."
start_worker
curl --fail --silent --show-error --max-time 15 http://127.0.0.1:8796/wp-content/themes/twentytwentyfive/style.css | grep -q microwp-r2-overlay-e2e-marker
echo "PASS non-executable wp-content theme CSS is served from local R2 overlay"
bun scripts/e2e-wordpress.ts install
bun scripts/e2e-wordpress.ts publish
bun scripts/e2e-wordpress.ts upload
stop_worker
sleep 2
echo "Restarting workerd to verify durable DB, session and media persistence..."
start_worker
bun scripts/e2e-wordpress.ts verify
bun scripts/e2e-wordpress.ts delete
bun scripts/e2e-wordpress.ts verify
stop_worker
echo "PASS microWP local WordPress E2E"
