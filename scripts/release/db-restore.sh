#!/usr/bin/env bash
# Восстановление базы PBTH из дампа, снятого db-backup.sh.
#
# Порядок безопасный: текущая база не удаляется.
#   1. Снимается ещё одна копия текущей базы (метка before-restore).
#   2. Бэкенд останавливается.
#   3. Дамп разворачивается в новую базу <db>_restore_<время>.
#   4. Только если разворот прошёл, базы меняются именами:
#      текущая -> <db>_before_restore_<время>, восстановленная -> <db>.
#   5. Бэкенд запускается.
# Старая база остаётся на сервере, пока её не удалят руками (см. RELEASE_PROTOCOL.md).
#
# Пример:
#   ./scripts/release/db-restore.sh --env prod \
#     --file /opt/pbth/shared/backups/prod/pbth-prod-20261111T020000Z-pre-v2026.11.11-1.dump \
#     --confirm prod
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

die() {
  echo "ERROR: $*" >&2
  exit 1
}

log() {
  echo "[db-restore] $*" >&2
}

ENV_NAME=""
FILE=""
CONFIRM=""
PBTH_ROOT="${PBTH_ROOT:-/opt/pbth}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      ENV_NAME="${2:-}"; shift 2 ;;
    --file)
      FILE="${2:-}"; shift 2 ;;
    --confirm)
      CONFIRM="${2:-}"; shift 2 ;;
    --root)
      PBTH_ROOT="${2:-}"; shift 2 ;;
    *)
      die "Unknown argument: $1" ;;
  esac
done

[[ "${ENV_NAME}" == "prod" || "${ENV_NAME}" == "staging" ]] || die "--env must be prod or staging"
[[ -n "${FILE}" && -s "${FILE}" ]] || die "--file must point to a non-empty dump"
[[ "${CONFIRM}" == "${ENV_NAME}" ]] || die "Pass --confirm ${ENV_NAME} to restore the ${ENV_NAME} database"
command -v docker >/dev/null 2>&1 || die "Required command not found: docker"

PROJECT="pbth-${ENV_NAME}"

container_of() {
  local service="$1"
  local id
  id="$(docker ps -q \
    --filter "label=com.docker.compose.project=${PROJECT}" \
    --filter "label=com.docker.compose.service=${service}" | head -n1)"
  if [[ -z "${id}" ]]; then
    id="$(docker ps -q --filter "name=^${PROJECT}-${service}-1$" | head -n1)"
  fi
  echo "${id}"
}

DB_CONTAINER="${PBTH_DB_CONTAINER:-$(container_of db)}"
[[ -n "${DB_CONTAINER}" ]] || die "DB container for ${PROJECT} is not running"
BACKEND_CONTAINER="${PBTH_BACKEND_CONTAINER:-$(container_of backend)}"

db_sql() {
  # SQL со stdin к служебной базе postgres; :"name" — переменные psql.
  docker exec -i "${DB_CONTAINER}" sh -c \
    'exec psql -q -X -o /dev/null -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -v cur="$POSTGRES_DB" -v tmp="$1" -v bak="$2"' \
    sh "$1" "$2"
}

log "Checking dump ${FILE}"
docker exec -i "${DB_CONTAINER}" pg_restore --list < "${FILE}" >/dev/null \
  || die "Dump is not readable by pg_restore"

log "Taking a safety backup of the current database"
"${SCRIPT_DIR}/db-backup.sh" --env "${ENV_NAME}" --root "${PBTH_ROOT}" --label before-restore >/dev/null \
  || die "Safety backup failed; nothing was changed"

STAMP="$(date -u +%Y%m%d_%H%M%S)"
CUR_DB="$(docker exec "${DB_CONTAINER}" sh -c 'printf %s "$POSTGRES_DB"')"
TMP_DB="${CUR_DB}_restore_${STAMP}"
BAK_DB="${CUR_DB}_before_restore_${STAMP}"

start_backend() {
  if [[ -n "${BACKEND_CONTAINER}" ]]; then
    log "Starting backend ${BACKEND_CONTAINER}"
    docker start "${BACKEND_CONTAINER}" >/dev/null || log "WARN: failed to start backend, start it manually"
  fi
}

if [[ -n "${BACKEND_CONTAINER}" ]]; then
  log "Stopping backend ${BACKEND_CONTAINER}"
  docker stop "${BACKEND_CONTAINER}" >/dev/null
else
  log "WARN: backend container not found, continuing"
fi

log "Restoring into new database ${TMP_DB}"
if ! docker exec "${DB_CONTAINER}" sh -c 'exec createdb -U "$POSTGRES_USER" -O "$POSTGRES_USER" "$1"' sh "${TMP_DB}"; then
  start_backend
  die "createdb ${TMP_DB} failed; current database untouched"
fi

if ! docker exec -i "${DB_CONTAINER}" sh -c \
  'exec pg_restore -U "$POSTGRES_USER" -d "$1" --no-owner --role="$POSTGRES_USER" --exit-on-error --single-transaction' \
  sh "${TMP_DB}" < "${FILE}"; then
  docker exec "${DB_CONTAINER}" sh -c 'exec dropdb -U "$POSTGRES_USER" --if-exists "$1"' sh "${TMP_DB}" || true
  start_backend
  die "pg_restore failed; current database untouched"
fi

log "Swapping databases: ${CUR_DB} -> ${BAK_DB}, ${TMP_DB} -> ${CUR_DB}"
if ! db_sql "${TMP_DB}" "${BAK_DB}" <<'SQL'
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = :'cur' AND pid <> pg_backend_pid();
ALTER DATABASE :"cur" RENAME TO :"bak";
SQL
then
  start_backend
  die "Could not rename current database; it is untouched. Restored copy is in ${TMP_DB}"
fi

if ! db_sql "${TMP_DB}" "${BAK_DB}" <<'SQL'
ALTER DATABASE :"tmp" RENAME TO :"cur";
SQL
then
  log "Rename of restored database failed, putting the old one back"
  db_sql "${TMP_DB}" "${BAK_DB}" <<'SQL' || true
ALTER DATABASE :"bak" RENAME TO :"cur";
SQL
  start_backend
  die "Restore aborted; current database is back in place. Restored copy is in ${TMP_DB}"
fi

start_backend

log "Restore done. Previous database kept as ${BAK_DB}."
log "When the app is verified, drop it manually:"
log "  docker exec ${DB_CONTAINER} sh -c 'dropdb -U \"\$POSTGRES_USER\" ${BAK_DB}'"
