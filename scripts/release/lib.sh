#!/usr/bin/env bash
set -euo pipefail

die() {
  echo "ERROR: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

iso_utc_now() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

project_root() {
  cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd
}

require_clean_git_tree() {
  local root
  root="$(project_root)"
  if [[ ! -d "${root}/.git" ]]; then
    echo "WARN: ${root} is not a git repository, skipping clean-tree check" >&2
    return
  fi
  if [[ "${ALLOW_DIRTY_RELEASE:-0}" == "1" ]]; then
    return
  fi
  if [[ -n "$(git -C "${root}" status --porcelain)" ]]; then
    die "Working tree is dirty. Commit/stash changes or set ALLOW_DIRTY_RELEASE=1"
  fi
}

compose_cmd() {
  local env_name="$1"
  local release_dir="$2"
  local env_file="$3"
  shift 3
  docker compose \
    --project-name "pbth-${env_name}" \
    --env-file "${env_file}" \
    -f "${release_dir}/docker-compose.release.yml" \
    -f "${release_dir}/docker-compose.${env_name}.yml" \
    "$@"
}
