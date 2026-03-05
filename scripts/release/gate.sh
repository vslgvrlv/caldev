#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE_URL="${1:-https://pbthub.ru}"

"${ROOT_DIR}/scripts/gate.sh" "${BASE_URL}"
