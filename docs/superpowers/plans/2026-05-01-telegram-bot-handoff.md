# Telegram Bot Handoff Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fragile Telegram OIDC + outgoing Bot API relay with webhook-driven bot handoff: browser → deep link → bot `/start` → Telegram pushes webhook → backend issues a session-bound single-use token → browser exchanges token for session.

**Architecture:** Three new backend endpoints (`/handoff/start|status|complete`) + one webhook handler under `/api/v1/vendor/telegram/webhook`, two new DB tables (`auth_handoff_attempts` with `pending → linked → consumed → expired` state machine, and `auth_handoff_tokens` single-use), frontend client with exponential-backoff polling that survives tab visibility changes. `/start` binds `attempt_id` to the browser session cookie so `/status` and `/complete` cannot be hijacked by anyone who only knows the public `attempt_id`. The existing `completeTelegramLogin` helper in `backend/src/modules/auth/routes.ts` is extracted to its own module (Phase 0.5) and reused by `/handoff/complete`. Outgoing Telegram messages reuse the existing `sendTelegramBotMessage` (relay-aware). OIDC stays as fallback during dual-run; relay env stays untouched (Codex restored it after his initial removal).

**Tech Stack:** Express 4, PostgreSQL, `pg` driver, Telegram Bot Webhook API, React 18, Vite, Vitest, Supertest.

---

## File Structure

### New backend files
| File | Responsibility |
|------|---------------|
| `backend/src/db/migrations/020_auth_telegram_handoff.sql` | Tables `auth_handoff_attempts` and `auth_handoff_tokens` with TTL indexes |
| `backend/src/lib/telegram-handoff.ts` | Pure helpers: `generateAttemptId`, `generateToken`, `verifyWebhookSecret`, `parseStartCommand` |
| `backend/src/lib/telegram-handoff-service.ts` | DB-touching service: `createAttempt`, `findAttemptById`, `linkTelegramToAttempt`, `redeemToken`, `cleanupExpired` |
| `backend/src/lib/telegram-login.ts` | Extracted `completeTelegramLogin` (refactored out of `auth/routes.ts` in Phase 0.5) |
| `backend/src/modules/auth/handoff-routes.ts` | `Router` with `/start`, `/status`, `/complete` |
| `backend/src/modules/vendor/telegram-webhook.ts` | `Router` with `POST /webhook` |
| `backend/src/__tests__/unit/env-handoff.test.ts` | Env config tests |
| `backend/src/__tests__/unit/telegram-handoff.test.ts` | Pure helper tests |
| `backend/src/__tests__/unit/telegram-handoff-service.test.ts` | Service tests with DB |
| `backend/src/__tests__/unit/handoff-routes.test.ts` | Route handler tests with mocked service |
| `backend/src/__tests__/unit/telegram-webhook.test.ts` | Webhook handler tests with mocked service + `sendTelegramBotMessage` |
| `backend/src/__tests__/integration/handoff-flow.test.ts` | End-to-end via Supertest: start → simulated webhook → status → complete + replay rejection |

### New frontend files
| File | Responsibility |
|------|---------------|
| `pbth/lib/handoff.ts` | `startHandoff`, `pollHandoffStatus`, `completeHandoff` |
| `pbth/views/HandoffReturnView.tsx` | Page at `/auth/handoff/return?token=...` — completes handoff and redirects |
| `pbth/__tests__/unit/handoff.test.ts` | Frontend client tests |

### Backend files to modify
| File | Change |
|------|--------|
| `backend/src/config/env.ts` | Add `telegram.webhookSecret`, `telegramHandoff` block, invariant guard |
| `backend/src/lib/http-error.ts` | Extend `ApiErrorCode` with `HANDOFF_DISABLED`, `HANDOFF_ATTEMPT_NOT_FOUND`, `HANDOFF_TOKEN_INVALID`, `HANDOFF_RATE_LIMITED` |
| `backend/src/modules/auth/routes.ts` | Replace inline `completeTelegramLogin` (lines 196-283) with import from new `telegram-login.ts` |
| `backend/src/app.ts` | Mount `handoffRouter` BEFORE `authRouter` (Express matches `app.use` in registration order); mount `telegramWebhookRouter` under `/vendor/telegram`; add `/handoff/status` to authRateLimiter `skip` list; add per-IP `webhookRateLimiter` |
| `backend/src/server.ts` | Wire periodic `cleanupExpired` (5-minute `setInterval`) on app boot |
| `backend/src/lib/session.ts` (or wherever session types live) | Add `handoffAttemptId?: string` to session typings |

### Frontend files to modify
| File | Change |
|------|--------|
| `pbth/views/LoginView.tsx` | Add primary "Войти через Telegram-бота" button — open window synchronously on click, then assign URL after `start` resolves; demote existing button to fallback |
| `pbth/App.tsx` | Add `<Route path="/auth/handoff/return" element={<HandoffReturnView />} />` |

