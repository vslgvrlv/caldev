# Yandex OAuth Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Yandex OAuth as a secondary login provider with provider-agnostic identity model, keeping Telegram as primary onboarding path. VK ляжет следующим PR'ом поверх той же абстракции.

**Architecture:** New `user_identities` table holds one row per (user, provider) pair. Existing `users.telegram_id` migrates into the table and stays as denormalized cache for 1-2 sprints. `completeTelegramLogin` (currently inline at `backend/src/modules/auth/routes.ts:216`) extracts to `backend/src/lib/oauth-login.ts` as `completeOAuthLogin(req, res, params)` — one dispatcher for telegram, yandex, future providers. Pattern B endpoints: separate login (anonymous) vs link (session-required) flows, with pre-confirmation page before commit. ADMIN role stays Telegram-only via explicit `provider='telegram'` check.

**Tech Stack:** Express 4, PostgreSQL 16, `pg` driver, Yandex OAuth 2.0, React 18, Vite, Vitest, Supertest.

**Spec:** [`docs/superpowers/specs/2026-05-10-pbth-oauth-identity-design.md`](../specs/2026-05-10-pbth-oauth-identity-design.md)
**Council:** [`docs/superpowers/council-2026-05-10-oauth-identity.md`](../council-2026-05-10-oauth-identity.md)

---

## File Structure

