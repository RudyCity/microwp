#!/usr/bin/env bash
# ISOLATED local WordPress + Service Binding object cache editorial E2E.
# Never deploy: runs only local Wrangler dev and local D1/R2. No paid resources.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .wrangler
STATE=".wrangler/wp-cache-editorial-e2e-state"
PROVIDER_LOG=".wrangler/wp-cache-editorial-cache-worker.log"
SITE_LOG=".wrangler/wp-cache-editorial-wordpress-worker.log"
CONF="wrangler.wp-cache-editorial-local.jsonc"
MICROWP_E2E_AUTH_BASENAME="wp-cache-editorial-auth.json"
export MICROWP_E2E_AUTH_BASENAME
export MICROWP_E2E_URL="http://127.0.0.1:19152"
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
cleanup(){
 stop_site
 if [[ -n "$CACHE_PID" ]]; then
  kill "$CACHE_PID" 2>/dev/null || true
  wait "$CACHE_PID" 2>/dev/null || true
 fi
}
trap cleanup EXIT
./node_modules/.bin/wrangler d1 migrations apply microwp-wp-cache-editorial-local-db --local --config "$CONF" --persist-to "$STATE"
./node_modules/.bin/wrangler r2 object put microwp-wp-cache-editorial-local-media/wp-content/themes/twentytwentyfive/style.css --local --persist-to "$STATE" --file tests/fixtures/wordpress-cache-e2e.css --content-type text/css
./node_modules/.bin/wrangler dev --config wrangler.worker-cache.jsonc --local --ip 127.0.0.1 --port 19151 --persist-to "$STATE" --show-interactive-dev-session=false >"$PROVIDER_LOG" 2>&1 &
CACHE_PID=$!
for attempt in $(seq 1 55); do
 if curl --silent --max-time 2 http://127.0.0.1:19151/ >/dev/null 2>&1; then break; fi
 if ! kill -0 "$CACHE_PID" 2>/dev/null; then
  echo "FAIL isolated cache Worker quit during start"; tail -n 30 "$PROVIDER_LOG"; exit 1
 fi
 sleep 1
done
start_site(){
 ./node_modules/.bin/wrangler dev --config "$CONF" --local --ip 127.0.0.1 --port 19152 --persist-to "$STATE" --show-interactive-dev-session=false >"$SITE_LOG" 2>&1 &
 SITE_PID=$!
 for attempt in $(seq 1 80); do
  if curl --fail --silent --max-time 2 "$MICROWP_E2E_URL/__microwp/health" >/dev/null 2>&1; then
   echo "PASS WordPress Worker ready with cache Service Binding connected"
   return 0
  fi
  if ! kill -0 "$SITE_PID" 2>/dev/null; then
   echo "FAIL WordPress cache editorial Worker quit"; tail -n 30 "$SITE_LOG"; return 1
  fi
  sleep 1
 done
 echo "FAIL WordPress cache editorial Worker readiness timeout";tail -n 30 "$SITE_LOG";return 1
}
start_site
curl --fail --silent --max-time 12 "$MICROWP_E2E_URL/wp-content/themes/twentytwentyfive/style.css" | grep -q 'microwp-cache-editorial-marker'
bun scripts/e2e-wordpress.ts install
# Database-backed WordPress transient and site-transient behavior with the
# hybrid object-cache drop-in (public Worker cache remains enabled).
bun scripts/wp-cache-transients-local-e2e.ts set
bun scripts/wp-cache-transients-local-e2e.ts get
bun scripts/wp-cache-transients-local-e2e.ts update
bun scripts/wp-cache-transients-local-e2e.ts verify-update
bun scripts/wp-cache-transients-local-e2e.ts expire-set
sleep 3
bun scripts/wp-cache-transients-local-e2e.ts missing
bun scripts/wp-cache-transients-local-e2e.ts set
bun scripts/wp-cache-transients-local-e2e.ts get
bun scripts/wp-cache-editorial-invalidation.ts seed
bun scripts/wp-cache-editorial-invalidation.ts hit
bun scripts/e2e-wordpress.ts publish
bun scripts/wp-cache-editorial-invalidation.ts miss
bun scripts/wp-cache-editorial-invalidation.ts seed
bun scripts/wp-cache-editorial-rest.ts
bun scripts/wp-cache-editorial-invalidation.ts miss
bun scripts/wp-cache-editorial-invalidation.ts seed
bun scripts/e2e-wordpress.ts upload
bun scripts/wp-cache-editorial-invalidation.ts miss
stop_site
sleep 2
start_site
bun scripts/e2e-wordpress.ts verify
bun scripts/wp-cache-transients-local-e2e.ts get
bun scripts/wp-cache-transients-local-e2e.ts delete
bun scripts/wp-cache-transients-local-e2e.ts missing
bun scripts/wp-cache-editorial-rest.ts verify
bun scripts/e2e-wordpress.ts delete
bun scripts/e2e-wordpress.ts verify
stop_site
./node_modules/.bin/wrangler d1 execute microwp-wp-cache-editorial-local-db --local --config "$CONF" --persist-to "$STATE" --command "SELECT COUNT(*) AS pending FROM microwp_media_delete_journal;" --json | python -c 'import json,sys; x=json.load(sys.stdin); n=x[0]["results"][0]["pending"]; assert n==0, f"{n} unfinished media deletes"; print("PASS local D1 deletion journal empty")'
echo "PASS real WordPress editorial + opt-in Worker-only object-cache Service Binding"
