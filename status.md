# PBTH Execution Status

Date: 2026-03-12
Branch: `codex/fix-deploy-workflow-checkout`

## Current Task
`N3 HOTFIX IN REVIEW` — устраняем deploy workflow blocker после фикса миграции `019`.

## Progress Log
- [x] PR `#15` (migration `019` hotfix) смёржен в `main`:
  - merge commit: `e6c2879b18313703c3af4fc2b00c68f3be750efd`.
- [x] Новый релиз `v2026.03.12-n3-hotfix1` собран успешно (workflow run `23009178605`).
- [x] Повторный `Deploy Staging` (run `23009199734`) упал с `exit 127` на шаге `Check auth SLO/error budget`:
  - root cause: в `deploy-staging.yml`/`deploy-prod.yml` вызывался `./scripts/release/auth-slo-check.sh` без `actions/checkout`, поэтому скрипт недоступен на runner.
- [x] Подготовлен второй hotfix для deploy workflows:
  - добавлен шаг `Checkout repository` (`actions/checkout@v4`) в `.github/workflows/deploy-staging.yml`;
  - добавлен шаг `Checkout repository` (`actions/checkout@v4`) в `.github/workflows/deploy-prod.yml`.
- [x] Подтверждён root cause падения `Deploy Staging` (run `23008781548`):
  - ошибка в миграции `019`: `type "event_game_pit_zone" does not exist`;
  - staging падал на шаге `node dist/db/migrate.js` при применении `019_event_domain_external_owners.sql`.
- [x] Подготовлен hotfix для совместимости с текущей БД моделью (`TEXT + CHECK`, без enum-типа):
  - `backend/src/db/migrations/019_event_domain_external_owners.sql`:
    - `pit_zone`/`game_pair` в `event_team_schedule_items` переведены на `TEXT`;
    - добавлены CHECK constraints на `('NEAR','FAR')` и `('FIRST','SECOND')`;
  - `backend/src/modules/admin/routes.ts`:
    - удалены касты `::event_game_pit_zone` и `::event_game_pair` в insert-path для schedule данных.
- [x] Верификация hotfix локально:
  - `backend`: `npm run check` (green),
  - `backend`: `npm run test:unit` (green),
  - `backend`: `npm run test:integration` (blocked в sandbox: `listen EPERM 0.0.0.0`, не связано с логикой hotfix).
- [x] Открыт PR hotfix в `main`:
  - PR `#15`: https://github.com/vslgvrlv/caldev/pull/15
  - ветка: `codex/fix-019-staging-deploy`
  - commit: `434b13f`
- [x] Created `plans.md` with atomic current-sprint tasks.
- [x] Created `status.md` as live execution tracker.
- [x] Подтвердил, что в коде уже реализованы OIDC start/callback, replay guard и расширение `/auth/me`.
- [x] Прогнал локальные проверки (`backend check/unit/integration`, `frontend typecheck/unit/build`) — зелёные.
- [x] Закоммитил пакет Phase 0+1 (`903b10c`) и запушил в branch.
- [x] Открыл PR: `#12` — https://github.com/vslgvrlv/caldev/pull/12
- [x] PR `#12` прошёл CI и смёржен в `main` (merge commit: `5d062aea9bd740f4c668443944cd9cfe18758741`).
- [x] Выпущен релиз `v2026.03.10-3` и задеплоен в staging (Deploy run: `22890852308`).
- [x] Проверка staging:
  - `GET /api/v1/health` -> `{\"status\":\"ok\"}`
  - `GET /api/v1/release/version` -> `v2026.03.10-3`
- [x] Реализован frontend auth hardening:
  - добавлен единый `auth-ux` helper (нормализация auth-кодов, platform detection, mapping ошибок);
  - `LoginView`, `AdminLoginView`, `InviteView` теперь читают `auth_error`/`code`/`detail` и показывают целевые сообщения;
  - добавлен client auth telemetry emitter с platform breakdown (`android`/`ios`/`desktop`/`unknown`).
