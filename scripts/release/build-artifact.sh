#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "${SCRIPT_DIR}/lib.sh"

require_cmd tar
require_clean_git_tree

ROOT_DIR="$(project_root)"
cd "${ROOT_DIR}"

RELEASE_ID="${1:-}"
if [[ -z "${RELEASE_ID}" ]]; then
  if [[ -d "${ROOT_DIR}/.git" ]]; then
    RELEASE_ID="v$(date -u +%Y.%m.%d)-$(git rev-parse --short HEAD)"
  else
    RELEASE_ID="v$(date -u +%Y.%m.%d)-manual"
  fi
fi

if [[ -d "${ROOT_DIR}/.git" ]]; then
  COMMIT_SHA="$(git rev-parse HEAD)"
else
  COMMIT_SHA="unknown"
fi
BUILT_AT="$(iso_utc_now)"
OUT_DIR="${ROOT_DIR}/dist/releases"
STAGE_DIR="$(mktemp -d)"
ARTIFACT_NAME="pbth-release-${RELEASE_ID}.tar.gz"
ARTIFACT_PATH="${OUT_DIR}/${ARTIFACT_NAME}"
MANIFEST_PATH="${STAGE_DIR}/release-manifest.json"

mkdir -p "${OUT_DIR}"

tar -C "${ROOT_DIR}" \
  --exclude='.git' \
  --exclude='backend/node_modules' \
  --exclude='backend/dist' \
  --exclude='pbth/node_modules' \
  --exclude='pbth/dist' \
  --exclude='pbth/playwright-report' \
  --exclude='pbth/test-results' \
  -cf - \
  backend \
  pbth \
  scripts \
  docker-compose.release.yml \
  docker-compose.prod.yml \
  docker-compose.staging.yml \
  README.md \
  .env.example \
  | tar -C "${STAGE_DIR}" -xf -

MIGRATIONS_JSON="$(ls -1 backend/src/db/migrations/*.sql | xargs -n1 basename | sed 's/.*/"&"/' | paste -sd, -)"

cat > "${MANIFEST_PATH}" <<JSON
{
  "releaseId": "${RELEASE_ID}",
  "commit": "${COMMIT_SHA}",
  "builtAt": "${BUILT_AT}",
  "artifact": "${ARTIFACT_NAME}",
  "expectedMigrations": [${MIGRATIONS_JSON}],
  "smokeTargets": ["/api/v1/health", "/api/v1/openapi.json", "/api/v1/release/version"]
}
JSON

(
  cd "${STAGE_DIR}"
  tar -czf "${ARTIFACT_PATH}" .
)
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "${ARTIFACT_PATH}" > "${ARTIFACT_PATH}.sha256"
else
  shasum -a 256 "${ARTIFACT_PATH}" > "${ARTIFACT_PATH}.sha256"
fi

echo "release_id=${RELEASE_ID}"
echo "artifact_path=${ARTIFACT_PATH}"
echo "checksum_path=${ARTIFACT_PATH}.sha256"