### Files to commit (already on branch as uncommitted Codex work)
| File | What it does |
|------|--------------|
| `backend/src/lib/public-origin.ts` | Helper to canonicalize origin (used by other auth flows; we DON'T use it for webhook) |
| `backend/src/__tests__/unit/auth-public-origin.test.ts` | Tests for public-origin |
| `backend/src/__tests__/unit/telegram-oidc.test.ts` | Tests for OIDC Basic auth |
| `AGENTS.md` | Agent guidance for releases |
| `scripts/setup-telegram-webhook.sh` | Webhook registration helper |
| `backend/src/lib/telegram-oidc.ts` (modified) | Switched to Basic auth — committed as `fix:` (it's a bug fix, not a feature) |
| `.env.example`, `docker-compose.yml` (modified) | Added handoff env keys for dev |
| `docker-compose.release.yml`, `scripts/release/env.{prod,staging}.example` (modified) | Handoff env keys added; relay env preserved (Codex restored after initial removal) |

---

## Phase 0: Stabilize Codex's uncommitted work

### Task 0.1: Verify Codex's restoration is complete

(Codex initially removed relay env and the guard test, then restored both. We verify and commit nothing in this task — it is a sanity gate before Task 0.2.)

**Files (read-only):**
- `docker-compose.release.yml`
- `scripts/release/env.prod.example`
- `scripts/release/env.staging.example`
- `backend/src/__tests__/unit/release-compose-env.test.ts`

- [ ] **Step 1: Verify relay env present in release configs**

```bash
grep -n "TELEGRAM_BOT_API_BASE_URL\|TELEGRAM_BOT_API_RELAY_TOKEN" \
  docker-compose.release.yml \
  scripts/release/env.prod.example \
  scripts/release/env.staging.example
```
Expected: at least one match per file for each variable (release.yml has them once in the backend service env block; the env.example files have them once each at top-level). Verify by reading the output, not by match count.

- [ ] **Step 2: Verify guard test exists**

```bash
test -f backend/src/__tests__/unit/release-compose-env.test.ts && echo OK
```
Expected: `OK`.

- [ ] **Step 3: Run guard test**

```bash
cd backend && npm run test:unit -- release-compose-env.test.ts
```
Expected: PASS.

- [ ] **Step 4: If any of the above fails — STOP and surface to Vasily before continuing.**

### Task 0.2a: Commit OIDC Basic auth fix

**Files:**
- Modified: `backend/src/lib/telegram-oidc.ts`
- New: `backend/src/__tests__/unit/telegram-oidc.test.ts`

This is a bugfix (the previous code sent `client_secret` in the form body, which Telegram OIDC rejects in some cases) — semver-correct prefix is `fix:`.

- [ ] **Step 1: Run the OIDC test**

```bash
cd backend && npm run test:unit -- telegram-oidc.test.ts
```
Expected: PASS.

- [ ] **Step 2: Stage and commit**

```bash
git add backend/src/lib/telegram-oidc.ts backend/src/__tests__/unit/telegram-oidc.test.ts
git commit -m "fix(auth): use Basic auth on Telegram OIDC token endpoint"
```

### Task 0.2b: Commit handoff scaffolding

**Files (new):**
- `backend/src/lib/public-origin.ts`
- `backend/src/__tests__/unit/auth-public-origin.test.ts`
- `AGENTS.md`
- `scripts/setup-telegram-webhook.sh`

**Files (modified — env additions only, no behavior):**
- `.env.example`
- `docker-compose.yml`
- `docker-compose.release.yml`
- `scripts/release/env.prod.example`
- `scripts/release/env.staging.example`

- [ ] **Step 1: Make webhook script executable**

```bash
chmod +x scripts/setup-telegram-webhook.sh
```

- [ ] **Step 2: Run all backend tests**

```bash
cd backend && npm run test:unit
```
Expected: All green (telegram-oidc, auth-public-origin, release-compose-env, etc.).

- [ ] **Step 3: Stage and commit**

```bash
git add backend/src/lib/public-origin.ts \
        backend/src/__tests__/unit/auth-public-origin.test.ts \
        AGENTS.md \
        scripts/setup-telegram-webhook.sh \
        .env.example \
        docker-compose.yml \
        docker-compose.release.yml \
        scripts/release/env.prod.example \
        scripts/release/env.staging.example
git commit -m "feat(auth): bootstrap Telegram bot handoff scaffolding"
```

---

## Phase 0.5: Refactor `completeTelegramLogin` into a reusable module

The handoff completion handler must reuse the same user-upsert + session-regen + audit logic that the existing Telegram callback uses (so handoff users aren't second-class — same role assignment, same audit trail, same logout-guard cookie cleanup). The function lives at `backend/src/modules/auth/routes.ts:196-283` as a private function. We extract it to its own module and re-import it where it was used.

### Task 0.5.1: Extract `completeTelegramLogin` to `backend/src/lib/telegram-login.ts`

**Files:**
- Create: `backend/src/lib/telegram-login.ts`
- Modify: `backend/src/modules/auth/routes.ts`

- [ ] **Step 1: Identify all current call sites**

```bash
grep -n "completeTelegramLogin(" backend/src/modules/auth/routes.ts
```
Expected: at least 3 call sites (Telegram WebApp, OIDC callback, Telegram widget callback). Note all line numbers.

- [ ] **Step 2: Create `backend/src/lib/telegram-login.ts`**

Move the function body (`auth/routes.ts:196-283`) verbatim. Keep the same signature. Move dependencies (helpers `canChooseAdminRole`, `getEffectiveEntryRole`, `getUserMemberships`, `writeAudit`, `LOGOUT_GUARD_COOKIE_NAME`, `logoutGuardCookieOptions`, `query`) as imports.

If `LOGOUT_GUARD_COOKIE_NAME` and `logoutGuardCookieOptions` are private to `auth/routes.ts`, also extract them — into a sibling file `backend/src/lib/logout-guard.ts` — and re-import in both files. Do this in the same task.

```typescript
// backend/src/lib/telegram-login.ts
import type { Request, Response } from "express";
import { query } from "../db/pool.js";
import { writeAudit } from "./audit.js";
import { canChooseAdminRole } from "./entry-role.js";
import { getUserMemberships } from "./permissions.js";
import { LOGOUT_GUARD_COOKIE_NAME, logoutGuardCookieOptions } from "./logout-guard.js";

export interface TelegramLoginPayload {
  id: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

export type TelegramAuthMethod = "WEBAPP" | "OIDC" | "LEGACY_WIDGET" | "DEV" | "HANDOFF";

export async function completeTelegramLogin(
  req: Request,
  res: Response,
  payload: TelegramLoginPayload,
  options?: { authMethod?: TelegramAuthMethod }
): Promise<{ userId: string }> {
  // ... body lifted verbatim from auth/routes.ts:208-282 ...
}
```

Note: add `"HANDOFF"` to `TelegramAuthMethod` so the audit log has a distinct value for the new path.

- [ ] **Step 3: Update `auth/routes.ts` to import**

Replace the inline function definition with:

```typescript
import { completeTelegramLogin } from "../../lib/telegram-login.js";
```

Remove the local definition at lines 196-283. Verify all call sites in the file still work (the signature and behavior are unchanged).

- [ ] **Step 4: Verify backend compiles and tests pass**

```bash
cd backend && npm run check && npm run test:unit
```
Expected: all green. Existing tests for `/auth/telegram/webapp`, `/auth/telegram/oidc/callback`, `/auth/telegram/callback` still pass (they exercise `completeTelegramLogin` indirectly).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/telegram-login.ts backend/src/lib/logout-guard.ts backend/src/modules/auth/routes.ts
git commit -m "refactor(auth): extract completeTelegramLogin into reusable module"
```

---

## Phase 1: Backend foundation

### Task 1: Wire handoff env into config

**Files:**
- Modify: `backend/src/config/env.ts`
- Create: `backend/src/__tests__/unit/env-handoff.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// backend/src/__tests__/unit/env-handoff.test.ts
import { beforeAll, describe, expect, it } from "vitest";

let env: typeof import("../../config/env.js").env;

beforeAll(async () => {
  process.env.TELEGRAM_BOT_TOKEN = "123:dummy";
  process.env.TELEGRAM_BOT_USERNAME = "dummy_bot";
  process.env.TELEGRAM_CALLBACK_URL = "http://127.0.0.1:8000/api/v1/auth/telegram/callback";
  process.env.TELEGRAM_WEBHOOK_SECRET = "webhook-secret-123";
  process.env.AUTH_TELEGRAM_HANDOFF_ENABLED = "1";
  process.env.AUTH_TELEGRAM_HANDOFF_ATTEMPT_TTL_SEC = "1800";
  process.env.AUTH_TELEGRAM_HANDOFF_TOKEN_TTL_SEC = "600";
  ({ env } = await import("../../config/env.js"));
});

describe("telegram handoff env", () => {
  it("exposes webhook secret", () => {
    expect(env.telegram.webhookSecret).toBe("webhook-secret-123");
  });

  it("exposes handoff config block", () => {
    expect(env.telegramHandoff.enabled).toBe(true);
    expect(env.telegramHandoff.attemptTtlSec).toBe(1800);
    expect(env.telegramHandoff.tokenTtlSec).toBe(600);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
cd backend && npm run test:unit -- env-handoff.test.ts
```
Expected: FAIL — `env.telegramHandoff` undefined.

- [ ] **Step 3: Update `backend/src/config/env.ts`**

In the `telegram` block, add:

```typescript
webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || "",
```

After the `telegramOidc` block, add:

```typescript
telegramHandoff: {
  enabled: asBoolean(process.env.AUTH_TELEGRAM_HANDOFF_ENABLED, false),
  attemptTtlSec: asNumber(process.env.AUTH_TELEGRAM_HANDOFF_ATTEMPT_TTL_SEC || "1800", "AUTH_TELEGRAM_HANDOFF_ATTEMPT_TTL_SEC"),
  tokenTtlSec: asNumber(process.env.AUTH_TELEGRAM_HANDOFF_TOKEN_TTL_SEC || "600", "AUTH_TELEGRAM_HANDOFF_TOKEN_TTL_SEC"),
},
```

At the bottom of the file, add the invariant guard:

```typescript
if (env.telegramHandoff.enabled && !env.telegram.webhookSecret) {
  throw new Error("TELEGRAM_WEBHOOK_SECRET is required when AUTH_TELEGRAM_HANDOFF_ENABLED=1");
}
```

- [ ] **Step 4: Run, verify PASS**

- [ ] **Step 5: Run full backend test suite**

```bash
cd backend && npm run test:unit
```
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add backend/src/config/env.ts backend/src/__tests__/unit/env-handoff.test.ts
git commit -m "feat(auth): expose Telegram handoff env in config"
```

### Task 2: Extend `ApiErrorCode` union

**Files:**
- Modify: `backend/src/lib/http-error.ts`

- [ ] **Step 1: Extend the union**

In `backend/src/lib/http-error.ts`, add four new codes:

```typescript
export type ApiErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INTERNAL_SERVER_ERROR"
  | "INVITE_NOT_FOUND"
  | "INVITE_EXPIRED"
  | "INVITE_REVOKED"
  | "ALREADY_MEMBER"
  | "ROLE_REQUIRED"
  | "EVENT_NOT_FOUND"
  | "HANDOFF_DISABLED"
  | "HANDOFF_ATTEMPT_NOT_FOUND"
  | "HANDOFF_TOKEN_INVALID"
  | "HANDOFF_RATE_LIMITED";
```

- [ ] **Step 2: Verify backend compiles**

```bash
cd backend && npm run check
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/lib/http-error.ts
git commit -m "feat(auth): add Telegram handoff error codes"
```

### Task 3: Migration for handoff tables

**Files:**
- Create: `backend/src/db/migrations/020_auth_telegram_handoff.sql`

- [ ] **Step 1: Confirm next migration number is 020**

```bash
ls backend/src/db/migrations/ | tail -5
```
Expected: last is `019_event_domain_external_owners.sql`.

- [ ] **Step 2: Write the migration**

```sql
-- backend/src/db/migrations/020_auth_telegram_handoff.sql
CREATE TABLE IF NOT EXISTS auth_handoff_attempts (
  attempt_id UUID PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',
  telegram_user_id BIGINT,
  telegram_username TEXT,
  telegram_first_name TEXT,
  telegram_last_name TEXT,
  telegram_photo_url TEXT,
  redirect_to TEXT NOT NULL DEFAULT '/app',
  ip_hash TEXT,
  ua_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  linked_at TIMESTAMPTZ,
  CONSTRAINT auth_handoff_attempts_status_check CHECK (status IN ('pending', 'linked', 'consumed', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_auth_handoff_attempts_expires_at
  ON auth_handoff_attempts (expires_at);

CREATE INDEX IF NOT EXISTS idx_auth_handoff_attempts_telegram_user
  ON auth_handoff_attempts (telegram_user_id)
  WHERE telegram_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS auth_handoff_tokens (
  token UUID PRIMARY KEY,
  attempt_id UUID NOT NULL REFERENCES auth_handoff_attempts(attempt_id) ON DELETE CASCADE,
  telegram_user_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_auth_handoff_tokens_expires_at
  ON auth_handoff_tokens (expires_at);

CREATE INDEX IF NOT EXISTS idx_auth_handoff_tokens_attempt
  ON auth_handoff_tokens (attempt_id);
```

(Note: we also store `telegram_photo_url` because `completeTelegramLogin` uses it for avatar.)

- [ ] **Step 3: Run migration on local DB**

```bash
cd backend && npm run db:migrate
```
Expected: `applied 020_auth_telegram_handoff.sql`.

- [ ] **Step 4: Verify**

```bash
docker exec -it $(docker ps -qf name=db) psql -U pbth -d pbth -c "\dt auth_handoff*"
```
Expected: two tables.

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/migrations/020_auth_telegram_handoff.sql
git commit -m "feat(db): add Telegram handoff attempts and tokens tables"
```

### Task 4: Pure helpers (no DB)

**Files:**
- Create: `backend/src/lib/telegram-handoff.ts`
- Create: `backend/src/__tests__/unit/telegram-handoff.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// backend/src/__tests__/unit/telegram-handoff.test.ts
import { describe, expect, it } from "vitest";
import {
  generateAttemptId,
  generateToken,
  parseStartCommand,
  verifyWebhookSecret,
} from "../../lib/telegram-handoff.js";

describe("telegram handoff helpers", () => {
  it("generates RFC4122 v4 UUIDs", () => {
    const id = generateAttemptId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const token = generateToken();
    expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(id).not.toBe(token);
  });

  it("parses /start with payload", () => {
    expect(parseStartCommand("/start abc-123")).toEqual({ kind: "start", payload: "abc-123" });
    expect(parseStartCommand("/start")).toEqual({ kind: "start", payload: null });
    expect(parseStartCommand("/start  trim-me  ")).toEqual({ kind: "start", payload: "trim-me" });
  });

  it("returns null for non-start commands", () => {
    expect(parseStartCommand("/help")).toBeNull();
    expect(parseStartCommand("hello")).toBeNull();
    expect(parseStartCommand("")).toBeNull();
  });

  it("verifies webhook secret with constant-time compare", () => {
    expect(verifyWebhookSecret("expected", "expected")).toBe(true);
    expect(verifyWebhookSecret("expected", "wrong")).toBe(false);
    expect(verifyWebhookSecret("expected", "")).toBe(false);
    expect(verifyWebhookSecret("", "")).toBe(false);
    expect(verifyWebhookSecret("expected", "expectedX")).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement**

```typescript
// backend/src/lib/telegram-handoff.ts
import crypto from "node:crypto";

export function generateAttemptId(): string {
  return crypto.randomUUID();
}

export function generateToken(): string {
  return crypto.randomUUID();
}

export type StartCommand = { kind: "start"; payload: string | null };

export function parseStartCommand(text: string): StartCommand | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith("/start")) return null;
  const rest = trimmed.slice("/start".length).trim();
  return { kind: "start", payload: rest.length > 0 ? rest : null };
}

export function verifyWebhookSecret(expected: string, received: string): boolean {
  if (!expected || !received) return false;
  if (expected.length !== received.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run, verify PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/telegram-handoff.ts backend/src/__tests__/unit/telegram-handoff.test.ts
git commit -m "feat(auth): add Telegram handoff pure helpers"
```

### Task 5: DB service layer (with unit tests)

**Files:**
- Create: `backend/src/lib/telegram-handoff-service.ts`
- Create: `backend/src/__tests__/unit/telegram-handoff-service.test.ts`

We test the service against a real local DB (the integration suite already does this — this test is in `unit/` because the service is a thin DB wrapper). If the local DB pattern is unavailable in unit tests, mark this as `describe.skipIf(!process.env.DATABASE_URL)` and rely on the integration test.

- [ ] **Step 1: Write failing tests**

```typescript
// backend/src/__tests__/unit/telegram-handoff-service.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../db/pool.js";

let svc: typeof import("../../lib/telegram-handoff-service.js");

beforeAll(async () => {
  process.env.AUTH_TELEGRAM_HANDOFF_ENABLED = "1";
  process.env.AUTH_TELEGRAM_HANDOFF_ATTEMPT_TTL_SEC = "60";
  process.env.AUTH_TELEGRAM_HANDOFF_TOKEN_TTL_SEC = "60";
  process.env.TELEGRAM_BOT_TOKEN = "123:dummy";
  process.env.TELEGRAM_BOT_USERNAME = "dummy_bot";
  process.env.TELEGRAM_WEBHOOK_SECRET = "secret";
  svc = await import("../../lib/telegram-handoff-service.js");
});

afterAll(async () => {
  await pool.query("DELETE FROM auth_handoff_tokens WHERE telegram_user_id = 99001");
  await pool.query("DELETE FROM auth_handoff_attempts WHERE telegram_user_id = 99001 OR ip_hash = 'test-svc'");
});

describe("telegram handoff service", () => {
  it("createAttempt writes a pending row", async () => {
    const a = await svc.createAttempt({ redirectTo: "/app", ipHash: "test-svc", uaHash: "test-svc" });
    expect(a.status).toBe("pending");
    expect(a.attemptId).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("linkTelegramToAttempt fails on missing attempt", async () => {
    const result = await svc.linkTelegramToAttempt({
      attemptId: "00000000-0000-0000-0000-000000000000",
      profile: { id: 99001 },
    });
    expect(result).toBeNull();
  });

  it("linkTelegramToAttempt fails when already linked", async () => {
    const a = await svc.createAttempt({ redirectTo: "/app", ipHash: "test-svc", uaHash: "test-svc" });
    const first = await svc.linkTelegramToAttempt({ attemptId: a.attemptId, profile: { id: 99001 } });
    expect(first).not.toBeNull();
    const second = await svc.linkTelegramToAttempt({ attemptId: a.attemptId, profile: { id: 99001 } });
    expect(second).toBeNull();
  });

  it("redeemToken returns null on invalid/expired/used token", async () => {
    expect(await svc.redeemToken("00000000-0000-0000-0000-000000000000")).toBeNull();
    const a = await svc.createAttempt({ redirectTo: "/app", ipHash: "test-svc", uaHash: "test-svc" });
    const linked = await svc.linkTelegramToAttempt({ attemptId: a.attemptId, profile: { id: 99001 } });
    expect(linked).not.toBeNull();
    const ok = await svc.redeemToken(linked!.token.token);
    expect(ok?.telegramUserId).toBe(99001);
    const replay = await svc.redeemToken(linked!.token.token);
    expect(replay).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement service**

```typescript
// backend/src/lib/telegram-handoff-service.ts
import { pool } from "../db/pool.js";
import { env } from "../config/env.js";
import { generateAttemptId, generateToken } from "./telegram-handoff.js";

export type AttemptStatus = "pending" | "linked" | "consumed" | "expired";

export interface AttemptRow {
  attemptId: string;
  status: AttemptStatus;
  telegramUserId: number | null;
  telegramUsername: string | null;
  telegramFirstName: string | null;
  telegramLastName: string | null;
  telegramPhotoUrl: string | null;
  redirectTo: string;
  expiresAt: Date;
  linkedAt: Date | null;
}

export interface TokenRow {
  token: string;
  attemptId: string;
  telegramUserId: number;
  expiresAt: Date;
  usedAt: Date | null;
}

export interface TelegramProfile {
  id: number;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  photoUrl?: string | null;
}

function mapAttempt(row: any): AttemptRow {
  return {
    attemptId: row.attempt_id,
    status: row.status,
    telegramUserId: row.telegram_user_id != null ? Number(row.telegram_user_id) : null,
    telegramUsername: row.telegram_username,
    telegramFirstName: row.telegram_first_name,
    telegramLastName: row.telegram_last_name,
    telegramPhotoUrl: row.telegram_photo_url,
    redirectTo: row.redirect_to,
    expiresAt: row.expires_at,
    linkedAt: row.linked_at,
  };
}

export async function createAttempt(input: { redirectTo: string; ipHash: string | null; uaHash: string | null }): Promise<AttemptRow> {
  const attemptId = generateAttemptId();
  const expiresAt = new Date(Date.now() + env.telegramHandoff.attemptTtlSec * 1000);
  const { rows } = await pool.query(
    `INSERT INTO auth_handoff_attempts (attempt_id, redirect_to, ip_hash, ua_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [attemptId, input.redirectTo, input.ipHash, input.uaHash, expiresAt]
  );
  return mapAttempt(rows[0]);
}

export async function findAttemptById(attemptId: string): Promise<AttemptRow | null> {
  const { rows } = await pool.query(`SELECT * FROM auth_handoff_attempts WHERE attempt_id = $1 LIMIT 1`, [attemptId]);
  return rows[0] ? mapAttempt(rows[0]) : null;
}

export async function linkTelegramToAttempt(input: {
  attemptId: string;
  profile: TelegramProfile;
}): Promise<{ attempt: AttemptRow; token: TokenRow } | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: attemptRows } = await client.query(
      `SELECT * FROM auth_handoff_attempts
       WHERE attempt_id = $1
         AND status = 'pending'
         AND expires_at > NOW()
       FOR UPDATE`,
      [input.attemptId]
    );
    if (!attemptRows[0]) {
      await client.query("ROLLBACK");
      return null;
    }
    const updateRes = await client.query(
      `UPDATE auth_handoff_attempts
       SET status = 'linked',
           telegram_user_id = $2,
           telegram_username = $3,
           telegram_first_name = $4,
           telegram_last_name = $5,
           telegram_photo_url = $6,
           linked_at = NOW()
       WHERE attempt_id = $1
       RETURNING *`,
      [
        input.attemptId,
        input.profile.id,
        input.profile.username ?? null,
        input.profile.firstName ?? null,
        input.profile.lastName ?? null,
        input.profile.photoUrl ?? null,
      ]
    );
    const attempt = mapAttempt(updateRes.rows[0]);
    const token = generateToken();
    const tokenExpires = new Date(Date.now() + env.telegramHandoff.tokenTtlSec * 1000);
    const { rows: tokenRows } = await client.query(
      `INSERT INTO auth_handoff_tokens (token, attempt_id, telegram_user_id, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [token, input.attemptId, input.profile.id, tokenExpires]
    );
    await client.query("COMMIT");
    return {
      attempt,
      token: {
        token: tokenRows[0].token,
        attemptId: tokenRows[0].attempt_id,
        telegramUserId: Number(tokenRows[0].telegram_user_id),
        expiresAt: tokenRows[0].expires_at,
        usedAt: tokenRows[0].used_at,
      },
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function redeemToken(token: string): Promise<{
  telegramUserId: number;
  redirectTo: string;
  attempt: AttemptRow;
} | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: tokenRows } = await client.query(
      `SELECT t.*, a.*
       FROM auth_handoff_tokens t
       JOIN auth_handoff_attempts a ON a.attempt_id = t.attempt_id
       WHERE t.token = $1
         AND t.used_at IS NULL
         AND t.expires_at > NOW()
       FOR UPDATE`,
      [token]
    );
    const row = tokenRows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query(`UPDATE auth_handoff_tokens SET used_at = NOW() WHERE token = $1`, [token]);
    await client.query(
      `UPDATE auth_handoff_attempts SET status = 'consumed' WHERE attempt_id = $1 AND status = 'linked'`,
      [row.attempt_id]
    );
    await client.query("COMMIT");
    return {
      telegramUserId: Number(row.telegram_user_id),
      redirectTo: row.redirect_to as string,
      attempt: mapAttempt(row),
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function cleanupExpired(): Promise<{ tokens: number; attempts: number }> {
  const t = await pool.query(`DELETE FROM auth_handoff_tokens WHERE expires_at < NOW() - INTERVAL '1 day'`);
  const a = await pool.query(`UPDATE auth_handoff_attempts SET status = 'expired' WHERE status = 'pending' AND expires_at < NOW()`);
  return { tokens: t.rowCount ?? 0, attempts: a.rowCount ?? 0 };
}
```

- [ ] **Step 4: Run tests, verify PASS**

```bash
cd backend && npm run test:unit -- telegram-handoff-service.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/telegram-handoff-service.ts backend/src/__tests__/unit/telegram-handoff-service.test.ts
git commit -m "feat(auth): add Telegram handoff DB service with tests"
```

---

## Phase 2: Backend endpoints

### Task 6: Handoff routes (`/start`, `/status`, `/complete`) — TDD

**Files:**
- Create: `backend/src/modules/auth/handoff-routes.ts`
- Create: `backend/src/__tests__/unit/handoff-routes.test.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/src/lib/session.ts` (add session field type)

Security model:
- `POST /start` writes `attemptId` to `req.session.handoffAttemptId` (cookie-bound).
- `GET /status?attempt_id=` returns `200 {status: "linked", token}` ONLY when `req.session.handoffAttemptId === attempt_id`. Otherwise returns `404 HANDOFF_ATTEMPT_NOT_FOUND` (do not leak existence).
- `POST /complete` accepts `{token}` and consumes it; the new session may differ from the one that started the attempt (Telegram return-link case lands in a different browser if user clicked the link from inside Telegram on a different device).

- [ ] **Step 1: Add session typing**

In `backend/src/lib/session.ts` (or wherever the session interface is declared — search with `grep -rn "interface SessionData" backend/src`), add `handoffAttemptId?: string`.

- [ ] **Step 2: Write failing test**

```typescript
// backend/src/__tests__/unit/handoff-routes.test.ts
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { pool } from "../../db/pool.js";

let app: typeof import("../../app.js").app;

beforeAll(async () => {
  process.env.AUTH_TELEGRAM_HANDOFF_ENABLED = "1";
  process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
  process.env.TELEGRAM_BOT_TOKEN = "123:dummy";
  process.env.TELEGRAM_BOT_USERNAME = "dummy_bot";
  process.env.TELEGRAM_CALLBACK_URL = "http://127.0.0.1:8000/api/v1/auth/telegram/callback";
  ({ app } = await import("../../app.js"));
});

afterEach(() => vi.restoreAllMocks());

describe("handoff routes", () => {
  it("POST /start returns attemptId, deepLink, and sets session cookie", async () => {
    const res = await request(app).post("/api/v1/auth/handoff/start").send({ redirectTo: "/app" });
    expect(res.status).toBe(200);
    expect(res.body.attemptId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.deepLink).toContain("t.me/dummy_bot?start=");
    const cookie = res.headers["set-cookie"];
    expect(Array.isArray(cookie) ? cookie.join(",") : cookie).toMatch(/pbth\.sid=|pbth\.stg\.sid=/);
  });

  it("GET /status without matching session returns 404", async () => {
    const startRes = await request(app).post("/api/v1/auth/handoff/start").send({});
    const otherAgent = request.agent(app); // fresh session
    const res = await otherAgent.get(`/api/v1/auth/handoff/status?attempt_id=${startRes.body.attemptId}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("HANDOFF_ATTEMPT_NOT_FOUND");
  });

  it("GET /status with matching session returns pending", async () => {
    const agent = request.agent(app);
    const startRes = await agent.post("/api/v1/auth/handoff/start").send({});
    const res = await agent.get(`/api/v1/auth/handoff/status?attempt_id=${startRes.body.attemptId}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending");
  });

  it("POST /complete with invalid token returns 401 HANDOFF_TOKEN_INVALID", async () => {
    const res = await request(app)
      .post("/api/v1/auth/handoff/complete")
      .send({ token: "00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("HANDOFF_TOKEN_INVALID");
  });

  it("returns 404 HANDOFF_DISABLED when feature flag off", async () => {
    process.env.AUTH_TELEGRAM_HANDOFF_ENABLED = "0";
    vi.resetModules();
    const { app: freshApp } = await import("../../app.js");
    const res = await request(freshApp).post("/api/v1/auth/handoff/start").send({});
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("HANDOFF_DISABLED");
    process.env.AUTH_TELEGRAM_HANDOFF_ENABLED = "1";
  });
});
```

- [ ] **Step 3: Run, verify FAIL**

- [ ] **Step 4: Extend `AuthMetricMethod` in `backend/src/lib/auth-slo.ts`**

The existing `recordAuthMetric` accepts `method: "OIDC" | "WEBAPP" | "LEGACY_WIDGET" | "DEV" | "UNKNOWN"`. Add `"HANDOFF"` to that union (file `backend/src/lib/auth-slo.ts:1`):

```typescript
export type AuthMetricMethod = "OIDC" | "WEBAPP" | "LEGACY_WIDGET" | "DEV" | "UNKNOWN" | "HANDOFF";
```

This is the only change to `auth-slo.ts`. Do it before the route file imports `recordAuthMetric`.

- [ ] **Step 5: Implement route**

```typescript
// backend/src/modules/auth/handoff-routes.ts
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { env } from "../../config/env.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { sendError } from "../../lib/http-error.js";
import { logger } from "../../lib/logger.js";
import { recordAuthMetric } from "../../lib/auth-slo.js";
import {
  createAttempt,
  findAttemptById,
  redeemToken,
} from "../../lib/telegram-handoff-service.js";
import { pool } from "../../db/pool.js";
import { completeTelegramLogin } from "../../lib/telegram-login.js";

const handoffRouter = Router();

function requireHandoffEnabled(req: Request, res: Response): boolean {
  if (!env.telegramHandoff.enabled) {
    sendError(req, res, 404, "HANDOFF_DISABLED", "Handoff is not enabled");
    return false;
  }
  return true;
}

function hashIp(req: Request): string | null {
  const ip = String(req.headers["x-forwarded-for"] || req.ip || "").split(",")[0]?.trim();
  if (!ip) return null;
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

function hashUa(req: Request): string | null {
  const ua = String(req.headers["user-agent"] || "");
  if (!ua) return null;
  return crypto.createHash("sha256").update(ua).digest("hex").slice(0, 32);
}

handoffRouter.post(
  "/start",
  asyncHandler(async (req, res) => {
    if (!requireHandoffEnabled(req, res)) return;
    const schema = z.object({ redirectTo: z.string().min(1).max(256).optional() });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
      return sendError(req, res, 400, "VALIDATION_ERROR", "Invalid body");
    }
    const redirectTo = parsed.data.redirectTo || "/app";
    const attempt = await createAttempt({
      redirectTo,
      ipHash: hashIp(req),
      uaHash: hashUa(req),
    });
    req.session.handoffAttemptId = attempt.attemptId;
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });
    const deepLink = `https://t.me/${env.telegram.botUsername}?start=${attempt.attemptId}`;
    recordAuthMetric({ method: "HANDOFF", platform: "unknown", outcome: "ATTEMPT" });
    res.json({
      attemptId: attempt.attemptId,
      deepLink,
      expiresAt: attempt.expiresAt.toISOString(),
    });
  })
);

handoffRouter.get(
  "/status",
  asyncHandler(async (req, res) => {
    if (!requireHandoffEnabled(req, res)) return;
    const attemptId = String(req.query.attempt_id || "").trim();
    if (!attemptId) {
      return sendError(req, res, 400, "VALIDATION_ERROR", "attempt_id required");
    }
    if (req.session.handoffAttemptId !== attemptId) {
      // Do not leak existence — return same 404 as missing.
      return sendError(req, res, 404, "HANDOFF_ATTEMPT_NOT_FOUND", "Attempt not found");
    }
    const attempt = await findAttemptById(attemptId);
    if (!attempt) {
      return sendError(req, res, 404, "HANDOFF_ATTEMPT_NOT_FOUND", "Attempt not found");
    }
    if (attempt.expiresAt.getTime() < Date.now() && attempt.status === "pending") {
      return res.json({ status: "expired" });
    }
    if (attempt.status === "linked") {
      const { rows } = await pool.query(
        `SELECT token FROM auth_handoff_tokens
         WHERE attempt_id = $1 AND used_at IS NULL AND expires_at > NOW()
         ORDER BY created_at DESC LIMIT 1`,
        [attemptId]
      );
      const token = rows[0]?.token as string | undefined;
      return res.json({ status: token ? "linked" : "expired", token });
    }
    return res.json({ status: attempt.status });
  })
);

handoffRouter.post(
  "/complete",
  asyncHandler(async (req, res) => {
    if (!requireHandoffEnabled(req, res)) return;
    const schema = z.object({ token: z.string().uuid() });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
      return sendError(req, res, 400, "VALIDATION_ERROR", "Invalid token");
    }
    const result = await redeemToken(parsed.data.token);
    if (!result) {
      recordAuthMetric({ method: "HANDOFF", platform: "unknown", outcome: "ERROR", code: "TOKEN_INVALID" });
      return sendError(req, res, 401, "HANDOFF_TOKEN_INVALID", "Token invalid or expired");
    }
    await completeTelegramLogin(req, res, {
      id: String(result.telegramUserId),
      username: result.attempt.telegramUsername ?? undefined,
      first_name: result.attempt.telegramFirstName ?? undefined,
      last_name: result.attempt.telegramLastName ?? undefined,
      photo_url: result.attempt.telegramPhotoUrl ?? undefined,
    }, { authMethod: "HANDOFF" });
    recordAuthMetric({ method: "HANDOFF", platform: "unknown", outcome: "SUCCESS" });
    res.json({ ok: true, redirectTo: result.redirectTo });
  })
);

export { handoffRouter };
```

- [ ] **Step 6: Mount in `app.ts` BEFORE `/auth`**

Open `backend/src/app.ts`. Inside `mountApiV1`, the current line `router.use("/auth", authRateLimiter, authRouter)` must be preceded by:

```typescript
router.use("/auth/handoff", authRateLimiter, handoffRouter);
```

Order matters: Express checks `app.use` mount paths in registration order; the FIRST one whose mount path is a prefix of the incoming URL wins. `/auth/handoff` is a stricter prefix than `/auth`, so it must register first.

Also extend the `authRateLimiter` `skip` list (around line 68-72) to include `/handoff/status`:

```typescript
skip: (req) =>
  req.path === "/me" ||
  req.path === "/telegram/webapp" ||
  req.path === "/telegram/oidc/start" ||
  req.path === "/telegram/oidc/callback" ||
  req.path === "/handoff/status",
```

- [ ] **Step 7: Run tests, verify PASS**

```bash
cd backend && npm run test:unit -- handoff-routes.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/auth/handoff-routes.ts \
        backend/src/__tests__/unit/handoff-routes.test.ts \
        backend/src/app.ts \
        backend/src/lib/session.ts \
        backend/src/lib/auth-slo.ts
git commit -m "feat(auth): add Telegram handoff start/status/complete endpoints"
```

### Task 7: Webhook handler — TDD

**Files:**
- Create: `backend/src/modules/vendor/telegram-webhook.ts`
- Create: `backend/src/__tests__/unit/telegram-webhook.test.ts`
- Modify: `backend/src/app.ts`

- [ ] **Step 1: Write failing test**

```typescript
// backend/src/__tests__/unit/telegram-webhook.test.ts
import { beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { pool } from "../../db/pool.js";

vi.mock("../../lib/telegram-bot.js", async (orig) => {
  const actual = (await orig()) as typeof import("../../lib/telegram-bot.js");
  return {
    ...actual,
    sendTelegramBotMessage: vi.fn().mockResolvedValue(undefined),
  };
});

let app: typeof import("../../app.js").app;
let createAttempt: typeof import("../../lib/telegram-handoff-service.js").createAttempt;

beforeAll(async () => {
  process.env.AUTH_TELEGRAM_HANDOFF_ENABLED = "1";
  process.env.TELEGRAM_WEBHOOK_SECRET = "wh-secret";
  process.env.TELEGRAM_BOT_TOKEN = "123:dummy";
  process.env.TELEGRAM_BOT_USERNAME = "dummy_bot";
  process.env.TELEGRAM_CALLBACK_URL = "http://127.0.0.1:8000/api/v1/auth/telegram/callback";
  ({ app } = await import("../../app.js"));
  ({ createAttempt } = await import("../../lib/telegram-handoff-service.js"));
});

describe("telegram webhook", () => {
  it("returns 200 with no work on missing/invalid secret", async () => {
    const res = await request(app)
      .post("/api/v1/vendor/telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", "wrong")
      .send({ update_id: 1, message: { text: "/start any", from: { id: 1 } } });
    expect(res.status).toBe(200);
  });

  it("links attempt when /start <attempt_id> arrives with valid secret", async () => {
    const a = await createAttempt({ redirectTo: "/app", ipHash: "wh-test", uaHash: "wh-test" });
    const res = await request(app)
      .post("/api/v1/vendor/telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", "wh-secret")
      .send({
        update_id: 2,
        message: {
          message_id: 1,
          text: `/start ${a.attemptId}`,
          from: { id: 99002, first_name: "Test", username: "t_user" },
          chat: { id: 99002, type: "private" },
          date: Math.floor(Date.now() / 1000),
        },
      });
    expect(res.status).toBe(200);
    const { rows } = await pool.query(`SELECT status FROM auth_handoff_attempts WHERE attempt_id = $1`, [a.attemptId]);
    expect(rows[0]?.status).toBe("linked");
  });

  it("ignores non-/start text without crashing", async () => {
    const res = await request(app)
      .post("/api/v1/vendor/telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", "wh-secret")
      .send({ update_id: 3, message: { text: "hello", from: { id: 1 }, chat: { id: 1 } } });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement**

```typescript
// backend/src/modules/vendor/telegram-webhook.ts
import { Router, type Request, type Response } from "express";
import { env } from "../../config/env.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { logger } from "../../lib/logger.js";
import { recordAuthMetric } from "../../lib/auth-slo.js";
import { parseStartCommand, verifyWebhookSecret } from "../../lib/telegram-handoff.js";
import { linkTelegramToAttempt } from "../../lib/telegram-handoff-service.js";
import { sendTelegramBotMessage } from "../../lib/telegram-bot.js";

const telegramWebhookRouter = Router();

telegramWebhookRouter.post(
  "/webhook",
  asyncHandler(async (req: Request, res: Response) => {
    const headerSecret = String(req.headers["x-telegram-bot-api-secret-token"] || "");
    if (!verifyWebhookSecret(env.telegram.webhookSecret, headerSecret)) {
      logger.warn("[telegram-webhook] invalid secret");
      // Always 200 — Telegram retries on 5xx and we want silent rejection.
      return res.status(200).json({ ok: true });
    }
    const update = req.body as any;
    const message = update?.message;
    const text: string | undefined = message?.text;
    const from = message?.from;
    if (!text || !from || typeof from.id !== "number") {
      return res.status(200).json({ ok: true });
    }
    const cmd = parseStartCommand(text);
    if (!cmd || cmd.kind !== "start" || !cmd.payload) {
      return res.status(200).json({ ok: true });
    }
    const result = await linkTelegramToAttempt({
      attemptId: cmd.payload,
      profile: {
        id: from.id,
        username: from.username || null,
        firstName: from.first_name || null,
        lastName: from.last_name || null,
        photoUrl: null,
      },
    });
    if (!result) {
      recordAuthMetric({ method: "HANDOFF", platform: "unknown", outcome: "ERROR", code: "ATTEMPT_INVALID" });
      await sendTelegramBotMessage(
        String(from.id),
        "Этот код входа уже использован или истёк. Откройте сайт и нажмите «Войти» ещё раз."
      ).catch((err) => logger.warn("[telegram-webhook] sendMessage failed", { err: String(err) }));
      return res.status(200).json({ ok: true });
    }
    const returnUrl = `${env.frontendUrl}/auth/handoff/return?token=${result.token.token}`;
    recordAuthMetric({ method: "HANDOFF", platform: "unknown", outcome: "SUCCESS" });
    await sendTelegramBotMessage(
      String(from.id),
      `Возвращайтесь в браузер: ${returnUrl}\n\nИли просто оставьте сайт открытым — он сам подхватит вход.`
    ).catch((err) => logger.warn("[telegram-webhook] sendMessage failed", { err: String(err) }));
    res.status(200).json({ ok: true });
  })
);

export { telegramWebhookRouter };
```

- [ ] **Step 4: Mount with per-IP rate limiter**

In `backend/src/app.ts`:

```typescript
import rateLimit from "express-rate-limit";
import { telegramWebhookRouter } from "./modules/vendor/telegram-webhook.js";

const webhookRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60, // up to 60 webhook deliveries/IP/min — Telegram retries are rare
  standardHeaders: true,
  legacyHeaders: false,
});

// Inside mountApiV1, after router.use("/vendor", vendorRouter):
router.use("/vendor/telegram", webhookRateLimiter, telegramWebhookRouter);
```

- [ ] **Step 5: Run tests**

```bash
cd backend && npm run test:unit -- telegram-webhook.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/vendor/telegram-webhook.ts \
        backend/src/__tests__/unit/telegram-webhook.test.ts \
        backend/src/app.ts
git commit -m "feat(auth): add Telegram webhook handler for handoff bot"
```

### Task 8: Wire periodic cleanup

**Files:**
- Modify: `backend/src/server.ts`

- [ ] **Step 1: Add `setInterval` on app boot**

In `backend/src/server.ts`, near the `app.listen` call, add:

```typescript
import { cleanupExpired } from "./lib/telegram-handoff-service.js";
import { logger } from "./lib/logger.js";

const HANDOFF_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const handoffCleanupTimer = setInterval(async () => {
  try {
    const result = await cleanupExpired();
    if (result.tokens > 0 || result.attempts > 0) {
      logger.info("[handoff] cleanup", result);
    }
  } catch (err) {
    logger.warn("[handoff] cleanup failed", { err: String(err) });
  }
}, HANDOFF_CLEANUP_INTERVAL_MS);
handoffCleanupTimer.unref();
```

- [ ] **Step 2: Verify backend compiles**

- [ ] **Step 3: Commit**

```bash
git add backend/src/server.ts
git commit -m "feat(auth): periodic cleanup of expired handoff records"
```

### Task 9: End-to-end integration test

**Files:**
- Create: `backend/src/__tests__/integration/handoff-flow.test.ts`

Same scenario as the route/webhook unit tests, but exercising the full chain through the real router stack.

- [ ] **Step 1: Write the test**

```typescript
// backend/src/__tests__/integration/handoff-flow.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { pool } from "../../db/pool.js";

vi.mock("../../lib/telegram-bot.js", async (orig) => {
  const actual = (await orig()) as typeof import("../../lib/telegram-bot.js");
  return {
    ...actual,
    sendTelegramBotMessage: vi.fn().mockResolvedValue(undefined),
  };
});

let app: typeof import("../../app.js").app;

beforeAll(async () => {
  process.env.AUTH_TELEGRAM_HANDOFF_ENABLED = "1";
  process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
  process.env.TELEGRAM_BOT_TOKEN = "123:dummy";
  process.env.TELEGRAM_BOT_USERNAME = "dummy_bot";
  process.env.TELEGRAM_CALLBACK_URL = "http://127.0.0.1:8000/api/v1/auth/telegram/callback";
  ({ app } = await import("../../app.js"));
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE telegram_id = '99999'");
  await pool.end();
});

describe("Telegram handoff flow", () => {
  it("end-to-end: start → webhook → status → complete → replay rejected", async () => {
    const agent = request.agent(app);
    const startRes = await agent.post("/api/v1/auth/handoff/start").send({ redirectTo: "/app" });
    expect(startRes.status).toBe(200);
    const { attemptId } = startRes.body;

    const webhookRes = await request(app)
      .post("/api/v1/vendor/telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", "test-secret")
      .send({
        update_id: 1,
        message: {
          message_id: 1,
          text: `/start ${attemptId}`,
          from: { id: 99999, first_name: "Test", username: "test_user" },
          chat: { id: 99999, type: "private" },
          date: Math.floor(Date.now() / 1000),
        },
      });
    expect(webhookRes.status).toBe(200);

    const statusRes = await agent.get(`/api/v1/auth/handoff/status?attempt_id=${attemptId}`);
    expect(statusRes.body.status).toBe("linked");
    expect(statusRes.body.token).toMatch(/^[0-9a-f-]{36}$/);

    const completeRes = await agent.post("/api/v1/auth/handoff/complete").send({ token: statusRes.body.token });
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.redirectTo).toBe("/app");

    const meRes = await agent.get("/api/v1/auth/me");
    expect(meRes.body.authenticated).toBe(true);

    const replay = await request(app).post("/api/v1/auth/handoff/complete").send({ token: statusRes.body.token });
    expect(replay.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run**

```bash
cd backend && npm run test:integration -- handoff-flow.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/__tests__/integration/handoff-flow.test.ts
git commit -m "test(auth): integration coverage for Telegram handoff flow"
```

---

## Phase 3: Frontend

### Task 10: Frontend handoff client (with backoff and visibility-aware polling)

**Files:**
- Create: `pbth/lib/handoff.ts`
- Create: `pbth/__tests__/unit/handoff.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// pbth/__tests__/unit/handoff.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("handoff client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("startHandoff", async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ attemptId: "abc", deepLink: "https://t.me/x?start=abc", expiresAt: "2030-01-01" }),
    });
    const { startHandoff } = await import("../../lib/handoff");
    const res = await startHandoff("/app");
    expect(res.attemptId).toBe("abc");
  });

  it("pollHandoffStatus returns linked + token", async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "linked", token: "tkn-1" }),
    });
    const { pollHandoffStatus } = await import("../../lib/handoff");
    const res = await pollHandoffStatus("abc");
    expect(res.token).toBe("tkn-1");
  });

  it("completeHandoff returns redirectTo", async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, redirectTo: "/app" }),
    });
    const { completeHandoff } = await import("../../lib/handoff");
    const res = await completeHandoff("tkn-1");
    expect(res.redirectTo).toBe("/app");
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement**

```typescript
// pbth/lib/handoff.ts
export interface StartResponse {
  attemptId: string;
  deepLink: string;
  expiresAt: string;
}

export interface StatusResponse {
  status: "pending" | "linked" | "consumed" | "expired";
  token?: string;
}

export async function startHandoff(redirectTo = "/app"): Promise<StartResponse> {
  const res = await fetch("/api/v1/auth/handoff/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ redirectTo }),
  });
  if (!res.ok) throw new Error(`handoff_start_failed:${res.status}`);
  return res.json();
}

export async function pollHandoffStatus(attemptId: string): Promise<StatusResponse> {
  const res = await fetch(`/api/v1/auth/handoff/status?attempt_id=${encodeURIComponent(attemptId)}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`handoff_status_failed:${res.status}`);
  return res.json();
}

export async function completeHandoff(token: string): Promise<{ ok: boolean; redirectTo: string }> {
  const res = await fetch("/api/v1/auth/handoff/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw new Error(`handoff_complete_failed:${res.status}`);
  return res.json();
}
```

- [ ] **Step 4: Run, verify PASS**

- [ ] **Step 5: Commit**

```bash
git add pbth/lib/handoff.ts pbth/__tests__/unit/handoff.test.ts
git commit -m "feat(pbth): add frontend Telegram handoff client"
```

### Task 11: LoginView primary handoff button (popup-blocker safe + backoff)

**Files:**
- Modify: `pbth/views/LoginView.tsx`

- [ ] **Step 1: Add state and refs**

```typescript
import { startHandoff, pollHandoffStatus, completeHandoff } from "../lib/handoff";

// Inside component:
const [handoffPolling, setHandoffPolling] = useState(false);
const handoffWindowRef = useRef<Window | null>(null);
const handoffTimerRef = useRef<number | null>(null);
const handoffStartedAtRef = useRef<number>(0);
```

- [ ] **Step 2: Implement popup-safe handler**

```typescript
const handleHandoffLogin = async () => {
  setIsLoading(true);
  setAuthError("");
  // Open the window SYNCHRONOUSLY in the click handler — iOS/Safari blocks
  // window.open() called from inside an async callback resolved later.
  handoffWindowRef.current = window.open("", "_blank", "noopener");
  try {
    const start = await startHandoff("/app");
    if (handoffWindowRef.current && !handoffWindowRef.current.closed) {
      handoffWindowRef.current.location.href = start.deepLink;
    } else {
      // Popup blocked — fall back to same-tab navigation
      window.location.assign(start.deepLink);
      return;
    }
    setHandoffPolling(true);
    handoffStartedAtRef.current = Date.now();
    schedulePoll(start.attemptId, 2000);
  } catch (err) {
    handoffWindowRef.current?.close();
    setAuthError("Не удалось начать вход. Попробуйте ещё раз.");
  } finally {
    setIsLoading(false);
  }
};

const schedulePoll = (attemptId: string, delayMs: number) => {
  handoffTimerRef.current = window.setTimeout(async () => {
    if (document.hidden) {
      // Pause polling while tab not visible — resume on visibilitychange.
      schedulePoll(attemptId, 2000);
      return;
    }
    try {
      const status = await pollHandoffStatus(attemptId);
      if (status.status === "linked" && status.token) {
        setHandoffPolling(false);
        await completeHandoff(status.token);
        await onLogin();
        return;
      }
      if (status.status === "expired" || status.status === "consumed") {
        setHandoffPolling(false);
        setAuthError("Сессия входа истекла. Попробуйте снова.");
        return;
      }
      // Pending — exponential backoff: 2s → 5s → 10s, cap 10s.
      const elapsed = Date.now() - handoffStartedAtRef.current;
      if (elapsed > 30 * 60 * 1000) {
        setHandoffPolling(false);
        setAuthError("Время вышло. Попробуйте снова.");
        return;
      }
      const next = delayMs < 10000 ? Math.min(delayMs + 3000, 10000) : 10000;
      schedulePoll(attemptId, next);
    } catch (err) {
      setHandoffPolling(false);
      setAuthError("Не удалось проверить статус входа. Попробуйте снова.");
    }
  }, delayMs);
};

// Cleanup outstanding timer on unmount
useEffect(() => {
  return () => {
    if (handoffTimerRef.current) window.clearTimeout(handoffTimerRef.current);
  };
}, []);
```

**Note on visibility:** the `if (document.hidden) ...` branch inside `schedulePoll` already pauses the actual `fetch`. When the tab becomes visible again, the next scheduled timer (max 10s away) will perform the real poll. We deliberately skip the `visibilitychange` listener — the up-to-10s lag is acceptable and avoids ref/state coupling complexity.

- [ ] **Step 3: Add primary button above existing Telegram button**

```tsx
<button
  onClick={handleHandoffLogin}
  disabled={isLoading || handoffPolling}
  className="w-full bg-[#24A1DE] hover:bg-[#208bbf] text-white font-bold py-4 rounded-xl flex items-center justify-center space-x-3 transition-all active:scale-95 shadow-lg shadow-[#24A1DE]/30 mb-3"
>
  {handoffPolling ? (
    <>
      <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
      <span>Ждём подтверждения в Telegram…</span>
    </>
  ) : (
    <>
      <Send size={24} />
      <span>Войти через Telegram-бота</span>
    </>
  )}
</button>
```

Demote the existing button label to "Старый вход через Telegram (резерв)".

- [ ] **Step 4: Typecheck**

```bash
cd pbth && npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add pbth/views/LoginView.tsx
git commit -m "feat(pbth): add Telegram bot handoff as primary login path"
```

### Task 12: Return-from-bot view

**Files:**
- Create: `pbth/views/HandoffReturnView.tsx`
- Modify: `pbth/App.tsx`

- [ ] **Step 1: Write view**

```tsx
// pbth/views/HandoffReturnView.tsx
import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { completeHandoff } from "../lib/handoff";

export const HandoffReturnView: React.FC = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = params.get("token");
    if (!token) {
      setError("Токен входа отсутствует.");
      return;
    }
    (async () => {
      try {
        const res = await completeHandoff(token);
        navigate(res.redirectTo || "/app", { replace: true });
      } catch {
        setError("Не удалось завершить вход. Откройте сайт и нажмите «Войти» ещё раз.");
      }
    })();
  }, [params, navigate]);

  return (
    <div className="min-h-screen bg-pb-background flex items-center justify-center text-white">
      <div className="text-center max-w-sm px-6">
        {error ? (
          <>
            <div className="text-2xl font-bold mb-3">Ошибка входа</div>
            <p className="text-pb-subtext text-sm">{error}</p>
            <button
              onClick={() => navigate("/login", { replace: true })}
              className="bg-pb-primary text-pb-background px-5 py-3 rounded-xl font-bold mt-4"
            >
              На страницу входа
            </button>
          </>
        ) : (
          <>
            <div className="w-12 h-12 border-2 border-white/30 border-t-pb-primary rounded-full animate-spin mx-auto mb-4"></div>
            <div className="text-lg font-semibold">Завершаем вход…</div>
          </>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Add route in `App.tsx`**

```tsx
<Route path="/auth/handoff/return" element={<HandoffReturnView />} />
```

- [ ] **Step 3: Typecheck and commit**

```bash
cd pbth && npm run typecheck
git add pbth/views/HandoffReturnView.tsx pbth/App.tsx
git commit -m "feat(pbth): add Telegram handoff return view"
```

---

## Phase 4: Verification

### Task 13: Local end-to-end smoke

(Manual — requires real bot + ngrok.)

- [ ] **Step 1: Tunnel local backend**

```bash
ngrok http 8000
```
Note the HTTPS URL.

- [ ] **Step 2: Register webhook**

```bash
TELEGRAM_BOT_TOKEN=<...> FRONTEND_URL=https://abc123.ngrok.io ./scripts/setup-telegram-webhook.sh
```
Save the printed `TELEGRAM_WEBHOOK_SECRET`.

- [ ] **Step 3: Start backend**

```bash
cd backend
TELEGRAM_WEBHOOK_SECRET=<secret> AUTH_TELEGRAM_HANDOFF_ENABLED=1 FRONTEND_URL=https://abc123.ngrok.io npm run dev
```

- [ ] **Step 4: Start frontend with proxy to ngrok**

```bash
cd pbth && npm run dev
```

- [ ] **Step 5: Run human flow**

1. Open http://127.0.0.1:3000/login.
2. Click "Войти через Telegram-бота" — new tab opens with bot.
3. Press Start in Telegram.
4. Bot replies with return URL.
5. Either click URL → land on `/auth/handoff/return?token=...` → redirect to `/app`,
   or stay on the original tab → polling completes → redirect.

Verify `GET /api/v1/auth/me` returns `authenticated: true`.

### Task 14: Staging deploy + verify

- [ ] **Step 0: Confirm PR strategy with Vasily — REQUIRED before push**

The local branch has 6 unrelated commits ahead of `origin/codex/telegram-bot-handoff-bootstrap` (App.tsx split, ErrorBoundary, structured logger, type fixes, PWA polish, PWA design doc). Confirm one path:

**Option A (recommended):** split — cherry-pick the 6 commits to a separate branch, push and merge that PR first, then rebase handoff branch on the new `main`:

```bash
git log origin/codex/telegram-bot-handoff-bootstrap..HEAD --oneline
# Note the 6 commit SHAs
git checkout -b feat/pwa-polish-and-tech-debt main
git cherry-pick <sha1> <sha2> <sha3> <sha4> <sha5> <sha6>
git push -u origin feat/pwa-polish-and-tech-debt
gh pr create --base main --title "feat: PWA polish + tech debt cleanup"
# After merge:
git checkout codex/telegram-bot-handoff-bootstrap
git rebase main
```

**Option B:** keep the commits on the handoff branch and ship in one PR. Update PR title/body to reflect both bodies of work.

Do not proceed to Step 1 until Vasily confirms.

- [ ] **Step 1: Push branch + open PR**

```bash
git push -u origin codex/telegram-bot-handoff-bootstrap
gh pr create --base main --title "feat(auth): Telegram bot handoff" \
  --body "Plan: docs/superpowers/plans/2026-05-01-telegram-bot-handoff.md"
```

- [ ] **Step 2: After PR merge, run release workflows**

GitHub Actions:
- `Release Artifact` — produces `releaseId`
- `Deploy Staging` with that `releaseId`

- [ ] **Step 3: On staging server, set webhook secret + register**

```bash
# On staging host:
edit /opt/pbth/shared/env/staging.env  # add TELEGRAM_WEBHOOK_SECRET=<unique-staging-secret>
# Restart backend container, then:
TELEGRAM_BOT_TOKEN=<staging-bot> FRONTEND_URL=https://staging.pbthub.ru \
  TELEGRAM_WEBHOOK_SECRET=<staging-secret> \
  ./scripts/setup-telegram-webhook.sh
```

(Using a separate staging bot is strongly recommended. Confirm with Vasily.)

- [ ] **Step 4: Smoke**

```bash
./scripts/smoke-check.sh https://staging.pbthub.ru
curl -s https://staging.pbthub.ru/api/v1/auth/handoff/start -X POST \
  -H "Content-Type: application/json" -c cookies.txt -d '{"redirectTo":"/app"}' | jq .
```
Expected: 200 with `attemptId` and `deepLink`.

- [ ] **Step 5: Human flow on staging**

Same as Task 13 Step 5 but on `staging.pbthub.ru`.

### Task 15: Production deploy (feature-flagged off, then flipped)

- [ ] **Step 1: Set prod env (handoff initially OFF)**

```
TELEGRAM_WEBHOOK_SECRET=<unique-prod-secret>
AUTH_TELEGRAM_HANDOFF_ENABLED=0
```

- [ ] **Step 2: Deploy production with the staging-matched releaseId**

GitHub Actions: `Deploy Production`.

- [ ] **Step 3: Smoke (handoff disabled)**

```bash
./scripts/smoke-check.sh https://pbthub.ru
curl -s https://pbthub.ru/api/v1/auth/handoff/start -X POST \
  -H "Content-Type: application/json" -d '{}' | jq .
```
Expected: existing endpoints unchanged. `/handoff/start` returns 404 `HANDOFF_DISABLED`.

- [ ] **Step 4: Register prod webhook + flip flag**

```bash
TELEGRAM_BOT_TOKEN=<...> FRONTEND_URL=https://pbthub.ru \
  TELEGRAM_WEBHOOK_SECRET=<prod-secret> \
  ./scripts/setup-telegram-webhook.sh
# Then in prod.env: AUTH_TELEGRAM_HANDOFF_ENABLED=1
# Restart backend container.
```

- [ ] **Step 5: Verify in prod with personal account**

Run flow on https://pbthub.ru. Confirm session established + `/auth/me` returns `authenticated: true`.

- [ ] **Step 6: Update `docs/releases.md`**

```
## v2026.05.0X-handoff
- Added Telegram bot handoff auth (primary path on login screen)
- OIDC kept as fallback (dual-run)
- Webhook on /api/v1/vendor/telegram/webhook
- Periodic cleanup of expired handoff records (5-min interval)
```

- [ ] **Step 7: Commit and push docs**

```bash
git add docs/releases.md
git commit -m "docs: release notes for Telegram handoff auth"
git push origin main
```

---

## Out of scope (handled later)

- Removing OIDC entirely — kept as fallback during dual-run, removed in a separate plan once handoff hits 95%+ adoption.
- Yandex OAuth as second provider — separate plan (Variant B), [pbth_spec_2026_03_21_auth_migration_pwa_push.md](../../02_PROJECTS/Paintball%20TeamHub/06_specs/).
- PWA shell + Web Push (replace Telegram notifications) — Variant C, separate plan.
- Logout invalidating pending handoff attempts — `/auth/logout` clears the session cookie, which un-binds `req.session.handoffAttemptId`; the attempt itself expires naturally within `attemptTtlSec`. Acceptable trade-off.
- Re-using the same browser session across handoff and OIDC — not needed; both paths produce the same `userId` in `users.telegram_id` so dual-flow users have one account.

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Webhook delivery delay (Telegram retries on 5xx) | Always return 200; do all heavy work synchronously but fast |
| Token leak via referrer when user clicks return link | Frontend route is same-origin; status response is session-bound (Task 6 Step 4) |
| Race: webhook arrives before frontend starts polling | Status is idempotent; polling will see `linked` on next tick |
| Existing notifications break if relay env removed | Codex restored relay env (verified Task 0.1); guard test prevents regression |
| Bot username mismatch in `t.me` link | `env.telegram.botUsername` is `required(...)` — fail-fast at boot |
| Express mount-order subtlety | Plan explicitly mounts `/auth/handoff` BEFORE `/auth` (Task 6 Step 5) |
| Mobile popup blocker on async window.open | Plan opens window synchronously inside click handler then assigns URL (Task 11 Step 2) |
| Status endpoint leaks tokens to anyone with attempt_id | Bound to session via `req.session.handoffAttemptId` (Task 6 Step 4) |
| Webhook brute-forcing the secret | Per-IP rate limiter (Task 7 Step 4) |
| `cleanupExpired` never runs → table bloat | `setInterval` in `server.ts` (Task 8) |
| `recordAuthMetric` doesn't know `HANDOFF` method | Task 6 Step 4 extends `AuthMetricMethod` union in `backend/src/lib/auth-slo.ts:1` |
