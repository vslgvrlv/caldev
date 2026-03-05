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

## Rollback

```bash
./scripts/release/rollback.sh --env staging --to <releaseId> --base-url https://staging.pbthub.ru
./scripts/release/rollback.sh --env prod --to <releaseId> --base-url https://pbthub.ru
```

## Smoke

```bash
./scripts/release/smoke.sh --base-url https://pbthub.ru
```
