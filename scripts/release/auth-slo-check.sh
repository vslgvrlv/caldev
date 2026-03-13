#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://pbthub.ru}"
WINDOW_MINUTES="${WINDOW_MINUTES:-60}"
TOKEN="${AUTH_SLO_TOKEN:-}"
FAIL_ON_INSUFFICIENT="${FAIL_ON_INSUFFICIENT:-0}"
RESOLVE_HOST="${AUTH_SLO_RESOLVE_HOST:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url)
      BASE_URL="${2:-}"; shift 2 ;;
    --window-minutes)
      WINDOW_MINUTES="${2:-}"; shift 2 ;;
    --token)
      TOKEN="${2:-}"; shift 2 ;;
    --resolve-host)
      RESOLVE_HOST="${2:-}"; shift 2 ;;
    --fail-on-insufficient)
      FAIL_ON_INSUFFICIENT="1"; shift ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1 ;;
  esac
done

ENDPOINT="${BASE_URL%/}/api/v1/auth/slo?windowMinutes=${WINDOW_MINUTES}"
CURL_ARGS=(-fsS)

if [[ -n "${RESOLVE_HOST}" ]]; then
  BASE_WITHOUT_SCHEME="${BASE_URL#*://}"
  HOST_PORT="${BASE_WITHOUT_SCHEME%%/*}"
  HOST="${HOST_PORT%%:*}"
  if [[ "${HOST_PORT}" == *:* ]]; then
    PORT="${HOST_PORT##*:}"
  elif [[ "${BASE_URL}" == https://* ]]; then
    PORT="443"
  else
    PORT="80"
  fi
  CURL_ARGS+=(--resolve "${HOST}:${PORT}:${RESOLVE_HOST}")
fi

if [[ -n "${TOKEN}" ]]; then
  PAYLOAD="$(curl "${CURL_ARGS[@]}" -H "x-auth-slo-token: ${TOKEN}" "${ENDPOINT}")"
else
  PAYLOAD="$(curl "${CURL_ARGS[@]}" "${ENDPOINT}")"
fi

echo "Auth SLO payload: ${PAYLOAD}"

printf '%s' "${PAYLOAD}" | FAIL_ON_INSUFFICIENT="${FAIL_ON_INSUFFICIENT}" node -e '
const fs = require("fs");
const raw = fs.readFileSync(0, "utf8");
const payload = JSON.parse(raw);

const attempts = Number(payload.attempts || 0);
const successRate = typeof payload.successRate === "number" ? `${(payload.successRate * 100).toFixed(2)}%` : "n/a";
const errorRate = typeof payload.errorRate === "number" ? `${(payload.errorRate * 100).toFixed(2)}%` : "n/a";

console.log(`Auth SLO status=${payload.status} attempts=${attempts} successRate=${successRate} errorRate=${errorRate}`);

if (payload.status === "breached") {
  console.error("Auth error budget breached.");
  process.exit(2);
}

if (payload.status === "insufficient_data" && process.env.FAIL_ON_INSUFFICIENT === "1") {
  console.error("Insufficient auth attempts for SLO evaluation.");
  process.exit(3);
}
'
