#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-}"

if [[ -z "${TELEGRAM_BOT_TOKEN:-}" ]]; then
  echo "TELEGRAM_BOT_TOKEN is required" >&2
  exit 1
fi

api() {
  curl -fsS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/$1" "${@:2}"
  echo
}

case "$ACTION" in
  set)
    if [[ -z "${TELEGRAM_WEBHOOK_URL:-}" ]]; then
      echo "TELEGRAM_WEBHOOK_URL is required for 'set'" >&2
      exit 1
    fi
    if [[ -z "${TELEGRAM_WEBHOOK_SECRET:-}" ]]; then
      echo "TELEGRAM_WEBHOOK_SECRET is required for 'set'" >&2
      exit 1
    fi
    api "setWebhook" \
      --data-urlencode "url=${TELEGRAM_WEBHOOK_URL}" \
      --data-urlencode "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
      --data-urlencode "allowed_updates=[\"message\"]" \
      --data-urlencode "drop_pending_updates=false"
    ;;
  delete)
    api "deleteWebhook" \
      --data-urlencode "drop_pending_updates=false"
    ;;
  info)
    api "getWebhookInfo"
    ;;
  *)
    cat >&2 <<'EOF'
Usage:
  TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_URL=... TELEGRAM_WEBHOOK_SECRET=... ./scripts/release/telegram-webhook.sh set
  TELEGRAM_BOT_TOKEN=... ./scripts/release/telegram-webhook.sh info
  TELEGRAM_BOT_TOKEN=... ./scripts/release/telegram-webhook.sh delete
EOF
    exit 1
    ;;
esac
