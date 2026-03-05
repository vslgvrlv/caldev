#!/usr/bin/env bash
set -euo pipefail

BASE_URL=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url)
      BASE_URL="${2:-}"; shift 2 ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1 ;;
  esac
done

BASE_URL="${BASE_URL:-https://pbthub.ru}"
echo "Running release smoke checks for ${BASE_URL}"

echo "[1/7] health"
curl -fsS "${BASE_URL}/api/v1/health" | grep -q '"status":"ok"'

echo "[2/7] openapi"
curl -fsS "${BASE_URL}/api/v1/openapi.json" | grep -q '"openapi":"3.0.3"'

echo "[3/7] release version endpoint"
curl -fsS "${BASE_URL}/api/v1/release/version" | grep -q '"releaseId"'

echo "[4/7] auth/me anonymous"
curl -fsS "${BASE_URL}/api/v1/auth/me" | grep -q '"authenticated":false'

echo "[5/7] init anonymous is 401"
INIT_STATUS="$(curl -sS -o /tmp/pbth_release_smoke_init.out -w '%{http_code}' "${BASE_URL}/api/v1/init")"
if [[ "${INIT_STATUS}" != "401" ]]; then
  echo "Expected 401 for anonymous /api/v1/init, got ${INIT_STATUS}" >&2
  cat /tmp/pbth_release_smoke_init.out >&2
  exit 1
fi

echo "[6/7] frontend index reachable"
curl -fsSI "${BASE_URL}/" >/dev/null

echo "[7/7] legacy deprecation headers"
LEGACY_HEADERS="$(curl -fsSI "${BASE_URL}/api/health")"
echo "${LEGACY_HEADERS}" | grep -qi '^Deprecation: true'
echo "${LEGACY_HEADERS}" | grep -qi '^Sunset: '

echo "Smoke passed."
