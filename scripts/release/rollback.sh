#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "${SCRIPT_DIR}/lib.sh"

require_cmd docker

ENV_NAME=""
TO_RELEASE=""
BASE_URL=""
PBTH_ROOT="${PBTH_ROOT:-/opt/pbth}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      ENV_NAME="${2:-}"; shift 2 ;;
    --to)
      TO_RELEASE="${2:-}"; shift 2 ;;
    --base-url)
      BASE_URL="${2:-}"; shift 2 ;;
    --root)
      PBTH_ROOT="${2:-}"; shift 2 ;;
    *)
      die "Unknown argument: $1" ;;
  esac
done

[[ "${ENV_NAME}" == "prod" || "${ENV_NAME}" == "staging" ]] || die "--env must be prod or staging"
[[ -n "${TO_RELEASE}" ]] || die "--to <releaseId> is required"

if [[ -z "${BASE_URL}" ]]; then
  if [[ "${ENV_NAME}" == "prod" ]]; then
    BASE_URL="https://pbthub.ru"
  else
    BASE_URL="https://staging.pbthub.ru"
  fi
fi

TARGET_DIR="${PBTH_ROOT}/releases/${TO_RELEASE}"
ENV_FILE="${PBTH_ROOT}/shared/env/${ENV_NAME}.env"
CURRENT_LINK="${PBTH_ROOT}/current-${ENV_NAME}"

[[ -d "${TARGET_DIR}" ]] || die "Release not found: ${TARGET_DIR}"
[[ -f "${ENV_FILE}" ]] || die "Missing env file: ${ENV_FILE}"

echo "Rolling back ${ENV_NAME} to ${TO_RELEASE}"

(
  cd "${TARGET_DIR}"
  export RELEASE_ID="${TO_RELEASE}"
  export RELEASE_COMMIT="$(grep -oE '"commit"[[:space:]]*:[[:space:]]*"[^"]+"' release-manifest.json | sed -E 's/.*"([^"]+)"/\1/' || true)"
  export RELEASE_BUILT_AT="$(grep -oE '"builtAt"[[:space:]]*:[[:space:]]*"[^"]+"' release-manifest.json | sed -E 's/.*"([^"]+)"/\1/' || true)"
  compose_cmd "${ENV_NAME}" "${TARGET_DIR}" "${ENV_FILE}" up -d --build
)

"${TARGET_DIR}/scripts/release/smoke.sh" --base-url "${BASE_URL}"
ln -sfn "${TARGET_DIR}" "${CURRENT_LINK}"
echo "${TO_RELEASE}" > "${PBTH_ROOT}/shared/manifests/current-${ENV_NAME}.txt"

echo "Rollback completed: ${TO_RELEASE} (${ENV_NAME})"
