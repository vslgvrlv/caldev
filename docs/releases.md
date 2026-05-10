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

## Current Rollback Anchors

- `prod`: `v2026.05.10-58a9b47` (commit `58a9b47e24e08e652b79518802e8eb83b98576c8`, deployed via `Deploy Production` run `25632905818`).
- `staging`: `v2026.05.10-58a9b47` (commit `58a9b47e24e08e652b79518802e8eb83b98576c8`, deployed via `Deploy Staging` run `25632875470`).

## Network Constraints (2026-05-10)

The prod VPS (`89.108.66.32`, hosting `pbthub.ru`) cannot reach Telegram subnets on TCP/443 in either direction (`Connection timed out`; ICMP works). Both outgoing Bot API calls and inbound webhook delivery from Telegram fail without a relay.

Working architecture:
- **Outgoing** Bot API requests: env `TELEGRAM_BOT_API_BASE_URL=https://pos.pbthub.ru/tg-relay-zp-x7k9` (Caddy proxy on `78.17.11.162` that forwards to `https://api.telegram.org`). Wire-up restored in commit `b7d1e1b`.
- **Inbound** Telegram webhook: registered to `https://pos.pbthub.ru/tg-pbth-webhook-8952690e7e1af14c` (Caddy proxy on `78.17.11.162` rewriting to `https://pbthub.ru/api/v1/vendor/telegram/webhook`).
- The Caddy block lives in `/etc/caddy/Caddyfile` on `78.17.11.162` under the `pos.pbthub.ru` site.

If the relay path or 78.17 host changes, both sides must be updated together: `setWebhook` on Telegram, and `TELEGRAM_BOT_API_BASE_URL` in `/opt/pbth/shared/env/prod.env` followed by `docker compose -p pbth-prod -f docker-compose.release.yml -f docker-compose.prod.yml --env-file /opt/pbth/shared/env/prod.env up -d --force-recreate backend`.