### New backend files
| File | Responsibility |
|------|---------------|
| `backend/src/db/migrations/021_user_identities.sql` | Table + indexes + backfill from `users.telegram_id` |
| `backend/src/db/migrations/022_users_email.sql` | Add nullable `users.email` |
| `backend/src/db/migrations/023_auth_oauth_state.sql` | CSRF state store (generic, supersedes pattern of `auth_oidc_state`) |
| `backend/src/db/migrations/024_auth_oauth_pending_link.sql` | Short-lived token rows for pre-confirmation page |
| `backend/src/lib/yandex-oauth.ts` | Authorize URL builder, code exchange, user info fetch |
| `backend/src/lib/oauth-state.ts` | Generic CSRF state CRUD (used by yandex; VK later reuses) |
| `backend/src/lib/oauth-login.ts` | `completeOAuthLogin` — extracted from routes.ts, extended for multi-provider |
| `backend/src/lib/identity-repo.ts` | DB helpers: `findIdentity`, `linkIdentity`, `unlinkIdentity`, `listIdentitiesForUser` |
| `backend/src/modules/auth/yandex-routes.ts` | `/start`, `/callback`, `/link/start`, `/link/callback`, `/link/confirm`, `/unlink` |
| `backend/src/modules/auth/identities-routes.ts` | `GET /identities` (list current user's linked providers) |
| `backend/src/__tests__/unit/oauth-state.test.ts` | State signing, expiry, single-use |
| `backend/src/__tests__/unit/yandex-oauth.test.ts` | Authorize URL shape, token exchange, user info parsing |
| `backend/src/__tests__/unit/oauth-login.test.ts` | Login/link/no-account dispatcher behaviour |
| `backend/src/__tests__/unit/yandex-routes.test.ts` | Endpoint-level tests with mocked Yandex calls |
| `backend/src/__tests__/integration/yandex-flow.test.ts` | End-to-end login + link via supertest |

### New frontend files
| File | Responsibility |
|------|---------------|
| `pbth/lib/yandex-auth.ts` | `completeYandexLink(token)`, `listIdentities()`, `unlinkProvider(provider)` |
| `pbth/views/YandexLinkConfirmView.tsx` | Pre-confirmation page after link callback |
| `pbth/components/ProfileIdentities.tsx` | Block in Profile: linked providers + actions |
| `pbth/__tests__/unit/yandex-auth.test.ts` | Client tests |

### Backend files to modify
| File | Change |
|------|--------|
| `backend/src/config/env.ts` | Add `yandexOAuth` block + invariant guard |
| `backend/src/lib/http-error.ts` | New codes: `OAUTH_STATE_INVALID`, `OAUTH_STATE_EXPIRED`, `OAUTH_NO_ACCOUNT`, `OAUTH_LINK_TAKEN`, `OAUTH_LAST_IDENTITY`, `OAUTH_PROVIDER_DISABLED` |
| `backend/src/modules/auth/routes.ts` | Replace inline `completeTelegramLogin` (lines 216-340) — re-import from `lib/oauth-login.ts`; update 6 call sites (lines 730, 972, 1172, 1248, 1280, 1332) |
| `backend/src/modules/auth/routes.ts` (further) | ADMIN-allowlist lookup: replace `users.telegram_id` query at admin-role-check sites with `user_identities WHERE provider='telegram'` join |
| `backend/src/app.ts` | Mount `yandexRouter` under `/api/v1/auth/yandex`; mount `identitiesRouter` under `/api/v1/auth/identities` (BEFORE `/auth` to avoid prefix swallowing) |

### Frontend files to modify
| File | Change |
|------|--------|
| `pbth/views/LoginView.tsx` | Add primary "Войти через Яндекс" button under `VITE_AUTH_YANDEX_ENABLED='1'` feature flag |
| `pbth/lib/auth-ux.ts` | New error code `OAUTH_NO_ACCOUNT` with friendly Russian message |
| `pbth/App.tsx` | Add `<Route path="/auth/yandex/link/confirm" element={<YandexLinkConfirmView />} />` |
| `pbth/views/ProfileView.tsx` (or AppLayout profile section — find with grep) | Mount `<ProfileIdentities />` |
| `pbth/Dockerfile` | Add `ARG VITE_AUTH_YANDEX_ENABLED=0` + `ENV` line before `npm run build` |

### Infra / env files
| File | Change |
|------|--------|
| `.env.example`, `docker-compose.yml`, `docker-compose.release.yml`, `scripts/release/env.prod.example`, `scripts/release/env.staging.example` | Add `AUTH_YANDEX_ENABLED`, `YANDEX_OAUTH_CLIENT_ID`, `YANDEX_OAUTH_CLIENT_SECRET`, `YANDEX_OAUTH_REDIRECT_URI`, `YANDEX_OAUTH_LINK_REDIRECT_URI`, `VITE_AUTH_YANDEX_ENABLED` |

---

## Phase 0: Yandex app registration (manual, Vasily)

### Task 0: Register Yandex app

- [ ] **Step 1:** Open https://oauth.yandex.ru/, log in.
- [ ] **Step 2:** Create new app, name "Paintball Team Hub", platforms "Веб-сервисы", access permissions: `login:email`, `login:info`, `login:avatar`.
- [ ] **Step 3:** Add **two** redirect URIs: `https://pbthub.ru/api/v1/auth/yandex/callback` and `https://pbthub.ru/api/v1/auth/yandex/link/callback`. Same pair with `staging.` prefix.
- [ ] **Step 4:** Capture `client_id` and `client_secret`. Save in `/opt/pbth/shared/env/staging.env` first, prod later.

This step is manual and must complete before Task 14 (staging deploy). The implementation can proceed without it because the flag stays off in non-prod environments during Phase 1.

---

## Phase 1: Backend identity layer

### Task 1: Database migrations

**Files:**
- Create: `backend/src/db/migrations/021_user_identities.sql`
- Create: `backend/src/db/migrations/022_users_email.sql`
- Create: `backend/src/db/migrations/023_auth_oauth_state.sql`
- Create: `backend/src/db/migrations/024_auth_oauth_pending_link.sql`

- [ ] **Step 1: Write `021_user_identities.sql`**

```sql
CREATE TABLE IF NOT EXISTS user_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  email TEXT,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_identities_provider_subject_unique UNIQUE (provider, provider_user_id),
  CONSTRAINT user_identities_user_provider_unique UNIQUE (user_id, provider)
);

LOCK TABLE users IN SHARE MODE;

INSERT INTO user_identities (user_id, provider, provider_user_id)
SELECT id, 'telegram', telegram_id::TEXT
FROM users
WHERE telegram_id IS NOT NULL
ON CONFLICT (provider, provider_user_id) DO NOTHING;
```

- [ ] **Step 2: Write `022_users_email.sql`**

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
```

- [ ] **Step 3: Write `023_auth_oauth_state.sql`**

```sql
CREATE TABLE IF NOT EXISTS auth_oauth_state (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  intent TEXT NOT NULL CHECK (intent IN ('login', 'link')),
  link_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  redirect_to TEXT NOT NULL,
  code_verifier TEXT,
  nonce TEXT,
  ip_hash TEXT,
  ua_hash TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_auth_oauth_state_expires_at ON auth_oauth_state (expires_at);
```

- [ ] **Step 4: Write `024_auth_oauth_pending_link.sql`**

```sql
CREATE TABLE IF NOT EXISTS auth_oauth_pending_link (
  token TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  provider_email TEXT,
  provider_display_name TEXT,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_oauth_pending_link_expires_at ON auth_oauth_pending_link (expires_at);
```

- [ ] **Step 5: Apply migrations locally**

```bash
cd backend && DB_HOST=127.0.0.1 BACKEND_ENV_FILE=/Users/pk/Documents/CalDEV/.env npm run db:migrate
```
Expected: 4 `applied` lines for migrations 021-024.

- [ ] **Step 6: Verify schema + backfill**

```bash
docker exec caldev-db-1 psql -U pbth -d pbth -c "\dt user_identities; \dt auth_oauth_state; \dt auth_oauth_pending_link"
docker exec caldev-db-1 psql -U pbth -d pbth -c "SELECT provider, count(*) FROM user_identities GROUP BY provider"
```
Expected: 3 tables, `telegram` count matches existing user count (~20).

- [ ] **Step 7: Commit**

```bash
git add backend/src/db/migrations/021_user_identities.sql backend/src/db/migrations/022_users_email.sql backend/src/db/migrations/023_auth_oauth_state.sql backend/src/db/migrations/024_auth_oauth_pending_link.sql
git commit -m "feat(db): user_identities + email + oauth state tables"
```

### Task 2: Env config + error codes

**Files:**
- Modify: `backend/src/config/env.ts`
- Modify: `backend/src/lib/http-error.ts`
- Create: `backend/src/__tests__/unit/env-yandex.test.ts`

- [ ] **Step 1: Write failing env test**

```typescript
// backend/src/__tests__/unit/env-yandex.test.ts
import { beforeAll, describe, expect, it } from "vitest";

let env: typeof import("../../config/env.js").env;

beforeAll(async () => {
  process.env.TELEGRAM_BOT_TOKEN = "123:dummy";
  process.env.TELEGRAM_BOT_USERNAME = "dummy_bot";
  process.env.TELEGRAM_CALLBACK_URL = "http://127.0.0.1:8000/api/v1/auth/telegram/callback";
  process.env.AUTH_YANDEX_ENABLED = "1";
  process.env.YANDEX_OAUTH_CLIENT_ID = "yandex-cid";
  process.env.YANDEX_OAUTH_CLIENT_SECRET = "yandex-secret";
  process.env.YANDEX_OAUTH_REDIRECT_URI = "https://pbthub.ru/api/v1/auth/yandex/callback";
  process.env.YANDEX_OAUTH_LINK_REDIRECT_URI = "https://pbthub.ru/api/v1/auth/yandex/link/callback";
  ({ env } = await import("../../config/env.js"));
});

describe("yandex oauth env", () => {
  it("exposes provider config", () => {
    expect(env.yandexOAuth.enabled).toBe(true);
    expect(env.yandexOAuth.clientId).toBe("yandex-cid");
    expect(env.yandexOAuth.clientSecret).toBe("yandex-secret");
    expect(env.yandexOAuth.redirectUri).toContain("/auth/yandex/callback");
    expect(env.yandexOAuth.linkRedirectUri).toContain("/auth/yandex/link/callback");
    expect(env.yandexOAuth.authorizeUrl).toBe("https://oauth.yandex.ru/authorize");
    expect(env.yandexOAuth.tokenUrl).toBe("https://oauth.yandex.ru/token");
    expect(env.yandexOAuth.userInfoUrl).toBe("https://login.yandex.ru/info");
  });
});
```

- [ ] **Step 2: Verify it fails**
Run `cd backend && DB_HOST=127.0.0.1 BACKEND_ENV_FILE=/Users/pk/Documents/CalDEV/.env npm run test:unit -- src/__tests__/unit/env-yandex.test.ts`. Expect FAIL — `env.yandexOAuth` undefined.

- [ ] **Step 3: Extend `env.ts`**

After the `telegramOidc` block, add:
```ts
yandexOAuth: {
  enabled: asBoolean(process.env.AUTH_YANDEX_ENABLED, false),
  clientId: process.env.YANDEX_OAUTH_CLIENT_ID || "",
  clientSecret: process.env.YANDEX_OAUTH_CLIENT_SECRET || "",
  redirectUri: process.env.YANDEX_OAUTH_REDIRECT_URI || "",
  linkRedirectUri: process.env.YANDEX_OAUTH_LINK_REDIRECT_URI || "",
  authorizeUrl: process.env.YANDEX_OAUTH_AUTHORIZE_URL || "https://oauth.yandex.ru/authorize",
  tokenUrl: process.env.YANDEX_OAUTH_TOKEN_URL || "https://oauth.yandex.ru/token",
  userInfoUrl: process.env.YANDEX_OAUTH_USERINFO_URL || "https://login.yandex.ru/info",
  stateTtlSeconds: asNumber(process.env.AUTH_YANDEX_STATE_TTL_SEC || "600", "AUTH_YANDEX_STATE_TTL_SEC"),
  pendingLinkTtlSeconds: asNumber(process.env.AUTH_YANDEX_PENDING_LINK_TTL_SEC || "300", "AUTH_YANDEX_PENDING_LINK_TTL_SEC"),
},
```

Add invariant at file bottom:
```ts
if (env.yandexOAuth.enabled) {
  if (!env.yandexOAuth.clientId) throw new Error("YANDEX_OAUTH_CLIENT_ID required when AUTH_YANDEX_ENABLED=1");
  if (!env.yandexOAuth.clientSecret) throw new Error("YANDEX_OAUTH_CLIENT_SECRET required when AUTH_YANDEX_ENABLED=1");
  if (!env.yandexOAuth.redirectUri) throw new Error("YANDEX_OAUTH_REDIRECT_URI required when AUTH_YANDEX_ENABLED=1");
  if (!env.yandexOAuth.linkRedirectUri) throw new Error("YANDEX_OAUTH_LINK_REDIRECT_URI required when AUTH_YANDEX_ENABLED=1");
}
```

- [ ] **Step 4: Extend `ApiErrorCode`**

In `backend/src/lib/http-error.ts`, add:
```ts
| "OAUTH_STATE_INVALID"
| "OAUTH_STATE_EXPIRED"
| "OAUTH_NO_ACCOUNT"
| "OAUTH_LINK_TAKEN"
| "OAUTH_LAST_IDENTITY"
| "OAUTH_PROVIDER_DISABLED"
| "OAUTH_PENDING_LINK_EXPIRED"
```

- [ ] **Step 4b: Extend `AuthMetricMethod`**

In `backend/src/lib/auth-slo.ts:1`, add `"YANDEX_OAUTH"` to the union so downstream calls don't need `as any`:
```ts
export type AuthMetricMethod = "OIDC" | "WEBAPP" | "LEGACY_WIDGET" | "DEV" | "UNKNOWN" | "BOT_HANDOFF" | "YANDEX_OAUTH";
```
(Confirm the existing list by reading the file — keep all existing values, just append `"YANDEX_OAUTH"`.)

- [ ] **Step 5: Verify tests pass + typecheck**

```bash
cd backend && npm run check && DB_HOST=127.0.0.1 BACKEND_ENV_FILE=/Users/pk/Documents/CalDEV/.env npm run test:unit
```
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add backend/src/config/env.ts backend/src/lib/http-error.ts backend/src/__tests__/unit/env-yandex.test.ts
git commit -m "feat(auth): yandex env config + OAuth error codes"
```

### Task 3: Identity repository

**Files:**
- Create: `backend/src/lib/identity-repo.ts`
- Create: `backend/src/__tests__/unit/identity-repo.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// backend/src/__tests__/unit/identity-repo.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.TELEGRAM_BOT_TOKEN = "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = "dummy_bot";
process.env.TELEGRAM_CALLBACK_URL = "http://127.0.0.1:8000/api/v1/auth/telegram/callback";

let pool: typeof import("../../db/pool.js").pool;
let repo: typeof import("../../lib/identity-repo.js");
let testUserId: string;

beforeAll(async () => {
  ({ pool } = await import("../../db/pool.js"));
  repo = await import("../../lib/identity-repo.js");
  const r = await pool.query<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name, nickname, account_role)
     VALUES (999991, 'identity_test', 'Identity', 'id_test', 'USER')
     ON CONFLICT (telegram_id) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`
  );
  testUserId = r.rows[0].id;
});

