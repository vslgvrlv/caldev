# PBTH Releases

## Stable Baseline

- `prod` stable baseline: `v2026.03.06-1`
- frozen on: `2026-03-08`
- note: used as rollback-safe anchor before Auth v2 and Admin v1 rollout.

## Update Rule

For every production deployment, append one row:

`YYYY-MM-DD | releaseId | commit | deployed by | smoke result | rollback target`

2026-03-25 | v2026.03.25-pwa-safe-top1 | 52ee756fda945a33a61bc4067c5ee8af1a97ce0b | Codex via Deploy Production run 23540220050 | prod health ok, prod release/version ok, staging matched before deploy | v2026.03.06-1

## Current Rollback Anchors

- `prod`: `v2026.03.25-pwa-safe-top1` (commit `52ee756fda945a33a61bc4067c5ee8af1a97ce0b`, deployed via `Deploy Production` run `23540220050`).
- `staging`: `v2026.03.25-pwa-safe-top1` (commit `52ee756fda945a33a61bc4067c5ee8af1a97ce0b`, deployed via `Deploy Staging` run `23540118498`).
