#!/usr/bin/env bash
# Real local D1 Workerd verification. Never remote deploy or change staging.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .wrangler
CONFIG="wrangler.d1-single-autoload-local.jsonc"
STATE=".wrangler/d1-single-autoload-state"
LOG=".wrangler/d1-single-autoload-worker.log"
rm -rf "$STATE"
./node_modules/.bin/wrangler d1 execute microwp-d1-single-options-local-db \
  --local --config "$CONFIG" --persist-to "$STATE" \
  --file tests/fixtures/d1-atomic-autoload-local.sql
./node_modules/.bin/wrangler dev --config "$CONFIG" --local \
  --ip 127.0.0.1 --port 19352 --persist-to "$STATE" \
  --show-interactive-dev-session=false >"$LOG" 2>&1 &
PID=$!
cleanup(){
  kill "$PID" 2>/dev/null || true
  wait "$PID" 2>/dev/null || true
}
trap cleanup EXIT
ready=0
for attempt in $(seq 1 65); do
  if curl --silent --max-time 2 http://127.0.0.1:19352/ >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "FAIL single-query D1 proof Worker exited"
    tail -n 25 "$LOG"
    exit 1
  fi
  sleep 1
done
if [[ "$ready" != 1 ]]; then
  echo "FAIL local Workerd never became ready"
  tail -n 25 "$LOG"
  exit 1
fi
bun scripts/d1-single-autoload-local-e2e.ts
