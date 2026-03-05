#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-https://pbthub.ru}"
echo "Running smoke checks for: ${BASE_URL}"

echo
echo "[1/8] API v1 health"
curl -fsS "${BASE_URL}/api/v1/health" | grep -q '"status":"ok"'
echo "  OK"

echo
echo "[2/8] Legacy health alias with deprecation headers"
LEGACY_HEADERS="$(curl -fsSI "${BASE_URL}/api/health")"
echo "${LEGACY_HEADERS}" | grep -qi '^Deprecation: true'
echo "${LEGACY_HEADERS}" | grep -qi '^Sunset: '
echo "  OK"

echo
echo "[3/8] Auth state (anonymous should be unauthenticated)"
ME_JSON="$(curl -fsS "${BASE_URL}/api/v1/auth/me")"
echo "${ME_JSON}" | grep -q '"authenticated":false'
echo "  OK -> ${ME_JSON}"

echo
echo "[4/8] Init should require authentication for anonymous request"
INIT_STATUS="$(curl -sS -o /tmp/pbth_init_smoke.out -w '%{http_code}' "${BASE_URL}/api/v1/init")"
if [[ "${INIT_STATUS}" != "401" ]]; then
  echo "  FAIL -> expected 401, got ${INIT_STATUS}"
  cat /tmp/pbth_init_smoke.out
  exit 1
fi
echo "  OK -> HTTP ${INIT_STATUS}"

echo
echo "[5/9] OpenAPI reachable"
curl -fsS "${BASE_URL}/api/v1/openapi.json" | grep -q '"openapi":"3.0.3"'
echo "  OK"

echo
echo "[6/9] Release version endpoint reachable"
curl -fsS "${BASE_URL}/api/v1/release/version" | grep -q '"releaseId"'
echo "  OK"

echo
echo "[7/9] Frontend index reachable"
curl -fsSI "${BASE_URL}/" >/dev/null
echo "  OK"

echo
echo "[8/9] Telegram endpoints reachable"
curl -fsSI "${BASE_URL}/api/v1/auth/telegram/start" >/dev/null
curl -fsSI "${BASE_URL}/api/v1/auth/telegram/callback" >/dev/null || true
echo "  OK"

echo
echo "[9/9] Vendor scripts reachable"
curl -fsSI "${BASE_URL}/api/v1/vendor/tailwindcss.js" >/dev/null
curl -fsSI "${BASE_URL}/api/v1/vendor/telegram-web-app.js" >/dev/null
echo "  OK"

echo
echo "Smoke checks passed."
echo
echo "Manual checks still required:"
echo "  1) Open app from Telegram menu button and verify automatic login."
echo "  2) Create event as CAPTAIN/ADMIN and verify it appears in dashboard/calendar."
echo "  3) Open invite link in Telegram, login, and verify user joins team."
