#!/usr/bin/env bash
# Validate real WordPress never silently resets after a local D1 manifest loss.
# Deliberate deletion is ONLY within an isolated, ignored Workerd test database.
# NEVER deploy this config or perform this test against a remote Cloudflare D1.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .wrangler
CONFIG="wrangler.d1-absence-recovery-local.jsonc"
DATABASE="microwp-d1-absence-recovery-local-db"
STATE=".wrangler/d1-absence-recovery-local-state"
LOG=".wrangler/d1-absence-recovery-local.log"
MICROWP_E2E_AUTH_BASENAME="d1-absence-recovery-auth.json"
export MICROWP_E2E_AUTH_BASENAME
export MICROWP_E2E_URL="http://127.0.0.1:19452"
rm -rf "$STATE"
rm -f ".wrangler/$MICROWP_E2E_AUTH_BASENAME"
PID=""
stop_worker(){
 if [[ -n "$PID" ]]; then
  kill "$PID" 2>/dev/null || true
  wait "$PID" 2>/dev/null || true
  PID=""
 fi
}
trap stop_worker EXIT
./node_modules/.bin/wrangler d1 migrations apply "$DATABASE" --local  --config "$CONFIG" --persist-to "$STATE"
start_worker(){
 ./node_modules/.bin/wrangler dev --config "$CONFIG" --local --ip 127.0.0.1   --port 19452 --persist-to "$STATE" --show-interactive-dev-session=false   >"$LOG" 2>&1 &
 PID=$!
 for attempt in $(seq 1 75); do
  if curl --silent --fail --max-time 2 "$MICROWP_E2E_URL/__microwp/health" >/dev/null 2>&1; then
   echo "PASS isolated local WordPress Durable Object ready"
   return 0
  fi
  if ! kill -0 "$PID" 2>/dev/null; then
   echo "FAIL isolated Durable Object exited";tail -n 20 "$LOG";return 1
  fi
  sleep 1
 done
 echo "FAIL isolated Durable Object readiness timeout"
 return 1
}
start_worker
bun scripts/e2e-wordpress.ts install
bun scripts/e2e-wordpress.ts publish
bun scripts/e2e-wordpress.ts verify
stop_worker
sleep 2
echo "Injecting a missing manifest into the ISOLATED LOCAL D1 database only"
./node_modules/.bin/wrangler d1 execute "$DATABASE" --local  --config "$CONFIG" --persist-to "$STATE"  --command "DELETE FROM microwp_db_snapshots;" >.wrangler/d1-absence-recovery-injection.log
start_worker
bun -e '
const url="http://127.0.0.1:19452/";
const first=await fetch(url,{redirect:"manual",signal:AbortSignal.timeout(25000)});
const body=await first.json();
if(first.status!==503||body.error!=="DB_PERSISTENCE_FAILED")
 throw Error("Previously installed WordPress unexpectedly reset after lost D1 snapshot: "+first.status);
console.log("PASS missing D1 manifest returns 503, not an uninstalled WordPress page");
const repeat=await fetch(url,{redirect:"manual",signal:AbortSignal.timeout(10000)});
const second=await repeat.json();
if(repeat.status!==503||second.error!=="DB_STORAGE_UNAVAILABLE")
 throw Error("Failed Durable Object must remain fail-closed until operator recovery");
console.log("PASS subsequent WordPress requests remain fail-closed");
'
echo "PASS isolated real WordPress D1 manifest-loss recovery guard"