afterAll(async () => {
  await pool.query(`DELETE FROM user_identities WHERE user_id = $1`, [testUserId]);
  await pool.query(`DELETE FROM users WHERE id = $1`, [testUserId]);
});

describe("identity-repo", () => {
  it("link + find + list + unlink round-trip", async () => {
    const r = await repo.linkIdentity({ userId: testUserId, provider: "yandex", providerUserId: "yandex_test_1", email: "x@y.ru" });
    expect(r.conflict).toBeNull();
    expect(r.identity?.userId).toBe(testUserId);
    const found = await repo.findIdentity("yandex", "yandex_test_1");
    expect(found?.userId).toBe(testUserId);
    const list = await repo.listIdentitiesForUser(testUserId);
    expect(list.map((i) => i.provider)).toContain("yandex");
    const unlinked = await repo.unlinkIdentity(testUserId, "yandex");
    expect(unlinked).toBe(true);
    expect(await repo.findIdentity("yandex", "yandex_test_1")).toBeNull();
  });

  it("returns USER_PROVIDER_TAKEN when same user re-links same provider", async () => {
    await repo.linkIdentity({ userId: testUserId, provider: "yandex", providerUserId: "yandex_dup_a", email: null });
    const second = await repo.linkIdentity({ userId: testUserId, provider: "yandex", providerUserId: "yandex_dup_b", email: null });
    expect(second.identity).toBeNull();
    expect(second.conflict).toBe("USER_PROVIDER_TAKEN");
    await repo.unlinkIdentity(testUserId, "yandex");
  });

  it("returns PROVIDER_SUBJECT_TAKEN when same yandex id is linked to a different user", async () => {
    // Make a second user
    const u2 = await pool.query<{ id: string }>(
      `INSERT INTO users (telegram_id, username, name, nickname, account_role)
       VALUES (999992, 'identity_test_2', 'Other', 'other_test', 'USER')
       ON CONFLICT (telegram_id) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`
    );
    const otherUserId = u2.rows[0].id;
    await repo.linkIdentity({ userId: testUserId, provider: "yandex", providerUserId: "yandex_shared", email: null });
    const second = await repo.linkIdentity({ userId: otherUserId, provider: "yandex", providerUserId: "yandex_shared", email: null });
    expect(second.identity).toBeNull();
    expect(second.conflict).toBe("PROVIDER_SUBJECT_TAKEN");
    await repo.unlinkIdentity(testUserId, "yandex");
    await pool.query(`DELETE FROM users WHERE id = $1`, [otherUserId]);
  });
});
```

- [ ] **Step 2: Verify FAIL**

Run `npm run test:unit -- src/__tests__/unit/identity-repo.test.ts`. Expect module-not-found.

- [ ] **Step 3: Implement `backend/src/lib/identity-repo.ts`**

```typescript
import { pool } from "../db/pool.js";

export interface IdentityRow {
  userId: string;
  provider: string;
  providerUserId: string;
  email: string | null;
  linkedAt: Date;
}

function mapRow(r: any): IdentityRow {
  return {
    userId: r.user_id,
    provider: r.provider,
    providerUserId: r.provider_user_id,
    email: r.email,
    linkedAt: r.linked_at,
  };
}

export async function findIdentity(provider: string, providerUserId: string): Promise<IdentityRow | null> {
  const { rows } = await pool.query(
    `SELECT user_id, provider, provider_user_id, email, linked_at
     FROM user_identities
     WHERE provider = $1 AND provider_user_id = $2
     LIMIT 1`,
    [provider, providerUserId]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function listIdentitiesForUser(userId: string): Promise<IdentityRow[]> {
  const { rows } = await pool.query(
    `SELECT user_id, provider, provider_user_id, email, linked_at
     FROM user_identities
     WHERE user_id = $1
     ORDER BY linked_at`,
    [userId]
  );
  return rows.map(mapRow);
}

export type LinkConflict = "PROVIDER_SUBJECT_TAKEN" | "USER_PROVIDER_TAKEN";

export interface LinkResult {
  identity: IdentityRow | null;
  conflict: LinkConflict | null;
}

export async function linkIdentity(input: {
  userId: string;
  provider: string;
  providerUserId: string;
  email: string | null;
}): Promise<LinkResult> {
  // Race-safe: ON CONFLICT DO NOTHING covers both UNIQUE constraints atomically.
  const { rows } = await pool.query(
    `INSERT INTO user_identities (user_id, provider, provider_user_id, email)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING
     RETURNING user_id, provider, provider_user_id, email, linked_at`,
    [input.userId, input.provider, input.providerUserId, input.email]
  );
  if (rows[0]) {
    return { identity: mapRow(rows[0]), conflict: null };
  }
  // Conflict happened. Distinguish which UNIQUE fired so callers can return the right error code.
  const { rows: subjectRows } = await pool.query(
    `SELECT user_id FROM user_identities WHERE provider = $1 AND provider_user_id = $2`,
    [input.provider, input.providerUserId]
  );
  if (subjectRows[0]) {
    return { identity: null, conflict: "PROVIDER_SUBJECT_TAKEN" };
  }
  return { identity: null, conflict: "USER_PROVIDER_TAKEN" };
}

export async function unlinkIdentity(userId: string, provider: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM user_identities WHERE user_id = $1 AND provider = $2`,
    [userId, provider]
  );
  return (rowCount ?? 0) > 0;
}

export async function countIdentitiesForUser(userId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM user_identities WHERE user_id = $1`,
    [userId]
  );
  return Number(rows[0].count);
}
```

- [ ] **Step 4: Verify tests pass**

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/identity-repo.ts backend/src/__tests__/unit/identity-repo.test.ts
git commit -m "feat(auth): user_identities repository helpers"
```

### Task 4: OAuth state store

**Files:**
- Create: `backend/src/lib/oauth-state.ts`
- Create: `backend/src/__tests__/unit/oauth-state.test.ts`

- [ ] **Step 1: Write failing tests** covering: create state (returns opaque string), consume state (one-shot), reject expired, reject wrong provider, intent-bound.

```typescript
// backend/src/__tests__/unit/oauth-state.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.TELEGRAM_BOT_TOKEN = "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = "dummy_bot";
process.env.TELEGRAM_CALLBACK_URL = "http://127.0.0.1:8000/api/v1/auth/telegram/callback";

let pool: typeof import("../../db/pool.js").pool;
let state: typeof import("../../lib/oauth-state.js");

beforeAll(async () => {
  ({ pool } = await import("../../db/pool.js"));
  state = await import("../../lib/oauth-state.js");
});

afterAll(async () => {
  await pool.query(`DELETE FROM auth_oauth_state WHERE provider = 'yandex' AND redirect_to LIKE 'oauth-state-test%'`);
});

describe("oauth-state", () => {
  it("createState returns token, consume returns row once", async () => {
    const { state: tok } = await state.createState({
      provider: "yandex", intent: "login", redirectTo: "oauth-state-test-1",
      ttlSeconds: 60, ipHash: null, uaHash: null, linkUserId: null, codeVerifier: null, nonce: null,
    });
    const c1 = await state.consumeState(tok, "yandex");
    expect(c1?.redirectTo).toBe("oauth-state-test-1");
    const c2 = await state.consumeState(tok, "yandex");
    expect(c2).toBeNull();
  });

  it("consume rejects wrong provider", async () => {
    const { state: tok } = await state.createState({
      provider: "yandex", intent: "login", redirectTo: "oauth-state-test-2",
      ttlSeconds: 60, ipHash: null, uaHash: null, linkUserId: null, codeVerifier: null, nonce: null,
    });
    expect(await state.consumeState(tok, "vk")).toBeNull();
    await state.consumeState(tok, "yandex"); // cleanup
  });

  it("consume rejects expired", async () => {
    const { state: tok } = await state.createState({
      provider: "yandex", intent: "login", redirectTo: "oauth-state-test-3",
      ttlSeconds: -1, ipHash: null, uaHash: null, linkUserId: null, codeVerifier: null, nonce: null,
    });
    expect(await state.consumeState(tok, "yandex")).toBeNull();
  });
});
```

- [ ] **Step 2: Verify FAIL**

- [ ] **Step 3: Implement `backend/src/lib/oauth-state.ts`**

```typescript
import crypto from "node:crypto";
import { pool } from "../db/pool.js";

export type OAuthIntent = "login" | "link";

export interface OAuthStateRow {
  state: string;
  provider: string;
  intent: OAuthIntent;
  linkUserId: string | null;
  redirectTo: string;
  codeVerifier: string | null;
  nonce: string | null;
  expiresAt: Date;
}

export interface CreateStateInput {
  provider: string;
  intent: OAuthIntent;
  redirectTo: string;
  ttlSeconds: number;
  ipHash: string | null;
  uaHash: string | null;
  linkUserId: string | null;
  codeVerifier: string | null;
  nonce: string | null;
}

function generateOpaqueToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function mapRow(r: any): OAuthStateRow {
  return {
    state: r.state,
    provider: r.provider,
    intent: r.intent,
    linkUserId: r.link_user_id,
    redirectTo: r.redirect_to,
    codeVerifier: r.code_verifier,
    nonce: r.nonce,
    expiresAt: r.expires_at,
  };
}

export async function createState(input: CreateStateInput): Promise<{ state: string; expiresAt: Date }> {
  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);
  await pool.query(
    `INSERT INTO auth_oauth_state
     (state, provider, intent, link_user_id, redirect_to, code_verifier, nonce, ip_hash, ua_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [token, input.provider, input.intent, input.linkUserId, input.redirectTo, input.codeVerifier, input.nonce, input.ipHash, input.uaHash, expiresAt]
  );
  return { state: token, expiresAt };
}

