#!/usr/bin/env bash
# R36 real WordPress SQL census, strictly local Workerd D1/R2 and private MU plugin.
# Never deploy this fixture or use Cloudflare remote resources.
set -euo pipefail
cd "$(dirname "$0")/.."
CONFIG="wrangler.r36-sql-census-local.jsonc"
STATE=".wrangler/r36-sql-census-state"
LOG=".wrangler/r36-sql-census-workerd.log"
export MICROWP_E2E_URL="http://127.0.0.1:19356"
export MICROWP_E2E_AUTH_BASENAME="r36-sql-census-auth.json"
mkdir -p .wrangler
rm -rf "$STATE"
rm -f ".wrangler/$MICROWP_E2E_AUTH_BASENAME" \
 ".wrangler/r36-sql-census-before-restart.json" \
 ".wrangler/r36-sql-census-after-restart.json"
./node_modules/.bin/wrangler d1 migrations apply microwp-r36-sql-census-local-db \
 --local --config "$CONFIG" --persist-to "$STATE"
PID=""
stop_worker(){
 if [[ -n "$PID" ]]; then
  kill "$PID" 2>/dev/null || true
  wait "$PID" 2>/dev/null || true
  PID=""
 fi
}
trap 'stop_worker' EXIT
start_worker(){
 ./node_modules/.bin/wrangler dev --config "$CONFIG" --local \
  --ip 127.0.0.1 --port 19356 --persist-to "$STATE" \
  --show-interactive-dev-session=false >"$LOG" 2>&1 &
 PID=$!
 local ready=0
 for i in $(seq 1 70); do
  if curl --silent --fail --max-time 2 http://127.0.0.1:19356/__microwp/health >/dev/null 2>&1; then
   ready=1
   break
  fi
  if ! kill -0 "$PID" 2>/dev/null; then
   echo "FAIL R36 local WordPress Workerd exited"; tail -n 25 "$LOG"; exit 1
  fi
  sleep 1
 done
 if [[ "$ready" != 1 ]]; then
  echo "FAIL R36 local Workerd readiness"; tail -n 25 "$LOG"; exit 1
 fi
}
start_worker
if [[ "$(curl --silent --output /dev/null --write-out '%{http_code}' \
 --max-time 5 http://127.0.0.1:19356/__local/r36-sql-census)" != "404" ]]; then
 echo "FAIL public GET on local census route"; exit 1
fi
echo "PASS local census GET denied"
bun scripts/e2e-wordpress.ts install
bun scripts/e2e-wordpress.ts publish
bun scripts/e2e-wordpress.ts upload
bun scripts/r36-read-sql-census.ts before-restart
stop_worker
sleep 2
start_worker
bun scripts/e2e-wordpress.ts verify
bun scripts/e2e-wordpress.ts delete
bun scripts/r36-read-sql-census.ts after-restart
stop_worker
echo "PASS R36 local SQL census proof, never remote Cloudflare CPU or complete SQL coverage"
