# GitHub Deployment Runbook (PBTH)

This is the default deployment path for PBTH.
Use manual server commands only as fallback.

## 1) Required GitHub Secrets

Set these in `Settings -> Secrets and variables -> Actions`:

- `DEPLOY_HOST` (example: `89.108.66.32`)
- `DEPLOY_USER` (usually `root`)
- `DEPLOY_PORT` (optional, default `22`)
- `DEPLOY_PATH` (optional, default `/root/caldev`)
- `DEPLOY_SSH_KEY` (private SSH key content)

## 2) Recommended GitHub Environments

Create environments:

- `staging`
- `production`

For `production`, enable required reviewers before workflow execution.

## 3) Release Flow (No Manual SSH Needed)

1. Merge tested changes into `main`.
2. Run workflow `Release Artifact` from `main` and set `release_id` (example: `v2026.03.05-1`).
3. Run workflow `Deploy Staging` with the same `release_id`.
4. Verify staging (Telegram + core flows).
5. Run workflow `Deploy Production` with the same `release_id`.

## 4) Fast Rollback from GitHub

Run workflow `Rollback Release`:

- `environment`: `staging` or `prod`
- `release_id`: previously known good release

The workflow runs rollback script and validates `/api/v1/release/version`.

## 5) Safety Rules

1. Deploy only by release tags and immutable artifacts.
2. Never deploy prod from dirty local folder.
3. Never skip staging verification.
4. Never apply manual DB schema changes outside migrations.

## 6) Auth v2 Rollout Guardrails

Use dual-run rollout via env flags in `prod.env` / `staging.env`:

- `AUTH_OIDC_ENABLED`
- `AUTH_OIDC_FALLBACK_ENABLED`
- `AUTH_OIDC_ADMIN_REQUIRED`

Recommended order:

1. enable in staging (`AUTH_OIDC_ENABLED=1`, `AUTH_OIDC_FALLBACK_ENABLED=1`);
2. verify Android/iOS Mini App + web admin login;
3. canary in prod with allowlist users;
4. full enable only after stable success rate.
