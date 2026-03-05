#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "${SCRIPT_DIR}/lib.sh"

require_cmd docker
require_cmd tar
require_cmd curl

ENV_NAME=""
ARTIFACT=""
CHECKSUM=""
BASE_URL=""
PBTH_ROOT="${PBTH_ROOT:-/opt/pbth}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      ENV_NAME="${2:-}"; shift 2 ;;
    --artifact)
      ARTIFACT="${2:-}"; shift 2 ;;
    --checksum)
      CHECKSUM="${2:-}"; shift 2 ;;
    --base-url)
      BASE_URL="${2:-}"; shift 2 ;;
    --root)
      PBTH_ROOT="${2:-}"; shift 2 ;;
    *)
      die "Unknown argument: $1" ;;
  esac
done

[[ "${ENV_NAME}" == "prod" || "${ENV_NAME}" == "staging" ]] || die "--env must be prod or staging"
[[ -n "${ARTIFACT}" ]] || die "--artifact is required"

if [[ -z "${BASE_URL}" ]]; then
  if [[ "${ENV_NAME}" == "prod" ]]; then
    BASE_URL="https://pbthub.ru"
  else
    BASE_URL="https://staging.pbthub.ru"
  fi
fi

RELEASES_DIR="${PBTH_ROOT}/releases"
SHARED_DIR="${PBTH_ROOT}/shared"
ENV_FILE="${SHARED_DIR}/env/${ENV_NAME}.env"
CURRENT_LINK="${PBTH_ROOT}/current-${ENV_NAME}"

mkdir -p "${RELEASES_DIR}" "${SHARED_DIR}/env" "${SHARED_DIR}/manifests"
[[ -f "${ENV_FILE}" ]] || die "Missing env file: ${ENV_FILE}"

TMP_DIR="$(mktemp -d)"
ARTIFACT_PATH="${TMP_DIR}/release.tar.gz"
CHECKSUM_PATH="${TMP_DIR}/release.tar.gz.sha256"

if [[ "${ARTIFACT}" =~ ^https?:// ]]; then
  curl -fL "${ARTIFACT}" -o "${ARTIFACT_PATH}"
else
  [[ -f "${ARTIFACT}" ]] || die "Artifact not found: ${ARTIFACT}"
  cp "${ARTIFACT}" "${ARTIFACT_PATH}"
fi

if [[ -n "${CHECKSUM}" ]]; then
  if [[ "${CHECKSUM}" =~ ^https?:// ]]; then
    curl -fL "${CHECKSUM}" -o "${CHECKSUM_PATH}"
  else
    [[ -f "${CHECKSUM}" ]] || die "Checksum file not found: ${CHECKSUM}"
    cp "${CHECKSUM}" "${CHECKSUM_PATH}"
  fi

  if command -v sha256sum >/dev/null 2>&1; then
    (cd "${TMP_DIR}" && sha256sum -c "$(basename "${CHECKSUM_PATH}")")
  else
    EXPECTED="$(awk '{print $1}' "${CHECKSUM_PATH}")"
    ACTUAL="$(shasum -a 256 "${ARTIFACT_PATH}" | awk '{print $1}')"
    [[ "${EXPECTED}" == "${ACTUAL}" ]] || die "Checksum mismatch for artifact"
  fi
fi

EXTRACT_DIR="${TMP_DIR}/extract"
mkdir -p "${EXTRACT_DIR}"
tar -xzf "${ARTIFACT_PATH}" -C "${EXTRACT_DIR}"

MANIFEST_FILE="${EXTRACT_DIR}/release-manifest.json"
[[ -f "${MANIFEST_FILE}" ]] || die "release-manifest.json missing in artifact"

RELEASE_ID="$(grep -oE '"releaseId"[[:space:]]*:[[:space:]]*"[^"]+"' "${MANIFEST_FILE}" | sed -E 's/.*"([^"]+)"/\1/')"
[[ -n "${RELEASE_ID}" ]] || die "Cannot read releaseId from manifest"

TARGET_DIR="${RELEASES_DIR}/${RELEASE_ID}"
if [[ -d "${TARGET_DIR}" ]]; then
  echo "Release directory already exists: ${TARGET_DIR} (reuse)"
else
  mkdir -p "${TARGET_DIR}"
  cp -R "${EXTRACT_DIR}/." "${TARGET_DIR}/"
fi

PREV_RELEASE=""
if [[ -L "${CURRENT_LINK}" ]]; then
  PREV_RELEASE="$(basename "$(readlink "${CURRENT_LINK}")")"
fi

echo "Deploying ${RELEASE_ID} to ${ENV_NAME}"
echo "Previous release: ${PREV_RELEASE:-none}"
echo "Target dir: ${TARGET_DIR}"

(
  cd "${TARGET_DIR}"
  export RELEASE_ID="${RELEASE_ID}"
  export RELEASE_COMMIT="$(grep -oE '"commit"[[:space:]]*:[[:space:]]*"[^"]+"' release-manifest.json | sed -E 's/.*"([^"]+)"/\1/')"
  export RELEASE_BUILT_AT="$(grep -oE '"builtAt"[[:space:]]*:[[:space:]]*"[^"]+"' release-manifest.json | sed -E 's/.*"([^"]+)"/\1/')"

  compose_cmd "${ENV_NAME}" "${TARGET_DIR}" "${ENV_FILE}" up -d db
  compose_cmd "${ENV_NAME}" "${TARGET_DIR}" "${ENV_FILE}" build backend frontend
  compose_cmd "${ENV_NAME}" "${TARGET_DIR}" "${ENV_FILE}" run --rm backend node dist/db/migrate.js
  compose_cmd "${ENV_NAME}" "${TARGET_DIR}" "${ENV_FILE}" up -d backend frontend
)

"${TARGET_DIR}/scripts/release/smoke.sh" --base-url "${BASE_URL}"

ln -sfn "${TARGET_DIR}" "${CURRENT_LINK}"
echo "${RELEASE_ID}" > "${SHARED_DIR}/manifests/current-${ENV_NAME}.txt"
if [[ -n "${PREV_RELEASE}" ]]; then
  echo "${PREV_RELEASE}" > "${SHARED_DIR}/manifests/previous-${ENV_NAME}.txt"
fi

echo "Deploy completed: ${RELEASE_ID} (${ENV_NAME})"