export async function consumeState(state: string, provider: string): Promise<OAuthStateRow | null> {
  const { rows } = await pool.query(
    `DELETE FROM auth_oauth_state
     WHERE state = $1
       AND provider = $2
       AND consumed_at IS NULL
       AND expires_at > NOW()
     RETURNING state, provider, intent, link_user_id, redirect_to, code_verifier, nonce, expires_at`,
    [state, provider]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function pruneExpiredStates(): Promise<number> {
  const { rowCount } = await pool.query(`DELETE FROM auth_oauth_state WHERE expires_at < NOW() - INTERVAL '1 day'`);
  return rowCount ?? 0;
}
```

- [ ] **Step 4: Verify PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/oauth-state.ts backend/src/__tests__/unit/oauth-state.test.ts
git commit -m "feat(auth): oauth-state store with single-use consume"
```

### Task 5: Yandex OAuth helpers

**Files:**
- Create: `backend/src/lib/yandex-oauth.ts`
- Create: `backend/src/__tests__/unit/yandex-oauth.test.ts`

- [ ] **Step 1: Write failing tests for `buildYandexAuthorizeUrl`, `exchangeYandexCode`, `fetchYandexUserInfo`** with mocked fetch.

```typescript
// backend/src/__tests__/unit/yandex-oauth.test.ts
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

process.env.TELEGRAM_BOT_TOKEN = "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = "dummy_bot";
process.env.TELEGRAM_CALLBACK_URL = "http://127.0.0.1:8000/api/v1/auth/telegram/callback";
process.env.AUTH_YANDEX_ENABLED = "1";
process.env.YANDEX_OAUTH_CLIENT_ID = "yandex-cid";
process.env.YANDEX_OAUTH_CLIENT_SECRET = "yandex-secret";
process.env.YANDEX_OAUTH_REDIRECT_URI = "https://pbthub.ru/api/v1/auth/yandex/callback";
process.env.YANDEX_OAUTH_LINK_REDIRECT_URI = "https://pbthub.ru/api/v1/auth/yandex/link/callback";

let mod: typeof import("../../lib/yandex-oauth.js");

beforeAll(async () => {
  mod = await import("../../lib/yandex-oauth.js");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("yandex oauth helpers", () => {
  it("buildYandexAuthorizeUrl uses configured client_id and redirect_uri", () => {
    const url = mod.buildYandexAuthorizeUrl({ state: "S", redirectUri: "https://r" });
    expect(url).toContain("https://oauth.yandex.ru/authorize");
    expect(url).toContain("client_id=yandex-cid");
    expect(url).toContain("redirect_uri=https%3A%2F%2Fr");
    expect(url).toContain("response_type=code");
    expect(url).toContain("state=S");
  });

  it("exchangeYandexCode POSTs with client_secret_basic", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: "AT", token_type: "bearer", expires_in: 3600 }) });
    vi.stubGlobal("fetch", fetchMock);
    const res = await mod.exchangeYandexCode({ code: "auth-code", redirectUri: "https://r" });
    expect(res.access_token).toBe("AT");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://oauth.yandex.ru/token");
    expect((init.headers as any)["content-type"]).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(String(init.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("redirect_uri")).toBe("https://r");
    expect(body.get("client_id")).toBe("yandex-cid");
    expect(body.get("client_secret")).toBe("yandex-secret");
  });

  it("fetchYandexUserInfo parses id/login/email/name", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "1234",
        login: "vasily",
        default_email: "v@y.ru",
        first_name: "Vasily",
        last_name: "Gavrilov",
        default_avatar_id: "avatar-id",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const info = await mod.fetchYandexUserInfo("ACCESS");
    expect(info.id).toBe("1234");
    expect(info.email).toBe("v@y.ru");
    expect(info.firstName).toBe("Vasily");
    expect(info.lastName).toBe("Gavrilov");
    expect(info.login).toBe("vasily");
    expect(info.avatarUrl).toContain("avatar-id");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/login\.yandex\.ru\/info/);
    expect((init.headers as any).Authorization).toBe("OAuth ACCESS");
  });
});
```

- [ ] **Step 2: Verify FAIL**

- [ ] **Step 3: Implement `backend/src/lib/yandex-oauth.ts`**

```typescript
import { env } from "../config/env.js";

export interface YandexUserInfo {
  id: string;
  login: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface YandexTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

export function buildYandexAuthorizeUrl(params: { state: string; redirectUri: string }): string {
  const url = new URL(env.yandexOAuth.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.yandexOAuth.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state);
  url.searchParams.set("force_confirm", "yes");
  return url.toString();
}

export async function exchangeYandexCode(params: { code: string; redirectUri: string }): Promise<YandexTokenResponse> {
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", params.code);
  body.set("redirect_uri", params.redirectUri);
  body.set("client_id", env.yandexOAuth.clientId);
  body.set("client_secret", env.yandexOAuth.clientSecret);

  const res = await fetch(env.yandexOAuth.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`YANDEX_TOKEN_FAILED:${res.status}:${text.slice(0, 200)}`);
  }
  return (await res.json()) as YandexTokenResponse;
}

export async function fetchYandexUserInfo(accessToken: string): Promise<YandexUserInfo> {
  const url = new URL(env.yandexOAuth.userInfoUrl);
  url.searchParams.set("format", "json");
  const res = await fetch(url.toString(), {
    headers: { Authorization: `OAuth ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`YANDEX_USERINFO_FAILED:${res.status}:${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as Record<string, any>;
  const avatarId = data.default_avatar_id ? String(data.default_avatar_id) : null;
  return {
    id: String(data.id),
    login: data.login ? String(data.login) : null,
    email: data.default_email ? String(data.default_email) : null,
    firstName: data.first_name ? String(data.first_name) : null,
    lastName: data.last_name ? String(data.last_name) : null,
    displayName: data.real_name || data.display_name || null,
    avatarUrl: avatarId ? `https://avatars.yandex.net/get-yapic/${avatarId}/islands-200` : null,
  };
}
```

- [ ] **Step 4: Verify PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/yandex-oauth.ts backend/src/__tests__/unit/yandex-oauth.test.ts
git commit -m "feat(auth): yandex oauth helpers — authorize/token/userinfo"
```

### Task 6: Extract `completeOAuthLogin` from routes.ts

**Files:**
- Create: `backend/src/lib/oauth-login.ts`
- Modify: `backend/src/modules/auth/routes.ts` (replace function at 216-340; update 6 call sites)

- [ ] **Step 1: Locate function**

