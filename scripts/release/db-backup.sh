#!/usr/bin/env bash
# Копия базы PBTH перед выкатом (до миграций).
#
# Дамп снимается изнутри контейнера базы его же pg_dump, поэтому на сервере
# не нужно ничего, кроме docker. Файл — формат custom (-Fc, уже сжат),
# в /opt/pbth/shared/backups/<env>/. Хранится последних --keep копий.
#
# Скрипт самодостаточный: не подключает lib.sh, его можно передать на сервер
# через `ssh host 'bash -s -- --env prod' < db-backup.sh` (так делают
# workflow выката, пока чекаут /root/caldev на сервере не обновлён).
#
# Последняя строка stdout — путь к готовому дампу. Код выхода не 0 —
# дампа нет, выкат должен остановиться.
set -euo pipefail

die() {
  echo "ERROR: $*" >&2
  exit 1
}

log() {
  echo "[db-backup] $*" >&2
}

ENV_NAME=""
PBTH_ROOT="${PBTH_ROOT:-/opt/pbth}"
LABEL="manual"
KEEP="${PBTH_DB_BACKUP_KEEP:-20}"
REUSE_MINUTES="0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      ENV_NAME="${2:-}"; shift 2 ;;
    --root)
      PBTH_ROOT="${2:-}"; shift 2 ;;
    --label)
      LABEL="${2:-}"; shift 2 ;;
    --keep)
      KEEP="${2:-}"; shift 2 ;;
    --reuse-minutes)
      REUSE_MINUTES="${2:-}"; shift 2 ;;
    *)
      die "Unknown argument: $1" ;;
  esac
done

[[ "${ENV_NAME}" == "prod" || "${ENV_NAME}" == "staging" ]] || die "--env must be prod or staging"
[[ "${KEEP}" =~ ^[0-9]+$ && "${KEEP}" -ge 1 ]] || die "--keep must be a positive integer"
[[ "${REUSE_MINUTES}" =~ ^[0-9]+$ ]] || die "--reuse-minutes must be a non-negative integer"
command -v docker >/dev/null 2>&1 || die "Required command not found: docker"

# В имени файла — только безопасные символы.
LABEL="$(printf '%s' "${LABEL}" | tr -c 'A-Za-z0-9._-' '_')"
[[ -n "${LABEL}" ]] || LABEL="manual"

BACKUP_DIR="${PBTH_ROOT}/shared/backups/${ENV_NAME}"
PREFIX="pbth-${ENV_NAME}-"

find_db_container() {
  if [[ -n "${PBTH_DB_CONTAINER:-}" ]]; then
    echo "${PBTH_DB_CONTAINER}"
    return
  fi
  local project="pbth-${ENV_NAME}"
  local id
  id="$(docker ps -q \
    --filter "label=com.docker.compose.project=${project}" \
    --filter "label=com.docker.compose.service=db" | head -n1)"
  if [[ -z "${id}" ]]; then
    # Запасной путь: имя контейнера, которое даёт docker compose v2.
    id="$(docker ps -q --filter "name=^${project}-db-1$" | head -n1)"
  fi
  echo "${id}"
}

mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}" 2>/dev/null || true

if [[ "${REUSE_MINUTES}" -gt 0 ]]; then
  # Свежая копия с той же меткой уже есть (её снял workflow перед вызовом
  # deploy.sh) — второй дамп за минуту не нужен.
  EXISTING="$(find "${BACKUP_DIR}" -maxdepth 1 -type f -name "${PREFIX}*-${LABEL}.dump" -mmin "-${REUSE_MINUTES}" 2>/dev/null | sort | tail -n1)"
  if [[ -n "${EXISTING}" && -s "${EXISTING}" ]]; then
    log "Fresh backup with label ${LABEL} already exists, reusing it"
    echo "${EXISTING}"
    exit 0
  fi
fi

DB_CONTAINER="$(find_db_container)"
[[ -n "${DB_CONTAINER}" ]] || die "DB container for pbth-${ENV_NAME} is not running; refusing to continue without a backup"

log "Waiting for database in container ${DB_CONTAINER}"
READY=0
for _ in $(seq 1 30); do
  if docker exec "${DB_CONTAINER}" sh -c 'pg_isready -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done
[[ "${READY}" == "1" ]] || die "Database is not ready in ${DB_CONTAINER}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FINAL="${BACKUP_DIR}/${PREFIX}${STAMP}-${LABEL}.dump"
PARTIAL="${FINAL}.partial"

cleanup_partial() {
  rm -f "${PARTIAL}"
}
trap cleanup_partial EXIT

log "Dumping ${ENV_NAME} database to ${FINAL}"
umask 077
# Переменные POSTGRES_USER/POSTGRES_DB берутся из окружения контейнера базы;
# локальное подключение внутри контейнера идёт без пароля.
docker exec "${DB_CONTAINER}" sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "${PARTIAL}" \
  || die "pg_dump failed"

[[ -s "${PARTIAL}" ]] || die "Backup file is empty"

# Проверка, что архив читается целиком: pg_restore разбирает оглавление.
TOC="$(docker exec -i "${DB_CONTAINER}" pg_restore --list < "${PARTIAL}")" \
  || die "Backup is not readable by pg_restore"
TABLES="$(printf '%s\n' "${TOC}" | grep -c ' TABLE DATA ' || true)"

mv "${PARTIAL}" "${FINAL}"
trap - EXIT

SIZE="$(wc -c < "${FINAL}" | tr -d ' ')"
log "Backup ok: ${FINAL} (${SIZE} bytes, ${TABLES} tables with data)"

# Ротация: оставляем последние KEEP дампов этого окружения.
# Имена без пробелов (дата + метка из безопасных символов), ls -t безопасен.
OLD="$(ls -1t "${BACKUP_DIR}/${PREFIX}"*.dump 2>/dev/null | tail -n "+$((KEEP + 1))" || true)"
if [[ -n "${OLD}" ]]; then
  while IFS= read -r f; do
    [[ -n "${f}" ]] || continue
    log "Rotating out ${f}"
    rm -f -- "${f}"
  done <<< "${OLD}"
fi

echo "${FINAL}"
