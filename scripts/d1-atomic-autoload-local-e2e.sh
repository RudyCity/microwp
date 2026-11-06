#!/usr/bin/env bash
# Runs isolated, real Cloudflare D1 locally. Never deploys or writes remote DB.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .wrangler
CONFIG="wrangler.d1-atomic-autoload-local.jsonc"
STATE=".wrangler/d1-atomic-autoload-state"
LOG=".wrangler/d1-atomic-autoload-worker.log"
rm -rf "$STATE"
./node_modules/.bin/wrangler d1 execute microwp-d1-atomic-options-local-db \
 --local --config "$CONFIG" --persist-to "$STATE" \
 --file tests/fixtures/d1-atomic-autoload-local.sql
./node_modules/.bin/wrangler dev --config "$CONFIG" --local \
 --ip 127.0.0.1 --port 19351 --persist-to "$STATE" \
 --show-interactive-dev-session=false >"$LOG" 2>&1 &
PID=$!
cleanup(){
 kill "$PID" 2>/dev/null || true
 wait "$PID" 2>/dev/null || true
}
trap cleanup EXIT
for attempt in $(seq 1 65); do
 if curl --silent --max-time 2 http://127.0.0.1:19351/ >/dev/null 2>&1; then
  echo "PASS local D1 Worker ready"
  break
 fi
 if ! kill -0 "$PID" 2>/dev/null; then
  echo "FAIL D1 atomic proof Worker exited"
  tail -n 22 "$LOG"
  exit 1
 fi
 sleep 1
done
bun scripts/d1-atomic-autoload-local-e2e.ts