```bash
grep -n "async function completeTelegramLogin" backend/src/modules/auth/routes.ts
grep -n "completeTelegramLogin(" backend/src/modules/auth/routes.ts
```
Note: 1 definition at line 216, 6 call sites (lines 730, 972, 1172, 1248, 1280, 1332 according to current main; verify).

- [ ] **Step 2: Read existing `completeTelegramLogin` (routes.ts:216-340) and enumerate ALL invariants it preserves**

Before lifting, list every side-effect of the inline function:
- (1) Upsert into `users` keyed by `telegram_id` (`ON CONFLICT DO UPDATE` of name/nickname/avatar)
- (2) `account_role = 'USER'` + `role_selected_at = NOW()` when `canChooseAdminRole` returns false
- (3) `onboarding_completed_at`: for non-`BOT_HANDOFF` flows set to NOW on insert; for `BOT_HANDOFF` left NULL so the handoff onboarding screen can fire
- (4) `entryRoleOverride`: dev-login call sites pass an override that sets `req.session.entryRole` directly
- (5) `req.session.regenerate` → `req.session.userId = userId` → `req.session.authMethod = ...`
- (6) Membership bootstrap: if exactly one membership, set `activeMembershipId` + `activeTeamId`; else clear
- (7) `writeAudit(userId, "auth.telegram.login", {telegramId, authMethod})`
- (8) `req.session.save`
- (9) `res.clearCookie(LOGOUT_GUARD_COOKIE_NAME, logoutGuardCookieOptions())`

The new helper MUST preserve every one of these for the `provider='telegram'` path. Anything dropped breaks Telegram auth in prod.

- [ ] **Step 3: Lift + extend to `oauth-login.ts`**

```typescript
import type { Request, Response } from "express";
import { query } from "../db/pool.js";
import { writeAudit } from "./audit.js";
import { canChooseAdminRole } from "./entry-role.js";
import { getUserMemberships } from "./permissions.js";
import { findIdentity, linkIdentity } from "./identity-repo.js";

export type AuthMethod = "WEBAPP" | "OIDC" | "LEGACY_WIDGET" | "DEV" | "BOT_HANDOFF" | "YANDEX_OAUTH";

export interface OAuthProfile {
  id: string;
  email?: string | null;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
}

export interface CompleteOAuthLoginParams {
  provider: "telegram" | "yandex";
  profile: OAuthProfile;
  authMethod: AuthMethod;
  /** Forces a specific session.entryRole — used by dev-login flow. */
  entryRoleOverride?: "ADMIN" | "USER" | null;
}

export async function completeOAuthLogin(
  req: Request,
  res: Response,
  params: CompleteOAuthLoginParams,
): Promise<{ userId: string } | null> {
  const { provider, profile } = params;
  const existing = await findIdentity(provider, profile.id);

  let userId: string;
  let isNewUser = false;

  if (existing) {
    userId = existing.userId;
    if (provider === "telegram") {
      // Refresh denormalised users row with latest Telegram profile.
      const name = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim() || profile.username || `tg-${profile.id}`;
      const nickname = profile.username || `tg_${profile.id}`;
      await query(
        `UPDATE users
         SET username = COALESCE($2, username),
             name = $3,
             nickname = $4,
             avatar = COALESCE($5, avatar),
             updated_at = NOW()
         WHERE id = $1`,
        [userId, profile.username ?? null, name, nickname, profile.avatarUrl ?? null]
      );
    }
  } else {
    if (provider !== "telegram") {
      // Anonymous OAuth login with no existing identity → PBTH is invite-only, refuse auto-create.
      return null;
    }
    const name = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim() || profile.username || `tg-${profile.id}`;
    const nickname = profile.username || `tg_${profile.id}`;
    // Invariant (3): BOT_HANDOFF new users must NOT have onboarding_completed_at — handoff onboarding fires.
    // All other Telegram auth methods (WEBAPP, OIDC, LEGACY_WIDGET, DEV) treat the user as already-onboarded.
    const onboardingClause =
      params.authMethod === "BOT_HANDOFF"
        ? "NULL"
        : "NOW()";
    const inserted = await query<{ id: string }>(
      `INSERT INTO users (telegram_id, username, name, nickname, avatar, account_role, role_selected_at, onboarding_completed_at)
       VALUES ($1::bigint, $2, $3, $4, $5, NULL, NULL, ${onboardingClause})
       ON CONFLICT (telegram_id) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [profile.id, profile.username ?? null, name, nickname, profile.avatarUrl ?? null]
    );
    userId = inserted.rows[0].id;
    const linkResult = await linkIdentity({ userId, provider: "telegram", providerUserId: profile.id, email: null });
    if (linkResult.conflict && linkResult.conflict !== "USER_PROVIDER_TAKEN") {
      // PROVIDER_SUBJECT_TAKEN should never happen here (we just inserted the user), but log defensively.
      throw new Error(`completeOAuthLogin: unexpected link conflict ${linkResult.conflict}`);
    }
    isNewUser = true;
  }

  // Invariant (2): role assignment based on allowlist.
  if (provider === "telegram") {
    const allowAdminChoice = canChooseAdminRole({ telegram_id: profile.id, username: profile.username ?? null });
    if (!allowAdminChoice) {
      await query(
        `UPDATE users SET account_role = 'USER', role_selected_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [userId]
      );
    }
  } else {
    // Non-telegram providers cannot grant ADMIN; force USER if unset.
    await query(
      `UPDATE users SET account_role = COALESCE(account_role, 'USER'), role_selected_at = COALESCE(role_selected_at, NOW()), updated_at = NOW() WHERE id = $1`,
      [userId]
    );
  }

  // Invariant (5): regenerate session.
  await new Promise<void>((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
  req.session.userId = userId;
  req.session.authMethod = params.authMethod;

  // Invariant (4): entry-role override for dev-login. Yandex callers do not pass this.
  if (params.entryRoleOverride === "ADMIN" || params.entryRoleOverride === "USER") {
    req.session.entryRole = params.entryRoleOverride;
  } else {
    delete req.session.entryRole;
  }

  // Invariant (6): membership bootstrap.
  const memberships = await getUserMemberships(userId);
  if (memberships.length === 1) {
    req.session.activeMembershipId = memberships[0].id;
    req.session.activeTeamId = memberships[0].team_id;
  } else {
    delete req.session.activeMembershipId;
    delete req.session.activeTeamId;
  }

  // Invariant (7): audit log.
  await writeAudit(userId, `auth.${provider}.login`, {
    provider,
    providerUserId: profile.id,
    authMethod: params.authMethod,
    isNewUser,
  });

  // Invariant (8): persist session.
  await new Promise<void>((resolve, reject) => req.session.save((err) => (err ? reject(err) : resolve())));

  // Invariant (9): clear logout guard cookie. Logic stays inline in routes.ts callers (cookie name lives there).

  return { userId };
}
```

- [ ] **Step 4: Behaviour parity test**

Before deleting the inline function, write `backend/src/__tests__/unit/oauth-login-parity.test.ts` that exercises the NEW helper for each of the 5 existing Telegram entry-points (WEBAPP/OIDC/LEGACY_WIDGET/DEV/BOT_HANDOFF) and asserts:
- new-user insert sets `onboarding_completed_at` correctly per method
- `session.entryRole` matches `entryRoleOverride` if passed
- `session.activeTeamId` set correctly for 1-membership users
- audit row written
- `users.account_role` set for non-allowlist users

Run, expect GREEN (helper already implements parity). If RED, fix helper before continuing.

- [ ] **Step 5: Update `routes.ts` to import + call new helper**

Keep `LOGOUT_GUARD_COOKIE_NAME` + `logoutGuardCookieOptions` inline in routes.ts (each call site still calls `res.clearCookie(...)` after `completeOAuthLogin` returns).

At top of `routes.ts`:
```typescript
import { completeOAuthLogin } from "../../lib/oauth-login.js";
```

Replace each call site with translated payload shape `{id, first_name, last_name, username, photo_url}` → `{id, firstName, lastName, username, avatarUrl}`:
- Line 730 (OIDC callback): `await completeOAuthLogin(req, res, { provider: "telegram", profile: {...}, authMethod: "OIDC" });`
- Line 972 (Telegram callback — handoff or widget per code): preserve current `authMethod` (likely `"BOT_HANDOFF"`).
- Line 1172 (legacy widget): `authMethod: "LEGACY_WIDGET"`.
- Line 1248 (webapp): `authMethod: "WEBAPP"`.
- Line 1280, 1332 (dev login): `authMethod: "DEV"`. Pass `entryRoleOverride` from the dev-login request body — verify the current code reads it as `options.entryRoleOverride` and pass it through.

After each call, keep the existing `res.clearCookie(LOGOUT_GUARD_COOKIE_NAME, logoutGuardCookieOptions())` line.

- [ ] **Step 6: Delete inline function definition** from routes.ts (lines 216-340).

- [ ] **Step 7: Run typecheck + tests**

```bash
cd backend && npm run check && DB_HOST=127.0.0.1 BACKEND_ENV_FILE=/Users/pk/Documents/CalDEV/.env npm run test:unit
```
Expected: all green including the new oauth-login-parity test. Existing telegram-bot / oidc / dev-login tests still pass because all 9 invariants preserved.

- [ ] **Step 8: Commit**

```bash
git add backend/src/lib/oauth-login.ts backend/src/modules/auth/routes.ts backend/src/__tests__/unit/oauth-login-parity.test.ts
git commit -m "refactor(auth): extract completeOAuthLogin (parity-tested) into reusable module"
```

### Task 7: ADMIN allowlist via telegram identity (defensive)

**Files:**
- Modify: `backend/src/lib/entry-role.ts` (or wherever `canChooseAdminRole` is)
- Or `backend/src/modules/admin/routes.ts` if admin checks live there

- [ ] **Step 1: Identify ADMIN check sites**

```bash
grep -rn "canChooseAdminRole\|account_role.*ADMIN" backend/src/ | head -10
```

- [ ] **Step 2: Verify check still uses telegram_id and not a generic identity match**

`canChooseAdminRole` already takes `{telegram_id, username}` — that's fine because completeOAuthLogin only passes telegram profile to it for `provider='telegram'`. No code change needed in this task IF that's confirmed. Otherwise, add an explicit guard: ADMIN can only be granted when the session was established via `req.session.authMethod` ∈ {WEBAPP, OIDC, BOT_HANDOFF, DEV}, never `YANDEX_OAUTH`.

- [ ] **Step 3: If guard needed**, add to `backend/src/middleware/auth.ts` or admin route:

```typescript
const TRUSTED_ADMIN_AUTH_METHODS = new Set(["WEBAPP", "OIDC", "LEGACY_WIDGET", "BOT_HANDOFF", "DEV"]);
// Inside admin handler, before granting ADMIN:
if (!TRUSTED_ADMIN_AUTH_METHODS.has(req.session.authMethod || "")) {
  return sendError(req, res, 403, "FORBIDDEN", "ADMIN role requires Telegram-based auth");
}
```

- [ ] **Step 4: Test + commit**

---

## Phase 2: Yandex login flow

### Task 8: Yandex routes (`/start`, `/callback`) — login mode

**Files:**
- Create: `backend/src/modules/auth/yandex-routes.ts`
- Create: `backend/src/__tests__/unit/yandex-routes.test.ts`
- Modify: `backend/src/app.ts` (mount route BEFORE `/auth`)

- [ ] **Step 1: Write failing integration test**

```typescript
// backend/src/__tests__/unit/yandex-routes.test.ts
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

process.env.AUTH_YANDEX_ENABLED = "1";
process.env.YANDEX_OAUTH_CLIENT_ID = "yandex-cid";
process.env.YANDEX_OAUTH_CLIENT_SECRET = "yandex-secret";
process.env.YANDEX_OAUTH_REDIRECT_URI = "https://pbthub.ru/api/v1/auth/yandex/callback";
process.env.YANDEX_OAUTH_LINK_REDIRECT_URI = "https://pbthub.ru/api/v1/auth/yandex/link/callback";
process.env.TELEGRAM_BOT_TOKEN = "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = "dummy_bot";
process.env.TELEGRAM_CALLBACK_URL = "http://127.0.0.1:8000/api/v1/auth/telegram/callback";

let app: typeof import("../../app.js").app;
let pool: typeof import("../../db/pool.js").pool;

beforeAll(async () => {
  ({ app } = await import("../../app.js"));
  ({ pool } = await import("../../db/pool.js"));
});

afterEach(() => vi.restoreAllMocks());

describe("yandex routes", () => {
  it("GET /start redirects to authorize URL with state cookie", async () => {
    const res = await request(app).get("/api/v1/auth/yandex/start?redirectTo=/app");
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("https://oauth.yandex.ru/authorize");
    expect(res.headers.location).toMatch(/state=[A-Za-z0-9_-]+/);
  });

  it("GET /callback without state returns 400", async () => {
    const res = await request(app).get("/api/v1/auth/yandex/callback?code=x");
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("GET /callback with invalid state redirects to /login with OAUTH_STATE_INVALID", async () => {
    const res = await request(app).get("/api/v1/auth/yandex/callback?code=x&state=nonexistent");
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("auth_error=OAUTH_STATE_INVALID");
  });

  it("GET /callback with valid state but no existing identity redirects to /login with NO_ACCOUNT", async () => {
    // Pre-seed state
    const stateMod = await import("../../lib/oauth-state.js");
    const { state } = await stateMod.createState({
      provider: "yandex", intent: "login", redirectTo: "/app",
      ttlSeconds: 60, ipHash: null, uaHash: null, linkUserId: null, codeVerifier: null, nonce: null,
    });
    // Stub Yandex token+userinfo fetches
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "AT", token_type: "bearer", expires_in: 3600 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "yandex_user_99999", login: "test", default_email: "t@y.ru" }) });
    vi.stubGlobal("fetch", fetchMock);
    const res = await request(app).get(`/api/v1/auth/yandex/callback?code=auth-code&state=${state}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("auth_error=OAUTH_NO_ACCOUNT");
  });
});
```

- [ ] **Step 2: Verify FAIL** (route doesn't exist).

- [ ] **Step 3: Implement `yandex-routes.ts`**

```typescript
import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { env } from "../../config/env.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { sendError } from "../../lib/http-error.js";
import { logger } from "../../lib/logger.js";
import { recordAuthMetric } from "../../lib/auth-slo.js";
import { createState, consumeState } from "../../lib/oauth-state.js";
import { buildYandexAuthorizeUrl, exchangeYandexCode, fetchYandexUserInfo } from "../../lib/yandex-oauth.js";
import { completeOAuthLogin } from "../../lib/oauth-login.js";

