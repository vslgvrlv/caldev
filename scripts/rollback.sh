#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_NAME="${1:-}"
RELEASE_ID="${2:-}"
BASE_URL="${3:-}"

if [[ -z "${ENV_NAME}" || -z "${RELEASE_ID}" ]]; then
  echo "Usage: $0 <prod|staging> <release-id> [base-url]" >&2
  exit 1
fi

if [[ -z "${BASE_URL}" ]]; then
  if [[ "${ENV_NAME}" == "prod" ]]; then
    BASE_URL="https://pbthub.ru"
  else
    BASE_URL="https://staging.pbthub.ru"
  fi
fi

"${ROOT_DIR}/scripts/release/rollback.sh" --env "${ENV_NAME}" --to "${RELEASE_ID}" --base-url "${BASE_URL}"
