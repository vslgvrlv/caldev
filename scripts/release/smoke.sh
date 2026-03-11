#!/usr/bin/env bash
set -euo pipefail

BASE_URL=""
SKIP_FRONTEND="false"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url)
      BASE_URL="${2:-}"; shift 2 ;;
    --skip-frontend)
      SKIP_FRONTEND="true"; shift ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1 ;;
  esac
done

BASE_URL="${BASE_URL:-https://pbthub.ru}"
echo "Running release smoke checks for ${BASE_URL}"

if [[ "${SKIP_FRONTEND}" != "true" && "${BASE_URL}" =~ ^https?://(127\.0\.0\.1|localhost)(:[0-9]+)?$ ]]; then
  # Server-side staging smoke may target backend-only localhost URL.
  SKIP_FRONTEND="true"
fi

wait_for_health() {
  local url="$1"
  local attempts="${2:-20}"
  local delay="${3:-1}"
  local i
  for ((i = 1; i <= attempts; i++)); do
    if curl -fsS "${url}/api/v1/health" | grep -q '"status":"ok"'; then
      return 0
    fi
    sleep "${delay}"
  done
  return 1
}

echo "[1/8] health"
if ! wait_for_health "${BASE_URL}" 30 1; then
  echo "Health check failed after retries: ${BASE_URL}/api/v1/health" >&2
  exit 1
fi

echo "[2/8] openapi"
curl -fsS "${BASE_URL}/api/v1/openapi.json" | grep -q '"openapi":"3.0.3"'

echo "[3/8] release version endpoint"
curl -fsS "${BASE_URL}/api/v1/release/version" | grep -q '"releaseId"'

echo "[4/8] auth/me anonymous"
curl -fsS "${BASE_URL}/api/v1/auth/me" | grep -q '"authenticated":false'

echo "[5/8] init anonymous is 401"
INIT_STATUS="$(curl -sS -o /tmp/pbth_release_smoke_init.out -w '%{http_code}' "${BASE_URL}/api/v1/init")"
if [[ "${INIT_STATUS}" != "401" ]]; then
  echo "Expected 401 for anonymous /api/v1/init, got ${INIT_STATUS}" >&2
  cat /tmp/pbth_release_smoke_init.out >&2
  exit 1
fi

if [[ "${SKIP_FRONTEND}" == "true" ]]; then
  echo "[6/8] frontend index reachable (skipped)"
else
  echo "[6/8] frontend index reachable"
  curl -fsSI "${BASE_URL}/" >/dev/null
fi

echo "[7/8] legacy deprecation headers"
LEGACY_HEADERS="$(curl -fsSI "${BASE_URL}/api/health")"
echo "${LEGACY_HEADERS}" | grep -qi '^Deprecation: true'
echo "${LEGACY_HEADERS}" | grep -qi '^Sunset: '

echo "[8/8] auth slo endpoint"
SLO_STATUS="$(curl -sS -o /tmp/pbth_release_smoke_auth_slo.out -w '%{http_code}' "${BASE_URL}/api/v1/auth/slo")"
if [[ "${SLO_STATUS}" != "200" && "${SLO_STATUS}" != "401" && "${SLO_STATUS}" != "404" ]]; then
  echo "Unexpected /api/v1/auth/slo status: ${SLO_STATUS}" >&2
  cat /tmp/pbth_release_smoke_auth_slo.out >&2
  exit 1
fi

echo "Smoke passed."
