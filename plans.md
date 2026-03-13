# PBTH Execution Plan (Atomic)

Date: 2026-03-10
Owner: Codex + Vasiliy
Rule: every task is atomic and deployable.

## Phase A — Process Baseline (Current Sprint)
- [x] A1. Create operational files `plans.md` and `status.md` and keep them updated on every step.
- [x] A2. Remove duplicate repo artifacts/files with suffix ` 2` and keep only canonical files.
- [x] A3. Align deployment/runbook docs and env examples with Auth v2 fields.

## Phase B — Auth v2 Backend (Current Sprint)
- [x] B1. Add DB migrations for OIDC state and replay guard (`017`, `018`).
- [x] B2. Add OIDC helper library (`telegram-oidc`) with code exchange + id_token validation (JWKS).
- [x] B3. Add replay guard library and cleanup of expired auth artifacts.
- [x] B4. Implement `GET /api/v1/auth/telegram/oidc/start`.
- [x] B5. Implement `GET /api/v1/auth/telegram/oidc/callback`.
- [x] B6. Keep legacy `/api/v1/auth/telegram/direct` but route to OIDC when enabled.
- [x] B7. Extend `GET /api/v1/auth/me` with `authMethod`, `capabilities`, `adminScope`, `managedTeamIds`.
- [x] B8. Update OpenAPI for new auth endpoints/contracts.

## Phase C — Auth UX Stabilization (Current Sprint)
- [x] C1. Fix Mini App return from admin flow without false generic popup.
- [x] C2. Ensure auto-switch ADMIN -> USER in team entry flow when needed.
- [x] C3. Verify logout guard prevents sticky auto-login loop.

## Phase D — Validation + Delivery (Current Sprint)
- [x] D1. Run backend checks: `check`, `test:unit`, `test:integration`.
- [x] D2. Run frontend checks: `typecheck`, `test:unit`, `build`.
- [x] D3. Open PR with current sprint changes.
- [x] D4. Merge PR after green CI.
- [x] D5. Build release artifact from `main`.
- [x] D6. Deploy to staging and verify `/health` + `/release/version`.

## Next Queue (After Current Sprint)
- [x] N1. Phase 2 Auth v2 Frontend hardening (error states + Android/iOS telemetry breakdown).
- [x] N2. Phase 3 canary controls and auth SLO/error-budget alerts.
- [x] N3. Phase 4 Admin Console v1 functional completion (Event/Team/Audit UX).
  - [x] N3-A1. Add domain schema for external event owners + organizer/team registrations + team schedule ingestion.
  - [x] N3-A2. Extend backend admin/events/init APIs to expose source-owner-registration-schedule model.
  - [x] N3-A3. Add backend tests for new event domain projections and role/scope access.
  - [x] N3-B1. Upgrade Admin Event UX to show source/owner, registration status, and imported schedule context.
  - [x] N3-B2. Upgrade Admin Team UX to show team identity and registration linkage.
  - [x] N3-B3. Upgrade Admin Audit UX to trace registration confirmation -> schedule publish flow.
  - [x] N3-B4. Run full verification (`backend check/unit/integration`, `frontend typecheck/unit/build`) and finalize docs/status.
  - [x] N3-H1. Hotfix staging deploy for migration `019` (remove non-existent enum casts/types; keep TEXT+CHECK contract).
  - [x] N3-H2. Hotfix deploy workflows to checkout repo before `auth-slo-check.sh` (staging+prod).
  - [x] N3-H3. Admin UX: показывать человекочитаемые названия команд (не UUID) в selector/filters.
  - [x] N3-H4. Admin/Web login: корректный fallback в OIDC при открытии `/admin` вне Telegram Mini App (без ложной ошибки `initData`).
  - [x] N3-H5. Stabilize deploy auth SLO check: run it server-side (SSH) to avoid runner DNS false-failures.
- [x] N4. Phase 5 Admin metrics pack.