const yandexRouter = Router();

const startQuerySchema = z.object({ redirectTo: z.string().min(1).max(256).optional() });
const callbackQuerySchema = z.object({ code: z.string().min(1), state: z.string().min(1) });

function hashRequestPart(value: string | undefined): string | null {
  if (!value) return null;
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function requireEnabled(req: any, res: any): boolean {
  if (!env.yandexOAuth.enabled) {
    sendError(req, res, 404, "OAUTH_PROVIDER_DISABLED", "Yandex OAuth disabled");
    return false;
  }
  return true;
}

yandexRouter.get(
  "/start",
  asyncHandler(async (req, res) => {
    if (!requireEnabled(req, res)) return;
    const parsed = startQuerySchema.safeParse(req.query);
    const redirectTo = parsed.success && parsed.data.redirectTo ? parsed.data.redirectTo : "/app";
    const { state } = await createState({
      provider: "yandex",
      intent: "login",
      redirectTo,
      ttlSeconds: env.yandexOAuth.stateTtlSeconds,
      ipHash: hashRequestPart(String(req.ip || "")),
      uaHash: hashRequestPart(String(req.get("user-agent") || "")),
      linkUserId: null,
      codeVerifier: null,
      nonce: null,
    });
    recordAuthMetric({ method: "YANDEX_OAUTH", platform: "unknown", outcome: "ATTEMPT" });
    res.redirect(302, buildYandexAuthorizeUrl({ state, redirectUri: env.yandexOAuth.redirectUri }));
  })
);

yandexRouter.get(
  "/callback",
  asyncHandler(async (req, res) => {
    if (!requireEnabled(req, res)) return;
    const parsed = callbackQuerySchema.safeParse(req.query);
    if (!parsed.success) return sendError(req, res, 400, "VALIDATION_ERROR", "code and state required");
    const stateRow = await consumeState(parsed.data.state, "yandex");
    if (!stateRow || stateRow.intent !== "login") {
      recordAuthMetric({ method: "YANDEX_OAUTH", platform: "unknown", outcome: "ERROR", code: "STATE_INVALID" });
      return res.redirect(302, `/login?auth_error=OAUTH_STATE_INVALID`);
    }
    try {
      const token = await exchangeYandexCode({ code: parsed.data.code, redirectUri: env.yandexOAuth.redirectUri });
      const info = await fetchYandexUserInfo(token.access_token);
      const result = await completeOAuthLogin(req, res, {
        provider: "yandex",
        profile: {
          id: info.id,
          email: info.email,
          firstName: info.firstName,
          lastName: info.lastName,
          username: info.login,
          avatarUrl: info.avatarUrl,
        },
        authMethod: "YANDEX_OAUTH",
      });
      if (!result) {
        recordAuthMetric({ method: "YANDEX_OAUTH", platform: "unknown", outcome: "ERROR", code: "NO_ACCOUNT" });
        return res.redirect(302, `/login?auth_error=OAUTH_NO_ACCOUNT`);
      }
      recordAuthMetric({ method: "YANDEX_OAUTH", platform: "unknown", outcome: "SUCCESS" });
      return res.redirect(302, stateRow.redirectTo);
    } catch (err) {
      logger.warn("[yandex] callback failed", { err: err instanceof Error ? err.message : String(err) });
      recordAuthMetric({ method: "YANDEX_OAUTH", platform: "unknown", outcome: "ERROR", code: "CALLBACK_EXCEPTION" });
      return res.redirect(302, `/login?auth_error=OAUTH_STATE_INVALID`);
    }
  })
);

export { yandexRouter };
```

- [ ] **Step 4: (done in Task 2 Step 4b)** `AuthMetricMethod` union already includes `"YANDEX_OAUTH"`.

- [ ] **Step 5: Mount in `app.ts` BEFORE `/auth`**

```typescript
import { yandexRouter } from "./modules/auth/yandex-routes.js";
// inside mountApiV1:
router.use("/auth/yandex", authRateLimiter, yandexRouter);
// Note: /auth/yandex must be registered before /auth router.use call.
```

Also extend skip list (`req.path === "/callback"` shouldn't be limited because Yandex sends it once):
```typescript
req.path === "/start" || req.path === "/callback"
```
Wait — these paths conflict with telegram routes. Better: add `req.path === "/yandex/start" || req.path === "/yandex/callback"` to the global authRateLimiter skip when limiter is shared. Verify by reading current skip list — if mount is `/auth/yandex`, `req.path` for limiter at that mount is just `/start` and `/callback`. Pick exclusions surgically.

- [ ] **Step 6: Verify tests pass + typecheck**

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/auth/yandex-routes.ts backend/src/__tests__/unit/yandex-routes.test.ts backend/src/app.ts backend/src/lib/auth-slo.ts
git commit -m "feat(auth): yandex login /start and /callback endpoints"
```

### Task 9: Frontend Yandex login button

**Files:**
- Modify: `pbth/views/LoginView.tsx`
- Modify: `pbth/lib/auth-ux.ts` (add OAUTH_NO_ACCOUNT message)
- Modify: `pbth/vite.config.ts` (pass `VITE_AUTH_YANDEX_ENABLED`)
- Modify: `pbth/index.html` (no change, env propagation handled by Vite)

- [ ] **Step 1: Add OAUTH_NO_ACCOUNT to auth-ux**

In `pbth/lib/auth-ux.ts`, extend `AUTH_ERROR_MESSAGES`:
```typescript
OAUTH_NO_ACCOUNT: {
  user: "Чтобы войти через Яндекс, сначала создайте аккаунт через Telegram-бота, потом привяжите Яндекс в Профиле.",
},
OAUTH_STATE_INVALID: {
  user: "Сессия входа истекла. Попробуйте ещё раз.",
},
```

- [ ] **Step 2: Add Yandex button to LoginView**

Above the existing handoff button:
```tsx
{import.meta.env.VITE_AUTH_YANDEX_ENABLED === '1' && (
  <button
    onClick={() => { window.location.assign('/api/v1/auth/yandex/start?redirectTo=/app'); }}
    disabled={isLoading || handoffPolling}
    className="w-full bg-[#FFCC00] hover:bg-[#FFB800] text-black font-bold py-4 rounded-xl flex items-center justify-center space-x-3 transition-all active:scale-95 shadow-lg shadow-[#FFCC00]/30 mb-3"
  >
    <span>Войти через Яндекс</span>
  </button>
)}
```

- [ ] **Step 3: Typecheck**

```bash
cd pbth && npm run typecheck && npm run test:unit
```

- [ ] **Step 4: Commit**

```bash
git add pbth/views/LoginView.tsx pbth/lib/auth-ux.ts
git commit -m "feat(pbth): Yandex login button on LoginView (behind VITE_AUTH_YANDEX_ENABLED)"
```

### Task 10: Integration test — full Yandex login flow

**Files:**
- Create: `backend/src/__tests__/integration/yandex-flow.test.ts`

End-to-end with seeded identity row + stubbed Yandex fetches. Verify:
- pre-seed user + telegram identity
- direct insert yandex identity for that user
- start → callback → session established → `/auth/me` authenticated=true
- second login attempt with different yandex id → NO_ACCOUNT (no auto-create)

- [ ] **Step 1: Write the test** (similar shape to existing `handoff-flow.test.ts` integration).

- [ ] **Step 2: Run + verify GREEN**

- [ ] **Step 3: Commit**

```bash
git add backend/src/__tests__/integration/yandex-flow.test.ts
git commit -m "test(auth): integration coverage for Yandex login flow"
```

---

## Phase 3: Link flow + Profile

### Task 11: Yandex link endpoints

**Files:**
- Modify: `backend/src/modules/auth/yandex-routes.ts` (add `/link/start`, `/link/callback`, `/link/confirm`, `/unlink`)
- Modify: `backend/src/middleware/auth.ts` (export `requireSession` helper if not yet)
- Create: `backend/src/lib/pending-link.ts` (CRUD on auth_oauth_pending_link)

- [ ] **Step 1: Write failing tests** for all 4 routes.

- [ ] **Step 2: Implement `pending-link.ts`** helpers (create/consume).

- [ ] **Step 3: Implement routes:**
  - `/link/start` (requireSession): create state with `intent: 'link'`, `linkUserId: session.userId`, redirect to authorize URL with `linkRedirectUri`.
  - `/link/callback`: consume state with `intent='link'`, validate `linkUserId` matches `session.userId`, exchange code, fetch user info, create pending_link row, redirect to `/auth/yandex/link/confirm?token=<token>`.
  - `/link/confirm` (POST, requireSession, body `{token}`): consume pending_link, verify `user_id === session.userId`, check that this `provider_user_id` is not already linked to another user (else `OAUTH_LINK_TAKEN`), call `linkIdentity`, write `identity.link` audit, return `{ok:true}`.
  - `/unlink` (POST, requireSession, body `{provider}`): reject if last identity (use `countIdentitiesForUser`); reject if `provider === 'telegram'` and user has ADMIN role (defensive); call `unlinkIdentity`, write `identity.unlink` audit.

- [ ] **Step 4-6: Verify, commit**

```bash
git add backend/src/modules/auth/yandex-routes.ts backend/src/lib/pending-link.ts backend/src/__tests__/unit/yandex-routes.test.ts
git commit -m "feat(auth): yandex link/unlink endpoints + pending-link store"
```

### Task 12: Identities listing endpoint

**Files:**
- Create: `backend/src/modules/auth/identities-routes.ts`
- Modify: `backend/src/app.ts`

- [ ] **Step 1: Test:** GET `/api/v1/auth/identities` returns `[{provider, emailMasked, linkedAt}]` for current session; 401 if anonymous.

- [ ] **Step 2: Implement** with `listIdentitiesForUser` + email mask helper.

- [ ] **Step 3: Mount** under `/api/v1/auth/identities` (also BEFORE `/auth` general).

- [ ] **Step 4: Commit**

### Task 13: Frontend link flow + Profile UI

**Files:**
- Create: `pbth/lib/yandex-auth.ts`
- Create: `pbth/views/YandexLinkConfirmView.tsx`
- Create: `pbth/components/ProfileIdentities.tsx`
- Modify: `pbth/App.tsx` (route for `/auth/yandex/link/confirm`)
- Modify: profile-view file (find by grep — likely `pbth/views/ProfileView.tsx` or part of `AppLayout.tsx`).
- Create: `pbth/__tests__/unit/yandex-auth.test.ts`

- [ ] **Step 1: Tests** for client functions: `listIdentities`, `completeYandexLink`, `unlinkProvider`. Mock fetch.

- [ ] **Step 2: Implement `lib/yandex-auth.ts`:**

```typescript
export interface Identity { provider: string; emailMasked: string | null; linkedAt: string; }

export async function listIdentities(): Promise<Identity[]> {
  const res = await fetch('/api/v1/auth/identities', { credentials: 'include' });
  if (!res.ok) throw new Error(`identities_failed:${res.status}`);
  return res.json();
}

export async function completeYandexLink(token: string): Promise<void> {
  const res = await fetch('/api/v1/auth/yandex/link/confirm', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw new Error(`yandex_link_confirm_failed:${res.status}`);
}

export async function unlinkProvider(provider: string): Promise<void> {
  const res = await fetch('/api/v1/auth/yandex/unlink', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider }),
  });
  if (!res.ok) throw new Error(`unlink_failed:${res.status}`);
}
```

- [ ] **Step 3: Implement `YandexLinkConfirmView.tsx`:** reads `?token=` from URL, shows masked email + provider name, asks "Привязать?", on confirm → `completeYandexLink(token)` → redirect to `/app/profile` with success toast.

- [ ] **Step 4: Implement `ProfileIdentities.tsx`:** calls `listIdentities` on mount, renders cards per provider with attach/unlink buttons.

- [ ] **Step 5: Mount** Route + Profile component.

- [ ] **Step 6: Typecheck + tests**

- [ ] **Step 7: Commit**

```bash
git add pbth/lib/yandex-auth.ts pbth/views/YandexLinkConfirmView.tsx pbth/components/ProfileIdentities.tsx pbth/App.tsx pbth/__tests__/unit/yandex-auth.test.ts pbth/views/ProfileView.tsx
git commit -m "feat(pbth): Yandex link flow + Profile identities section"
```

---

## Phase 4: Infra plumbing + rollout

### Task 14: Env config files + Dockerfile arg propagation

**Files:**
- Modify: `.env.example`, `docker-compose.yml`, `docker-compose.release.yml`
- Modify: `scripts/release/env.prod.example`, `scripts/release/env.staging.example`
- Modify: `pbth/Dockerfile`
- Modify: `backend/src/__tests__/unit/release-compose-env.test.ts` — guard the new env vars are propagated

- [ ] **Step 1: Add backend env to all 5 config files**

```
AUTH_YANDEX_ENABLED=0
YANDEX_OAUTH_CLIENT_ID=
YANDEX_OAUTH_CLIENT_SECRET=
YANDEX_OAUTH_REDIRECT_URI=
YANDEX_OAUTH_LINK_REDIRECT_URI=
```

In `docker-compose.release.yml` backend service env block AND `docker-compose.yml` dev service env block, prop them through:
```yaml
AUTH_YANDEX_ENABLED: ${AUTH_YANDEX_ENABLED:-0}
YANDEX_OAUTH_CLIENT_ID: ${YANDEX_OAUTH_CLIENT_ID:-}
YANDEX_OAUTH_CLIENT_SECRET: ${YANDEX_OAUTH_CLIENT_SECRET:-}
YANDEX_OAUTH_REDIRECT_URI: ${YANDEX_OAUTH_REDIRECT_URI:-}
YANDEX_OAUTH_LINK_REDIRECT_URI: ${YANDEX_OAUTH_LINK_REDIRECT_URI:-}
```

- [ ] **Step 2: Frontend build arg in `pbth/Dockerfile`**

Find the existing `ARG VITE_TELEGRAM_BOT_USERNAME` line. Above the `RUN npm run build` line, add:
```dockerfile
ARG VITE_AUTH_YANDEX_ENABLED=0
ENV VITE_AUTH_YANDEX_ENABLED=$VITE_AUTH_YANDEX_ENABLED
```

In `docker-compose.release.yml` frontend service `build.args` block (line ~85), pass the arg:
```yaml
VITE_AUTH_YANDEX_ENABLED: ${VITE_AUTH_YANDEX_ENABLED:-0}
```
And in the frontend `environment` block also:
```yaml
VITE_AUTH_YANDEX_ENABLED: ${VITE_AUTH_YANDEX_ENABLED:-0}
```
(Vite's `VITE_` prefix exposes the var via `import.meta.env` at build time — no `vite.config.ts` change required.)

- [ ] **Step 3: Extend `release-compose-env.test.ts`**

Add an assertion that each of the 5 new backend env keys is referenced in `docker-compose.release.yml` and present in both `env.{prod,staging}.example`. Pattern matches existing telegram-bot relay assertions.

- [ ] **Step 4: Run tests + commit**

```bash
cd backend && DB_HOST=127.0.0.1 BACKEND_ENV_FILE=/Users/pk/Documents/CalDEV/.env npm run test:unit -- release-compose-env.test.ts
git add .env.example docker-compose.yml docker-compose.release.yml scripts/release/env.prod.example scripts/release/env.staging.example pbth/Dockerfile backend/src/__tests__/unit/release-compose-env.test.ts
git commit -m "feat(infra): wire Yandex OAuth env through compose + dockerfile + release-env guard"
```

### Task 15: Staging deploy + smoke

- [ ] **Step 1:** Push branch, open PR, wait CI.
- [ ] **Step 2:** Merge, run `Release Artifact`.
- [ ] **Step 3:** Run `Deploy Staging`.
- [ ] **Step 4:** SSH `pbthub.ru`, edit `/opt/pbth/shared/env/staging.env`:
```
AUTH_YANDEX_ENABLED=1
YANDEX_OAUTH_CLIENT_ID=<from oauth.yandex.ru>
YANDEX_OAUTH_CLIENT_SECRET=<from oauth.yandex.ru>
YANDEX_OAUTH_REDIRECT_URI=https://staging.pbthub.ru/api/v1/auth/yandex/callback
YANDEX_OAUTH_LINK_REDIRECT_URI=https://staging.pbthub.ru/api/v1/auth/yandex/link/callback
```
plus `VITE_AUTH_YANDEX_ENABLED=1` on frontend.
- [ ] **Step 5:** Recreate staging containers with `--force-recreate`.
- [ ] **Step 6:** Manual smoke (Vasily): login flow (Yandex-only → NO_ACCOUNT), Telegram-first-then-Yandex link (Profile → "Привязать Яндекс" → pre-confirm → success).

### Task 16: Production deploy (feature flag OFF)

- [ ] **Step 1:** `Deploy Production` workflow with same `releaseId` as staging.
- [ ] **Step 2:** Approval gate (Vasily approves in chat).
- [ ] **Step 3:** Prod env stays at `AUTH_YANDEX_ENABLED=0` until staging smoke is clean for at least 24h.
- [ ] **Step 4:** Flip flag on prod via env edit + recreate.

### Task 17: Update docs/releases.md

After prod flip — append release entry + note rollback target.

---

## Out of scope (followups)

- Task X: Drop `users.telegram_id` (after 1-2 sprint, read-paths fully migrated to `user_identities`).
- Task Y: Cooldown 24-72h between unlink and re-link of same provider.
- Task Z: Email hash + last 4 chars (GDPR hardening).
- Task: VK OAuth — same pattern, new module `vk-oauth.ts`, new routes.

## Risks

| Risk | Mitigation |
|------|-----------|
| Refactor of `completeTelegramLogin` breaks existing Telegram auth | Behaviour parity test before+after; staging smoke before prod flip |
| Race between two link attempts of same Yandex account | UNIQUE(provider, provider_user_id) at DB; INSERT ... ON CONFLICT in linkIdentity |
| Yandex changes user info shape | Defensive parsing in `fetchYandexUserInfo`; only `id` is required |
| ADMIN escalation via Yandex | `account_role` only granted via telegram identity check (Task 7); session.authMethod gate at admin route |
| Pending-link token leak | TTL 5min, single-use, requireSession on confirm endpoint |
| Hosting cannot reach oauth.yandex.ru | Same `TELEGRAM_BOT_API_BASE_URL` pattern can be reused for Yandex if needed — env-driven URLs already in place (Task 5) |
