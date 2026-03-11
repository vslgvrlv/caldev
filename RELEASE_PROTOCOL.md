# PBTH Release Protocol (Staging-First, Mandatory)

This is the canonical deployment instruction for this project.

## Non-negotiable rules

1. `prod` is frozen until staging is verified.
2. Every release goes: local test -> artifact -> staging -> verification -> prod.
3. Never deploy production by running `docker compose up --build` in `/root/caldev`.
4. Production deploy and rollback are allowed only through release scripts.
5. `prod` and `staging` must stay isolated (different env, ports, DB).

## Primary release path: GitHub workflows

Use GitHub UI as the default operator path:

1. Run `Release Artifact` (from `main`) with `release_id`.
2. Run `Deploy Staging` with the same `release_id`.
3. Verify staging.
4. Run `Deploy Production` with the same `release_id`.
5. For rollback run `Rollback Release`.

Required secrets and click-by-click flow are documented in `.github/DEPLOYMENT.md`.

## Required server env files

- `/opt/pbth/shared/env/staging.env`
- `/opt/pbth/shared/env/prod.env`

Auth v2 env block is mandatory for both files:

- `AUTH_OIDC_ENABLED`
- `AUTH_OIDC_FALLBACK_ENABLED`
- `AUTH_OIDC_ADMIN_REQUIRED`
- `AUTH_OIDC_CANARY_PERCENT`
- `AUTH_OIDC_CANARY_COOKIE`
- `AUTH_OIDC_CANARY_COOKIE_MAX_AGE_SEC`
- `TELEGRAM_OIDC_CLIENT_ID`
- `TELEGRAM_OIDC_CLIENT_SECRET`
- `TELEGRAM_OIDC_REDIRECT_URI`
- `TELEGRAM_OIDC_ISSUER`
- `TELEGRAM_OIDC_JWKS_URL`
- `AUTH_SLO_ENABLED`
- `AUTH_SLO_WINDOW_MINUTES`
- `AUTH_SLO_MIN_ATTEMPTS`
- `AUTH_SLO_MAX_ERROR_RATE`
- `AUTH_SLO_TOKEN` (optional)

## How to release (copy-paste flow)

### 1) On Mac: build artifact

```bash
cd /Users/pk/Documents/CalDEV
./scripts/release/build-artifact.sh v2026.03.05-stg1
```

### 2) On Mac: upload artifact to server

```bash
scp dist/releases/pbth-release-v2026.03.05-stg1.tar.gz root@89.108.66.32:/root/caldev/dist/releases/
scp dist/releases/pbth-release-v2026.03.05-stg1.tar.gz.sha256 root@89.108.66.32:/root/caldev/dist/releases/
```

### 3) On server: deploy to staging

```bash
ssh root@89.108.66.32
cd /root/caldev
./scripts/deploy-staging.sh /root/caldev/dist/releases/pbth-release-v2026.03.05-stg1.tar.gz /root/caldev/dist/releases/pbth-release-v2026.03.05-stg1.tar.gz.sha256 https://staging.pbthub.ru
```

### 4) Verify staging

```bash
curl -fsS https://staging.pbthub.ru/api/v1/health
curl -fsS https://staging.pbthub.ru/api/v1/release/version
```

Also verify key product flows in Telegram Mini App on staging.
And run auth error-budget check:

```bash
./scripts/release/auth-slo-check.sh --base-url https://staging.pbthub.ru --window-minutes 60
```

### 5) Promote same artifact to prod

```bash
./scripts/deploy-prod.sh /root/caldev/dist/releases/pbth-release-v2026.03.05-stg1.tar.gz /root/caldev/dist/releases/pbth-release-v2026.03.05-stg1.tar.gz.sha256 https://pbthub.ru
```

## Rollback (if needed)

```bash
./scripts/rollback.sh prod <releaseId> https://pbthub.ru
./scripts/rollback.sh staging <releaseId> https://staging.pbthub.ru
```

## Operator note

Only `releaseId` changes between runs (`vYYYY.MM.DD-...`).  
All other commands remain identical.

After each successful prod deploy, update `docs/releases.md` with new stable and rollback anchor.
