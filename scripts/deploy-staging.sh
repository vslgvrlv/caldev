#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACT="${1:-}"
ARG2="${2:-}"
ARG3="${3:-}"
CHECKSUM=""
BASE_URL="https://staging.pbthub.ru"

if [[ -z "${ARTIFACT}" ]]; then
  echo "Usage: $0 <artifact-path-or-url> [checksum-path-or-url] [base-url]" >&2
  exit 1
fi

if [[ -n "${ARG2}" ]]; then
  if [[ "${ARG2}" =~ ^https?:// ]] && [[ -z "${ARG3}" ]]; then
    BASE_URL="${ARG2}"
  else
    CHECKSUM="${ARG2}"
    if [[ -n "${ARG3}" ]]; then
      BASE_URL="${ARG3}"
    fi
  fi
fi

CMD=( "${ROOT_DIR}/scripts/release/deploy.sh" --env staging --artifact "${ARTIFACT}" --base-url "${BASE_URL}" )
if [[ -n "${CHECKSUM}" ]]; then
  CMD+=( --checksum "${CHECKSUM}" )
fi
"${CMD[@]}"
