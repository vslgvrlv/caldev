# PBTH Releases

## Stable Baseline

- `prod` stable baseline: `v2026.03.06-1`
- frozen on: `2026-03-08`
- note: used as rollback-safe anchor before Auth v2 and Admin v1 rollout.

## Update Rule

For every production deployment, append one row:

`YYYY-MM-DD | releaseId | commit | deployed by | smoke result | rollback target`

2026-03-25 | v2026.03.25-pwa-safe-top1 | 52ee756fda945a33a61bc4067c5ee8af1a97ce0b | Codex via Deploy Production run 23540220050 | prod health ok, prod release/version ok, staging matched before deploy | v2026.03.06-1
2026-05-10 | v2026.05.10-b7d1e1b | b7d1e1b90cb77cc867ecb6e9a0f2c958d6afb362 | Claude via Deploy Production run 25618586123 | prod health ok, fixed Telegram outgoing block by restoring `TELEGRAM_BOT_API_BASE_URL` relay support | v2026.03.25-pwa-safe-top1
2026-05-10 | v2026.05.10-58a9b47 | 58a9b47e24e08e652b79518802e8eb83b98576c8 | Claude via Deploy Production run 25632905818 | prod health ok, Tailwind bundled into Vite build (no more runtime CDN) | v2026.05.10-b7d1e1b
2026-07-07 | v2026.07.07-783b70c | 783b70c38587bad00bf9b84a92a0ac068a0090a9 | Claude via manual artifact deploy (staging verified first) | prod health ok, release/version ok, migration 027 applied, 3 shared bases seeded (#80/#81) | v2026.07.06-4d7db77
2026-07-07 | v2026.07.07-183f180 | 183f180828ce4ef0f6bf747b168ae5ea411da6e0 | Claude via manual artifact deploy (staging verified first) | prod health ok, release/version ok, full event edit modal + time-input overlap fix (#83/#84) | v2026.07.07-783b70c
2026-07-07 | v2026.07.07-8bace02 | 8bace0231a97f1b20d2542a210b30fef6b45f588 | Claude via manual artifact deploy (staging verified first) | prod health ok, reminder time now rendered in team timezone — 16:00 UTC shows as 19:00 МСК (#86/#87) | v2026.07.07-183f180

## Current Rollback Anchors

- `prod`: `v2026.07.07-183f180` (previous stable before reminder-timezone release `v2026.07.07-8bace02`).
- `staging`: `v2026.07.07-8bace02` (commit `8bace0231a97f1b20d2542a210b30fef6b45f588`, manual artifact deploy).

## Network Constraints (2026-05-10)

The prod VPS (`89.108.66.32`, hosting `pbthub.ru`) cannot reach Telegram subnets on TCP/443 in either direction (`Connection timed out`; ICMP works). Both outgoing Bot API calls and inbound webhook delivery from Telegram fail without a relay.

Working architecture:
- **Outgoing** Bot API requests: env `TELEGRAM_BOT_API_BASE_URL=https://pos.pbthub.ru/tg-relay-zp-x7k9` (Caddy proxy on `78.17.11.162` that forwards to `https://api.telegram.org`). Wire-up restored in commit `b7d1e1b`.
- **Inbound** Telegram webhook: registered to `https://pos.pbthub.ru/tg-pbth-webhook-8952690e7e1af14c` (Caddy proxy on `78.17.11.162` rewriting to `https://pbthub.ru/api/v1/vendor/telegram/webhook`).
- The Caddy block lives in `/etc/caddy/Caddyfile` on `78.17.11.162` under the `pos.pbthub.ru` site.

If the relay path or 78.17 host changes, both sides must be updated together: `setWebhook` on Telegram, and `TELEGRAM_BOT_API_BASE_URL` in `/opt/pbth/shared/env/prod.env` followed by `docker compose -p pbth-prod -f docker-compose.release.yml -f docker-compose.prod.yml --env-file /opt/pbth/shared/env/prod.env up -d --force-recreate backend`.

## Database backups (since 2026-11-11)

Every deploy takes a `pg_dump` before migrations into
`/opt/pbth/shared/backups/<env>/` (last 20 kept) and stops if the dump fails.
Restore and details: `RELEASE_PROTOCOL.md`, section «Бэкап базы перед миграциями».

## Web Push (VAPID)

Push reminders are off unless `PUSH_NOTIFICATIONS_ENABLED=1` is set in
`/opt/pbth/shared/env/<env>.env`. The release compose file already passes
`PUSH_NOTIFICATIONS_ENABLED`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
`VAPID_SUBJECT` to the backend (`backend/src/config/env.ts`).

1. Generate one key pair per environment (staging and prod separately) and keep it:
   a new pair invalidates every existing browser subscription.
   ```bash
   docker compose -p pbth-staging -f docker-compose.release.yml -f docker-compose.staging.yml \
     --env-file /opt/pbth/shared/env/staging.env run --rm --no-deps backend npx web-push generate-vapid-keys
   ```
2. Put both keys and `PUSH_NOTIFICATIONS_ENABLED=1` into the env file.
   With the flag on and a key missing the backend refuses to start.
3. Recreate the backend (`... up -d --force-recreate backend`) and check
   `GET /api/v1/push/vapid-key` returns the public key.

With push off, `/api/v1/push/vapid-key` answers `204` (no key) and
reminders go through the Telegram bot.
