# Telegram Auth Simplification Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Telegram auth feel predictable and low-friction by keeping Mini App auto-auth inside Telegram and using OIDC as the single primary browser login flow.

**Architecture:** The frontend should make one browser-login choice: if valid Telegram Mini App `initData` exists, use WebApp auth; otherwise redirect to Telegram OIDC directly. The backend should keep legacy widget endpoints only for compatibility, and its OIDC token exchange should match Telegram's documented flow.

**Tech Stack:** React, Vite, Node.js, Express, Vitest, Telegram Mini App auth, Telegram OIDC

---

## Chunk 1: Browser Login Routing

### Task 1: Lock browser login behavior with tests

**Files:**
- Modify: `pbth/__tests__/unit/auth-ux.test.ts`
- Test: `pbth/__tests__/unit/auth-ux.test.ts`

- [ ] **Step 1: Write the failing test**
Add a test that expects browser login to use OIDC whenever `initData` is absent or blank, and a test that validates the explicit browser-primary transport naming.

- [ ] **Step 2: Run test to verify it fails**
Run: `npm run test:unit -- auth-ux.test.ts`
Expected: FAIL because the browser-primary helper/behavior is not implemented yet.

- [ ] **Step 3: Write minimal implementation**
Update the frontend auth helper so browser login is represented as a single primary path with WebApp used only when actual `initData` exists.

- [ ] **Step 4: Run test to verify it passes**
Run: `npm run test:unit -- auth-ux.test.ts`
Expected: PASS

### Task 2: Point the user login screen at the single browser flow

**Files:**
- Modify: `pbth/api.ts`
- Modify: `pbth/views/LoginView.tsx`
- Test: `pbth/__tests__/unit/auth-ux.test.ts`

- [ ] **Step 1: Write the failing test**
Extend the unit coverage so the user login path no longer depends on the legacy/canary direct route as its primary browser path.

- [ ] **Step 2: Run test to verify it fails**
Run: `npm run test:unit -- auth-ux.test.ts`
Expected: FAIL until the frontend route selection is updated.

- [ ] **Step 3: Write minimal implementation**
Have the user login screen redirect to OIDC directly for browser login while preserving Mini App auth inside Telegram.

- [ ] **Step 4: Run test to verify it passes**
Run: `npm run test:unit -- auth-ux.test.ts`
Expected: PASS

## Chunk 2: OIDC Backend Compliance

### Task 3: Lock Telegram OIDC token exchange format with tests

**Files:**
- Create: `backend/src/__tests__/unit/telegram-oidc.test.ts`
- Test: `backend/src/__tests__/unit/telegram-oidc.test.ts`

- [ ] **Step 1: Write the failing test**
Add a test that expects the token exchange request to use HTTP Basic auth with `client_id:client_secret`, while still sending the required form fields.

- [ ] **Step 2: Run test to verify it fails**
Run: `npm run test:unit -- src/__tests__/unit/telegram-oidc.test.ts`
Expected: FAIL because the current implementation sends the client secret in the form body only.

- [ ] **Step 3: Write minimal implementation**
Update `exchangeOidcCode` to send Basic Authorization and keep the form body aligned with Telegram's documented token exchange.

- [ ] **Step 4: Run test to verify it passes**
Run: `npm run test:unit -- src/__tests__/unit/telegram-oidc.test.ts`
Expected: PASS

### Task 4: Simplify the backend compatibility route

**Files:**
- Modify: `backend/src/modules/auth/routes.ts`
- Test: `backend/src/__tests__/unit/auth-canary.test.ts`
- Test: `backend/src/__tests__/unit/telegram-oidc.test.ts`

- [ ] **Step 1: Write the failing test**
Add coverage that expects `/auth/telegram/direct` to prefer OIDC whenever OIDC is enabled, using legacy only when OIDC is disabled.

- [ ] **Step 2: Run test to verify it fails**
Run: `npm run test:unit -- src/__tests__/unit/auth-canary.test.ts src/__tests__/unit/telegram-oidc.test.ts`
Expected: FAIL because the route still applies canary/legacy branching.

- [ ] **Step 3: Write minimal implementation**
Simplify the route so compatibility remains, but browser login behavior is deterministic and aligned with the approved UX.

- [ ] **Step 4: Run test to verify it passes**
Run: `npm run test:unit -- src/__tests__/unit/auth-canary.test.ts src/__tests__/unit/telegram-oidc.test.ts`
Expected: PASS

## Chunk 3: Verification

### Task 5: Run focused and broad verification

**Files:**
- Modify: `backend/src/lib/telegram-oidc.ts`
- Modify: `backend/src/modules/auth/routes.ts`
- Modify: `pbth/api.ts`
- Modify: `pbth/views/LoginView.tsx`
- Modify: `pbth/lib/auth-ux.ts`
- Modify: `pbth/__tests__/unit/auth-ux.test.ts`
- Create: `backend/src/__tests__/unit/telegram-oidc.test.ts`

- [ ] **Step 1: Run focused tests**
Run:
`cd pbth && npm run test:unit -- auth-ux.test.ts`
`cd backend && npm run test:unit -- src/__tests__/unit/telegram-oidc.test.ts src/__tests__/unit/auth-canary.test.ts`
Expected: PASS

- [ ] **Step 2: Run broader regression checks**
Run:
`cd pbth && npm run typecheck`
`cd backend && npm run check`
Expected: PASS