- [x] Реализован backend приём telemetry:
  - `POST /api/v1/auth/telemetry/client` с валидацией payload;
  - auth логи дополнены платформой запроса для OIDC/WebApp/callback.
- [x] Усилен OIDC callback error flow:
  - вместо сырого JSON при auth-сбоях выполняется redirect на login-экраны (`/login`, `/admin/login`, `/invite/:id`) с `auth_error`.
- [x] Верификация N1:
  - `pbth`: `npm run test:unit -- auth-ux.test.ts` (green),
  - `pbth`: `npm run typecheck` (green),
  - `backend`: `npm run check` и `npm run test:unit` (green).
- [x] Реализованы canary-контроли Auth v2:
  - добавлен deterministic OIDC canary decision (`AUTH_OIDC_CANARY_PERCENT` + sticky cookie);
  - `GET /api/v1/auth/telegram/direct` теперь выбирает OIDC/legacy по canary-правилам и логирует причину решения;
  - admin redirect path (`/admin`) форсирует OIDC независимо от процента canary.
- [x] Реализован auth SLO/error-budget контур:
  - добавлен in-memory auth metrics collector (attempt/success/error, method/platform/code);
  - добавлен endpoint `GET /api/v1/auth/slo` (window + status: `ok|breached|insufficient_data`);
  - добавлен `scripts/release/auth-slo-check.sh` для автоматического budget check.
- [x] Добавлены release/ops интеграции:
  - `deploy-staging.yml` и `deploy-prod.yml` выполняют auth SLO check после деплоя;
  - добавлен schedule workflow `.github/workflows/auth-slo-alert.yml` (hourly watch для prod+staging);
  - обновлены env examples и runbook-доки по новым canary/SLO переменным.
- [x] Верификация N2:
  - `backend`: `npm run check` (green),
  - `backend`: `npm run test:unit` (green),
  - `backend`: `npm run test:integration` (green),
  - `pbth`: `npm run typecheck` (green),
  - `bash -n scripts/release/auth-slo-check.sh scripts/release/smoke.sh` (green).
- [x] N3-A1: добавлена доменная event-схема для будущих внешних организаторов:
  - миграция `019_event_domain_external_owners.sql`:
    - новые event-поля `owner_kind/owner_team_id/owner_name`, `source_kind/source_provider/source_external_event_id`;
    - новая таблица `event_team_registrations` (заявки команд на событие);
    - новая таблица `event_team_schedule_items` (импортируемое командное расписание);
    - backfill существующих событий (registration + schedule linkage).
- [x] N3-A2: расширены backend API/проекции:
  - `admin/v1/events` теперь отдаёт owner/source, registration, registration summary, imported schedule;
  - `admin/v1/events` create/patch теперь поддерживают registration lifecycle и import schedule payload;
  - `admin/v1/team/members` теперь отдаёт `team` identity + `registrationLinks`;
  - `admin/v1/audit` теперь отдаёт `flow`-контекст (`registration_*`, `schedule_published`);
  - `init` теперь пробрасывает owner/source/registration/importedSchedule в event feed и использует imported schedule приоритетно.
- [x] N3-A3: добавлены backend unit tests:
  - `backend/src/__tests__/unit/event-domain.test.ts` (registration/schedule projections + flow stage),
  - `backend/src/__tests__/unit/admin-access.test.ts` (scope/team access helpers),
  - новый helper `backend/src/lib/admin-access.ts`.
- [x] N3-B1/N3-B2/N3-B3: обновлён Admin Console UX:
  - Event Ops: owner/source поля, registration status, publish team schedule action;
  - Team Members: team identity card + registration linkage list;
  - Audit: отдельный flow-блок по цепочке confirmation -> schedule publication.
- [x] N3-B4: полная верификация:
  - `backend`: `npm run check` (green),
  - `backend`: `npm run test:unit` (green),
  - `backend`: `npm run test:integration` (green),
  - `pbth`: `npm run typecheck` (green),
  - `pbth`: `npm run test:unit` (green),
  - `pbth`: `npm run build` (green).

## Blockers
- None.
