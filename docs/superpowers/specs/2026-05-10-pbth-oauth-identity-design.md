# PBTH OAuth Identity Model — Design Spec

**Date:** 2026-05-10
**Branch:** `feat/yandex-oauth`
**Council session:** [`council-2026-05-10-oauth-identity.md`](../council-2026-05-10-oauth-identity.md)

## Goal

Заменить single-provider Telegram auth на provider-agnostic identity model. Реализовать Yandex OAuth первой итерацией. VK OAuth ляжет вторым PR'ом поверх той же абстракции.

## Architecture

### Database

**New migration `021_user_identities.sql`:**
```sql
CREATE TABLE user_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,                    -- 'telegram' | 'yandex' (later: 'vk', 'google')
  provider_user_id TEXT NOT NULL,            -- permanent sub from provider
  email TEXT,                                -- snapshot at link time, nullable
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_user_id),
  UNIQUE (user_id, provider)
);
```

**Backfill (same migration, single transaction):**
```sql
LOCK TABLE users IN SHARE MODE;
INSERT INTO user_identities (user_id, provider, provider_user_id)
SELECT id, 'telegram', telegram_id::TEXT FROM users WHERE telegram_id IS NOT NULL;
```

**ALSO new migration `022_users_email.sql`:**
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
```
Nullable, NOT unique (auto-merge by email отвергнут).

**Keep `users.telegram_id` initially** as denormalized cache. Drop отдельной миграцией через 1-2 sprint после полной миграции read-paths на `user_identities`.

### Backend

**Helper rename:**
- `backend/src/lib/telegram-login.ts` → `backend/src/lib/oauth-login.ts`.
- Function `completeTelegramLogin` → `completeOAuthLogin(req, res, params)` where:
  ```ts
  type CompleteOAuthLoginParams = {
    provider: 'telegram' | 'yandex';
    providerUserId: string;
    profile: { email?: string; name?: string; firstName?: string; lastName?: string; username?: string; avatarUrl?: string; };
    authMethod: 'WEBAPP' | 'OIDC' | 'LEGACY_WIDGET' | 'DEV' | 'BOT_HANDOFF' | 'YANDEX_OAUTH';
    intent: 'login' | 'link';
    linkUserId?: string; // required when intent='link'
  };
  ```
- Logic:
  1. `intent='link'` + `linkUserId`: INSERT into user_identities (`UNIQUE` enforces invariants); audit `identity.link`; do not regenerate session, do not change account_role; return.
  2. `intent='login'`: SELECT user_identities by (provider, providerUserId).
     - Found → regenerate session, set `req.session.userId`; audit `auth.<provider>.login`.
     - Not found + no session → **404 `NO_ACCOUNT`** (anonymous → не auto-create, PBTH invite-only).
     - Not found + session exists → ambiguous, return 409. Caller should use the link endpoint instead.
  3. Telegram-specific: keep existing role_role allowlist check based on `provider='telegram'` identity (NOT yandex/vk). Update lookup to query `user_identities WHERE user_id=X AND provider='telegram'`.

**New Yandex OAuth module `backend/src/lib/yandex-oauth.ts`:**
- `buildYandexAuthorizeUrl({ state, redirectUri })` → `https://oauth.yandex.ru/authorize?...`
- `exchangeYandexCode({ code, redirectUri })` → POST to `https://oauth.yandex.ru/token`, returns access_token.
- `fetchYandexUserInfo(accessToken)` → GET `https://login.yandex.ru/info?format=json`, returns `{id, login, default_email, first_name, last_name, default_avatar_id}`.
- Reuses existing `env.telegram.botApiBaseUrl` pattern: `env.yandexOAuth.{clientId, clientSecret, authorizeUrl, tokenUrl, userInfoUrl, redirectUri}`.
- NO direct dependency on Yandex servers from backend code paths — env-driven URLs are the abstraction.

**Endpoints (Pattern B — separate login vs link):**

*Login (anonymous, no session required):*
- `GET /api/v1/auth/yandex/start?redirectTo=/app`
  → builds CSRF state (HMAC-signed nonce, TTL 10min, single-use, stored in `auth_oauth_state` table — reuse migration 017 pattern OR extend it), saves state, 302 to authorize URL.
