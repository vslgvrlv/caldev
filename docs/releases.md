# PBTH Releases

## Stable Baseline

- `prod` stable baseline: `v2026.03.06-1`
- frozen on: `2026-03-08`
- note: used as rollback-safe anchor before Auth v2 and Admin v1 rollout.

## Update Rule

For every production deployment, append one row:

`YYYY-MM-DD | releaseId | commit | deployed by | smoke result | rollback target`

## Current Rollback Anchors

- `prod`: `v2026.03.06-1`
- `staging`: `v2026.03.10-2` (commit `2f91d18c5288e83d98b8479b35d067d7d5529406`, deployed via `Deploy Staging` run `22890286408`).
