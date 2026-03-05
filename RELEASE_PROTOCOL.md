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