- `GET /api/v1/auth/yandex/callback?code=...&state=...`
  → validates state (consume), exchanges code, fetches user info, calls `completeOAuthLogin({intent:'login', ...})`. On NO_ACCOUNT → 302 to `/login?auth_error=NO_ACCOUNT&detail=request_invite_from_admin`.

*Link (requires session):*
- `GET /api/v1/auth/yandex/link/start` (middleware: `requireSession`)
  → same as login/start but `intent=link` baked into signed state.
- `GET /api/v1/auth/yandex/link/callback?code=...&state=...`
  → validates state (consume), exchanges code, fetches user info, **redirects to pre-confirmation page** `/auth/yandex/link/confirm?token=<short-lived-confirm-token>`. The confirm token references a temporary row holding `(user_id, provider, provider_user_id, email)` with 5-minute TTL.
- `POST /api/v1/auth/yandex/link/confirm` body: `{ token }`
  → reads temp row, calls `completeOAuthLogin({intent:'link', ...})`, deletes temp row, returns `{ ok: true }`.
- `POST /api/v1/auth/yandex/unlink` (middleware: `requireSession`)
  → reject if it's the user's last identity OR if status='inactive'. Audit `identity.unlink`. Returns `{ ok: true }`.

**CSRF state storage:** new migration `023_auth_oauth_state.sql` (generalize existing `auth_oidc_state`):
```sql
CREATE TABLE auth_oauth_state (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  intent TEXT NOT NULL CHECK (intent IN ('login', 'link')),
  link_user_id UUID,                -- only when intent='link'
  redirect_to TEXT NOT NULL,
  code_verifier TEXT,                -- PKCE (Yandex supports)
  nonce TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
CREATE INDEX idx_auth_oauth_state_expires ON auth_oauth_state(expires_at);
```

**Pre-link confirm storage:** new migration `024_auth_oauth_pending_link.sql`:
```sql
CREATE TABLE auth_oauth_pending_link (
  token TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  provider_email TEXT,
  provider_display_name TEXT,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_auth_oauth_pending_link_expires ON auth_oauth_pending_link(expires_at);
```

**Audit log:** existing `audit_logs` table. New event names:
- `auth.yandex.login` (existing pattern: `auth.<provider>.login`)
- `identity.link` (payload: `{provider, provider_user_id, ip_hash, ua_hash}`)
- `identity.unlink` (payload: `{provider, provider_user_id, reason: 'user_requested', actor_user_id, ip_hash, ua_hash}`)

**Env block in `backend/src/config/env.ts`:**
```ts
yandexOAuth: {
  enabled: asBoolean(process.env.AUTH_YANDEX_ENABLED, false),
  clientId: process.env.YANDEX_OAUTH_CLIENT_ID || '',
  clientSecret: process.env.YANDEX_OAUTH_CLIENT_SECRET || '',
  redirectUri: process.env.YANDEX_OAUTH_REDIRECT_URI || '',  // https://pbthub.ru/api/v1/auth/yandex/callback
  linkRedirectUri: process.env.YANDEX_OAUTH_LINK_REDIRECT_URI || '',
  authorizeUrl: process.env.YANDEX_OAUTH_AUTHORIZE_URL || 'https://oauth.yandex.ru/authorize',
  tokenUrl: process.env.YANDEX_OAUTH_TOKEN_URL || 'https://oauth.yandex.ru/token',
  userInfoUrl: process.env.YANDEX_OAUTH_USERINFO_URL || 'https://login.yandex.ru/info',
}
```
Invariant: when `enabled=true`, clientId/clientSecret/redirectUri/linkRedirectUri must be non-empty (fail-fast at boot).

### Frontend (pbth/)

