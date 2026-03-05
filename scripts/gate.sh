#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-https://pbthub.ru}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "== PBTH release gate =="
echo "Root: ${ROOT_DIR}"
echo "Smoke URL: ${BASE_URL}"

echo
echo "[1/9] Backend install"
cd "${ROOT_DIR}/backend"
npm ci --no-audit --no-fund

echo
echo "[2/9] Backend typecheck"
npm run check

echo
echo "[3/9] Backend lint"
npm run lint

echo
echo "[4/9] Backend tests (unit + integration)"
npm run test:unit
npm run test:integration

echo
echo "[5/9] Backend build"
npm run build

echo
echo "[6/9] Frontend install"
cd "${ROOT_DIR}/pbth"
npm ci --no-audit --no-fund

echo
echo "[7/9] Frontend typecheck/lint/tests/build"
npm run typecheck
npm run lint
npm run test:unit
if [[ "${RUN_E2E:-0}" == "1" ]]; then
  npm run test:e2e
else
  echo "Skipping e2e (set RUN_E2E=1 to enable)"
fi
npm run build

echo
echo "[8/9] DB migration"
cd "${ROOT_DIR}/backend"
if [[ "${RUN_DB_MIGRATE:-1}" == "1" ]]; then
  npm run db:migrate
else
  echo "Skipping DB migration (RUN_DB_MIGRATE=0)"
fi

echo
echo "[9/9] Smoke checks"
cd "${ROOT_DIR}"
"${ROOT_DIR}/scripts/smoke-check.sh" "${BASE_URL}"

echo
echo "Gate passed."
