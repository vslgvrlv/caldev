# Council Session: 2026-05-10 — OAuth Identity Model для PBTH

## Council Members
- **Backend Architect** — schema design, abstraction tradeoffs, refactor cost.
- **Security Engineer** — identity hijacking, race conditions, audit-trail.
- **Database Engineer** — migration safety, indexes, query patterns.

## Context (брифинг для всех экспертов)
- PBTH: React + Express + PostgreSQL 16. ~20 prod-юзеров, все через Telegram bot handoff.
- Текущая схема: `users.telegram_id UNIQUE`, `completeTelegramLogin` helper, audit `auth.telegram.login`.
- Цель: Yandex OAuth (сейчас), VK OAuth (через ~2 недели).
- Решения brainstorming'a: manual linking через Profile (без auto-merge по email), email хранить, phone нет, ADMIN только Telegram.

## Approach 1 — user_identities table
`user_identities(user_id FK, provider, provider_user_id, email, linked_at)` + UNIQUE(provider, provider_user_id), UNIQUE(user_id, provider).

## Approach 2 — sibling columns
`users.yandex_id`, `users.yandex_email`, `users.vk_id` etc.

## Approach 3 — hybrid
`users.telegram_id` keep, sibling for new providers.

---

## Backend Architect
**Verdict: Approach 1.**

Approach 2/3 отвергнуты: каждый новый провайдер = миграция `users` + ветка в `completeTelegramLogin` + N мест в auth-router. К 4-му провайдеру `users` пухнет до 12 auth-полей. Hybrid — неконсистентная ментальная модель: "telegram особенный, остальные нет" → техдолг по дизайну.

Approach 1 даёт:
- O(1) сложность добавления провайдера (новая строка с `provider`, без schema-миграции).
- Constraint-driven enforcement правил ("один провайдер на юзера", "один OAuth-аккаунт на один PBTH").
- Manual-link UX становится одной функцией-диспатчер `completeOAuthLogin(provider, profile, req, res)`.

**Тонкость:** ADMIN-allowlist (в `env.ts`) сейчас матчит по `telegram_id`. После рефактора нужно явно ограничить — ADMIN claim берётся ТОЛЬКО из identity с `provider='telegram'`. Не "юзер существует с таким Yandex".

**Миграция:** двухфазная. Сначала CREATE TABLE + backfill. `users.telegram_id` НЕ дропать в той же миграции — оставить ещё на 1-2 релиза как denormalized cache. Дроп — отдельной миграцией когда все хот-пути переедут. Это спасает rollback.

**Email:** `users.email` (nullable, не UNIQUE — будущая дедупликация не должна ломаться). `user_identities.email` — snapshot-поле (read-only audit-trail того что вернул провайдер при link). Расхождение допустимо.

## Security Engineer
**Verdict: Approach 1.**

**Обязательные митигации:**
1. **Pattern B для link/login**: `/auth/yandex/start` (login) и `/auth/yandex/link/start` (link, requires session) — две отдельные пары endpoints. `requireSession` middleware на link-стороне. Никаких `?intent=login|link` в одном endpoint.
2. **NO auto-provision** из anonymous login-callback без существующего link. Иначе атакующий регает shadow-аккаунт и блокирует legitimate юзера от link'a. (Для PBTH уже invite-only — закрытая регистрация естественна.)
3. **CSRF state**: HMAC-signed nonce, single-use, TTL ≤10мин, привязан к session-cookie.
4. **Race condition resolution**: `UNIQUE(provider, provider_user_id)` + `INSERT ... ON CONFLICT DO NOTHING RETURNING`. Транзакция `SERIALIZABLE` или advisory lock на `(provider, provider_user_id)`.
5. **Pre-confirmation page** перед commit'ом link: "Вы привязываете Yandex `e***@yandex.ru` к аккаунту PBTH `Vasily`. Подтвердить?"
6. **Append-only `identity_audit`** log с IP/UA/actor (или payload-поле `provider` в существующем `audit_logs`).
7. **Unlink запрещён** для последнего identity и для deactivated users.
8. **Cooldown 24-72ч** между unlink и new link того же провайдера (предотвращает abuse).
9. **Rate-limit**: 5 link attempts/час/юзер.
10. Key on `provider_user_id` (permanent sub из Yandex), email — никогда.

