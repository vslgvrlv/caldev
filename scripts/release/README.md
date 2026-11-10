# PBTH Release Scripts

## Build artifact

```bash
./scripts/release/build-artifact.sh
./scripts/release/build-artifact.sh v2026.03.01-1
```

Outputs:
- `dist/releases/pbth-release-<releaseId>.tar.gz`
- `dist/releases/pbth-release-<releaseId>.tar.gz.sha256`

## Deploy

```bash
./scripts/release/deploy.sh --env staging --artifact <path-or-url> --checksum <path-or-url> --base-url https://staging.pbthub.ru
./scripts/release/deploy.sh --env prod --artifact <path-or-url> --checksum <path-or-url> --base-url https://pbthub.ru
```

`deploy.sh` takes a database dump (`db-backup.sh`) after starting `db` and
before build and migrations; if the dump fails, the deploy stops.

## Database backup and restore

```bash
./scripts/release/db-backup.sh --env prod --label manual        # prints the dump path
./scripts/release/db-restore.sh --env prod --file <dump> --confirm prod
```

Dumps: `/opt/pbth/shared/backups/<env>/`, last 20 kept. Details and the
restore checklist: `RELEASE_PROTOCOL.md`.

## Rollback

```bash
./scripts/release/rollback.sh --env staging --to <releaseId> --base-url https://staging.pbthub.ru
./scripts/release/rollback.sh --env prod --to <releaseId> --base-url https://pbthub.ru
```

## Smoke

```bash
./scripts/release/smoke.sh --base-url https://pbthub.ru
```

## Auth SLO / Error Budget

```bash
./scripts/release/auth-slo-check.sh --base-url https://pbthub.ru --window-minutes 60
```

Optional token auth:

```bash
AUTH_SLO_TOKEN=<token> ./scripts/release/auth-slo-check.sh --base-url https://pbthub.ru
```

## Telegram Bot Webhook

Configure webhook for bot handoff login:

```bash
TELEGRAM_BOT_TOKEN=<token> \
TELEGRAM_WEBHOOK_URL=https://staging.pbthub.ru/api/v1/vendor/telegram/webhook \
TELEGRAM_WEBHOOK_SECRET=<secret> \
./scripts/release/telegram-webhook.sh set
```

Inspect current webhook:

```bash
TELEGRAM_BOT_TOKEN=<token> ./scripts/release/telegram-webhook.sh info
```

Delete webhook:

```bash
TELEGRAM_BOT_TOKEN=<token> ./scripts/release/telegram-webhook.sh delete
```
