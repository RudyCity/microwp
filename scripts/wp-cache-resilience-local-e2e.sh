#!/usr/bin/env bash
# Local-only cache failure and recovery: real WordPress remains authoritative.
# No Cloudflare deployment, remote D1/R2 mutation, billing change or public route.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .wrangler
STATE=".wrangler/wp-cache-resilience-e2e-state"
FAULT_LOG=".wrangler/wp-cache-resilience-fault.log"
RECOVERY_LOG=".wrangler/wp-cache-resilience-recovered.log"
SITE_LOG=".wrangler/wp-cache-resilience-wordpress.log"
CONF="wrangler.wp-cache-fault-editorial-local.jsonc"
MICROWP_E2E_AUTH_BASENAME="wp-cache-resilience-auth.json"
export MICROWP_E2E_AUTH_BASENAME
export MICROWP_E2E_URL="http://127.0.0.1:19252"
rm -rf "$STATE"
rm -f ".wrangler/$MICROWP_E2E_AUTH_BASENAME"
CACHE_PID=""
SITE_PID=""
stop_site(){
 if [[ -n "$SITE_PID" ]]; then
  kill "$SITE_PID" 2>/dev/null || true
  wait "$SITE_PID" 2>/dev/null || true
  SITE_PID=""
 fi
}
stop_cache(){
 if [[ -n "$CACHE_PID" ]]; then
  kill "$CACHE_PID" 2>/dev/null || true
  wait "$CACHE_PID" 2>/dev/null || true
  CACHE_PID=""
 fi
}
cleanup(){ stop_site; stop_cache; }
trap cleanup EXIT
./node_modules/.bin/wrangler d1 migrations apply microwp-cache-resilience-local-db --local --config "$CONF" --persist-to "$STATE"
start_cache(){
 local config="$1" log="$2"
 ./node_modules/.bin/wrangler dev --config "$config" --local --ip 127.0.0.1 --port 19251 --persist-to "$STATE" --show-interactive-dev-session=false >"$log" 2>&1 &
 CACHE_PID=$!
 for attempt in $(seq 1 60); do
  if curl --silent --max-time 2 http://127.0.0.1:19251/ >/dev/null 2>&1; then
   echo "PASS local private cache Worker ready: $config"
   return 0
  fi
  if ! kill -0 "$CACHE_PID" 2>/dev/null; then
   echo "FAIL local cache Worker exited";tail -n 20 "$log";return 1
  fi
  sleep 1
 done
 echo "FAIL local cache Worker startup timeout";return 1
}
start_site(){
 ./node_modules/.bin/wrangler dev --config "$CONF" --local --ip 127.0.0.1 --port 19252 --persist-to "$STATE" --show-interactive-dev-session=false >"$SITE_LOG" 2>&1 &
 SITE_PID=$!
 for attempt in $(seq 1 90); do
  if curl --fail --silent --max-time 2 "$MICROWP_E2E_URL/__microwp/health" >/dev/null 2>&1; then
   echo "PASS local real WordPress Durable Object ready"
   return 0
  fi
  if ! kill -0 "$SITE_PID" 2>/dev/null; then
   echo "FAIL WordPress Durable Object exited";tail -n 20 "$SITE_LOG";return 1
  fi
  sleep 1
 done
 echo "FAIL WordPress startup timeout";return 1
}
start_cache wrangler.worker-cache-fault-local.jsonc "$FAULT_LOG"
start_site
bun scripts/e2e-wordpress.ts install
bun scripts/e2e-wordpress.ts publish
bun scripts/e2e-wordpress.ts verify
if ! grep -q "microWP public cache invalidation unavailable after DB commit" "$SITE_LOG"; then
 echo "FAIL failed cache RPC was not detected after successful WordPress DB commit"
 tail -n 25 "$SITE_LOG"
 exit 1
fi
echo "PASS real WordPress writes survive failed cache RPC after D1 commit"
stop_site
stop_cache
sleep 2
start_cache wrangler.worker-cache-recovered-local.jsonc "$RECOVERY_LOG"
start_site
bun scripts/e2e-wordpress.ts verify
bun scripts/wp-cache-editorial-invalidation.ts seed
bun scripts/wp-cache-editorial-invalidation.ts hit
bun scripts/wp-cache-editorial-rest.ts
bun scripts/wp-cache-editorial-invalidation.ts miss
bun scripts/wp-cache-editorial-rest.ts verify
bun scripts/wp-cache-transients-local-e2e.ts set
bun scripts/wp-cache-transients-local-e2e.ts get
echo "PASS real WordPress cache RPC failure and recovery with D1-backed editorial and transients"