**Email**: для PBTH-scale (РФ, ~20 юзеров, всё equals на GDPR) plain text допустим. Hash + last 4 chars — overcaution для нашего масштаба, но если будет рост → пересмотреть.

## Database Engineer
**Verdict: Approach 1.**

**Migration shape (3 шага):**
1. `BEGIN; LOCK users IN SHARE MODE; CREATE TABLE user_identities (...); CREATE INDEX...;` — на 20 строках мгновенно, конкурентный INSERT в `users` не страшен на пару секунд.
2. `INSERT INTO user_identities (user_id, provider, provider_user_id) SELECT id, 'telegram', telegram_id::TEXT FROM users WHERE telegram_id IS NOT NULL; COMMIT;`
3. Отдельным релизом через 1-2 спринта — `ALTER TABLE users DROP COLUMN telegram_id` после того как все хот-пути перешли на чтение из `user_identities`.

**Индексы:**
- `UNIQUE (provider, provider_user_id)` — composite, leftmost prefix покрывает login lookup. Дополнительный idx_user_identities_user избыточен — `UNIQUE (user_id, provider)` уже работает как индекс на `user_id`.

**Hot path /auth/me**: JOIN на 20 строк + indexed lookup = субмиллисекунда. Не материализовать. При росте до 10k+ — кэш identity-list в session.

**FK**: `ON DELETE CASCADE` для hard delete. Soft delete (`status='inactive'`) identities НЕ трогает — разные слои. Блокировка login для inactive — в auth-сервисе (`WHERE users.status='active'`), не в FK.

**Email**: TEXT, не индексировать (lookup идёт по `provider_user_id`). При future нужде — `CITEXT` extension прозрачнее `LOWER(email)` индекса.

---

## Consensus
1. **Approach 1** — единогласно. Approach 2/3 отвергнуты.
2. **UNIQUE constraints**: `(provider, provider_user_id)` и `(user_id, provider)` оба обязательны.
3. **2-фазная миграция**: keep `users.telegram_id` initially as cache, drop отдельным релизом.
4. **Key on `provider_user_id`** (permanent sub), не email.
5. **ON DELETE CASCADE** на `user_identities.user_id`.

## Disagreements
| Тема | Backend Architect | Security Engineer | DB Engineer | Resolution |
|------|-------------------|-------------------|-------------|------------|
| Auto-provision из login-callback | не упоминает | **Жёстко НЕТ** | не упоминает | **Принимаем Security**: PBTH invite-only, login без существующего link → редирект на "запросите invite", не auto-create. |
| Email storage | plain в `users` + snapshot в `user_identities` | hash + last 4 для GDPR | plain TEXT | **Принимаем Backend Architect**: PBTH scale не требует hash. |
| Pre-confirmation page при link | не упоминает | настаивает | не упоминает | **Принимаем Security** — добавит ясности и страхует от mis-click. |
| Identity audit table | не упоминает | append-only `identity_audit` | не упоминает | **Компромисс**: расширяем существующий `audit_logs` записями `identity.link/unlink` с payload (provider, actor, ip_hash), без отдельной таблицы. |
| Cooldown unlink/re-link | не упоминает | 24-72ч | не упоминает | **Скип на первой итерации** — abuse vector тeoreticheski reachable, но real-world impact на 20 юзеров минимален. Заметка в backlog. |

## Decisions
1. ✅ Approach 1 (user_identities table).
2. ✅ Pattern B endpoints: `/auth/yandex/start`, `/auth/yandex/callback` для login; `/auth/yandex/link/start`, `/auth/yandex/link/callback` для linking.
3. ✅ NO auto-provision: anonymous Yandex-callback без existing link → 302 → `/login?auth_error=NO_ACCOUNT` (с invite-link UX). Telegram остаётся primary onboarding.
4. ✅ Pre-confirmation page `/auth/handoff/link/confirm` перед `user_identities` INSERT.
5. ✅ `audit_logs` записи `identity.link`, `identity.unlink` (расширяем существующее, без новой таблицы).
6. ✅ 2-фазная миграция: 021 = CREATE + backfill; 022 (отдельный релиз) = DROP telegram_id.
7. ✅ ADMIN role **только** из identity с `provider='telegram'` (явная проверка).
8. ⏸ Cooldown unlink/re-link — добавим в backlog как security-hardening, не блокер для MVP.