**LoginView.tsx:**
- Добавить primary-стиль кнопку "Войти через Яндекс" над "Войти через Telegram-бота".
- `onClick`: `window.location.assign('/api/v1/auth/yandex/start?redirectTo=/app')`. Server-side OAuth, никаких popup / polling — Yandex поддерживает classic redirect-based flow.
- Не показывать кнопку если `import.meta.env.VITE_AUTH_YANDEX_ENABLED !== '1'` (feature flag для staging-first rollout).
- Текст ошибки для `auth_error=NO_ACCOUNT` в `auth-ux.ts`: "Войдите через Telegram-бота, чтобы создать аккаунт, потом привяжите Яндекс в профиле."

**ProfileView.tsx** (новые секции):
- Блок "Способы входа" со списком привязанных identities (запрос `GET /api/v1/auth/identities`):
  - Telegram (нельзя отвязать пока это последний identity).
  - Yandex (если привязан) — с кнопкой "Отвязать". Если не привязан — кнопка "Привязать Яндекс".
- При нажатии "Привязать Яндекс" → `window.location.assign('/api/v1/auth/yandex/link/start')`.
- После redirect на confirm-page показываем "Привязать Яндекс `e***@yandex.ru`?" с кнопками Подтвердить / Отмена. Подтвердить → `POST /api/v1/auth/yandex/link/confirm` с token из URL.

**New endpoint for identities list:** `GET /api/v1/auth/identities` returns `[{provider, provider_email_masked, linked_at}]` для текущей session.

### Rollout

**Phase 0 — Yandex OAuth registration:**
- Регистрация app на [oauth.yandex.ru](https://oauth.yandex.ru/). Vasily получает `client_id` + `client_secret`. Прописывает в `/opt/pbth/shared/env/{staging,prod}.env`.

**Phase 1 — Backend identity layer (no UI):**
- Migrations 021-024.
- Helper rename + tests.
- ADMIN allowlist обновляется на `provider='telegram'` явно.
- Yandex endpoints с `AUTH_YANDEX_ENABLED=0` (404 при попытке).

**Phase 2 — Login flow:**
- Frontend login button (под VITE feature flag).
- Включаем `AUTH_YANDEX_ENABLED=1` на staging.
- Manual smoke: создаём Yandex-only user через invite-link? Или сначала Telegram → потом login через Yandex после link.
- → Prod после verify.

**Phase 3 — Manual link flow (Profile):**
- Profile UI: список identities + link/unlink.
- Pre-confirmation page.
- Endpoint `/identities` + link/unlink endpoints.
- Тесты на race conditions + last-identity-protection.

**Phase 4 — Cleanup (отдельный PR через 1-2 sprint):**
- DROP `users.telegram_id`.
- Удалить cached read-paths.

## Testing

- **Unit:** Yandex OAuth helpers (mock fetch), `completeOAuthLogin` (mock pool, проверка веток login/link/no_account/race).
- **Integration:** end-to-end Yandex login flow через supertest (mock token exchange + userinfo); end-to-end link flow с pre-confirmation.
- **Security:** state replay rejection, link race, last-identity unlink rejection, ADMIN scope не доступен через Yandex.
- **Migration tests:** существующий `release-compose-env.test.ts` pattern — добавить проверку что env block для Yandex прокидывается через docker-compose.release.yml.

## Out of scope (записываем в backlog)

- Cooldown 24-72h между unlink и re-link (#cooldown-followup).
- Email hash + last 4 chars для GDPR (#email-hash-followup).
- Auto-merge by email — навсегда rejected by spec.
- VK OAuth — отдельным PR'ом после Yandex stabilization.
- Google / Apple OAuth — TBD.
- Phone storage — TBD when SMS/WhatsApp use case ready.

## References

- Council session (consensus + disagreements): [`council-2026-05-10-oauth-identity.md`](../council-2026-05-10-oauth-identity.md)
- Yandex OAuth docs: https://yandex.ru/dev/id/doc/dg/oauth/concepts/about.html
- Yandex user info endpoint: https://yandex.ru/dev/id/doc/dg/api-id/reference/request.html
- Original Codex spec (2026-03-21): [pbth_spec_2026_03_21_auth_migration_pwa_push.md](../../../../02_PROJECTS/Paintball%20TeamHub/06_specs/pbth_spec_2026_03_21_auth_migration_pwa_push.md)
