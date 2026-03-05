# Paintball Team Hub (pbth)

Frontend: `pbth/` (React + Vite)
Backend: `backend/` (Node + Express + Postgres + session auth + Telegram OAuth)

## GitHub Lite Release Model

- GitHub is source of truth (`main`, `staging`, `feature/*`).
- CI runs on pull requests to `main` and `staging`.
- Deploy is manual by artifact (no auto-deploy).
- Two isolated server environments are required:
  - `prod` (`pbthub.ru`)
  - `staging` (`staging.pbthub.ru`)
- Never edit code directly in live server directory.

## Local run (without Docker)

1. Install backend deps:
```bash
cd backend
npm ci
```

2. Install frontend deps:
```bash
cd ../pbth
npm ci
```

3. Configure env:
```bash
cd ..
cp .env.example .env
# fill TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME, VITE_TELEGRAM_BOT_USERNAME
```

4. Start Postgres locally (or via Docker only db service):
```bash
docker compose up -d db
```

5. Run migrations and seed:
```bash
cd backend
npm run db:migrate
npm run db:seed
```

6. Start backend:
```bash
npm run dev
```

7. Start frontend in another terminal:
```bash
cd ../pbth
npm run dev
```

Frontend: `http://127.0.0.1:3000`
Backend: `http://127.0.0.1:8000`

## Docker compose full stack

```bash
docker compose up --build
```

## Release endpoint

- `GET /api/v1/release/version`
- response:
```json
{
  "releaseId": "v2026.03.01-abc1234",
  "commit": "abc1234deadbeef...",
  "builtAt": "2026-03-01T10:00:00Z"
}
```

## Core endpoints (v1)

- `GET /api/v1/health`
- `GET /api/v1/release/version`
- `GET /api/v1/openapi.json`
- `GET /api/v1/auth/telegram/start`
- `GET /api/v1/auth/telegram/callback`
- `GET /api/v1/auth/me`
- `POST /api/v1/auth/context`
- `POST /api/v1/auth/logout`
- `GET /api/v1/init`
- `POST /api/v1/events`
- `POST /api/v1/rsvp`
- `POST /api/v1/transactions`
- `GET /api/v1/profile/ics`
- `POST /api/v1/profile/ics/rotate`
- `GET /api/v1/profile/ics/download`
- `GET /calendar/ics/:token.ics?teamId=<id>`

Legacy `/api/*` paths are still supported temporarily and now return deprecation headers:
- `Deprecation: true`
- `Sunset: Wed, 31 Dec 2026 23:59:59 GMT`

## CI & Artifact Release

Workflows:
- `.github/workflows/ci.yml` (PR checks for `main`/`staging`)
- `.github/workflows/release-artifact.yml` (manual artifact + GitHub Release tag)
- `.github/workflows/deploy-staging.yml` (manual staging deploy by `releaseId`)
- `.github/workflows/deploy-prod.yml` (manual prod deploy by `releaseId`, optional staging match check)
- `.github/workflows/rollback-release.yml` (manual rollback for staging/prod)

GitHub deployment runbook:
- `.github/DEPLOYMENT.md`

Artifact script (local):
```bash
./scripts/release/build-artifact.sh
```

Optional custom release id:
```bash
./scripts/release/build-artifact.sh v2026.03.01-1
```

Output:
- `dist/releases/pbth-release-<releaseId>.tar.gz`
- `dist/releases/pbth-release-<releaseId>.tar.gz.sha256`

## Server Deploy Runbook (Artifact-based)

**Mandatory policy (do not violate):**
- All changes go to `staging` first.
- `prod` deploy is allowed only after staging verification.
- Never run direct `docker compose up --build` from `/root/caldev` for production updates.
- Production is updated only via artifact scripts (`deploy-prod.sh` / `rollback.sh`).
- Canonical step-by-step runbook: `RELEASE_PROTOCOL.md`.
- Default operator path is GitHub workflows, not manual SSH (`.github/DEPLOYMENT.md`).

1. Prepare server env files:
```bash
/opt/pbth/shared/env/prod.env
/opt/pbth/shared/env/staging.env
```
Templates:
- `scripts/release/env.prod.example`
- `scripts/release/env.staging.example`

2. Run gate before deploy:
```bash
./scripts/gate.sh https://pbthub.ru
```

3. Deploy staging from artifact (path or URL):
```bash
./scripts/deploy-staging.sh \
  dist/releases/pbth-release-<releaseId>.tar.gz \
  dist/releases/pbth-release-<releaseId>.tar.gz.sha256 \
  https://staging.pbthub.ru
```

4. Deploy production:
```bash
./scripts/deploy-prod.sh \
  dist/releases/pbth-release-<releaseId>.tar.gz \
  dist/releases/pbth-release-<releaseId>.tar.gz.sha256 \
  https://pbthub.ru
```

5. Rollback:
```bash
./scripts/rollback.sh prod <releaseId> https://pbthub.ru
./scripts/rollback.sh staging <releaseId> https://staging.pbthub.ru
```

## Legacy endpoints (temporary compatibility)

- `GET /api/auth/telegram/start`
- `GET /api/auth/telegram/callback`
- `GET /api/auth/me`
- `POST /api/auth/context`
- `POST /api/auth/logout`
- `GET /api/init`
- `POST /api/events`
- `POST /api/rsvp`
- `POST /api/transactions`
- `GET /api/profile/ics`
- `POST /api/profile/ics/rotate`
- `GET /api/profile/ics/download`
- `GET /calendar/ics/:token.ics?teamId=<id>`

## Post-deploy smoke check

Quick automatic check:

```bash
./scripts/smoke-check.sh https://pbthub.ru
```

What it verifies:
- `/api/v1/health` responds with `{"status":"ok"}`
- `/api/v1/release/version` responds with `releaseId`
- anonymous `/api/v1/auth/me` returns `authenticated: false`
- anonymous `/api/v1/init` returns `401`
- frontend index is reachable
- Telegram auth endpoints are reachable

Then do manual checks in Telegram:
1. Open from bot `Menu Button` and verify auto-login.
2. Create event as captain/admin.
3. Open invite link and ensure new user joins team after auth.
