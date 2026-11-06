#!/usr/bin/env bash
# Developer-only Cloudflare D1 proof. No remote deploy or Cloudflare account writes.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .wrangler
CONFIG="wrangler.d1-option-mutation-local.jsonc"
STATE=".wrangler/d1-option-mutation-state"
LOG=".wrangler/d1-option-mutation-worker.log"
rm -rf "$STATE"
./node_modules/.bin/wrangler d1 execute microwp-d1-options-mutation-local-db \
  --local --config "$CONFIG" --persist-to "$STATE" \
  --file tests/fixtures/d1-option-mutation-local.sql
PID=""
cleanup(){
  if [[ -n "$PID" ]]; then
    kill "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT
start(){
  ./node_modules/.bin/wrangler dev --config "$CONFIG" --local \
    --ip 127.0.0.1 --port 19353 --persist-to "$STATE" \
    --show-interactive-dev-session=false >"$LOG" 2>&1 &
  PID=$!
  local ready=0
  for attempt in $(seq 1 60); do
    if curl --silent --max-time 2 http://127.0.0.1:19353/ >/dev/null 2>&1; then
      ready=1
      break
    fi
    if ! kill -0 "$PID" 2>/dev/null; then
      echo "FAIL local D1 option Worker exited"
      tail -n 25 "$LOG"
      exit 1
    fi
    sleep 1
  done
  if [[ "$ready" != 1 ]]; then
    echo "FAIL local D1 option Worker did not become ready"
    tail -n 25 "$LOG"
    exit 1
  fi
}
start
bun scripts/d1-option-mutation-local-e2e.ts before-restart
cleanup
PID=""
start
bun scripts/d1-option-mutation-local-e2e.ts after-restart
