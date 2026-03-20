# Treasury Confirmations And Team Switching

## Goal

Upgrade the mobile `Казна` flow from a transaction log into an actionable finance workspace for captains and players, starting with:

- finance team switching for users with multiple memberships;
- payment transfer confirmations with screenshot-only attachments;
- captain review flow where pending confirmations do not reduce debt until approved.

## Scope

This implementation slice intentionally avoids a full treasury redesign. It adds the data model and UI primitives needed for the approved manual-first flow, while keeping future online payments compatible with the same states.

## Files

- Modify: `backend/src/modules/finance/routes.ts`
- Modify: `backend/src/modules/init/routes.ts`
- Modify: `backend/src/openapi/spec.ts`
- Create: `backend/src/lib/finance-confirmations.ts`
- Create: `backend/src/db/migrations/015_finance_payment_confirmations.sql`
- Create: `backend/src/__tests__/unit/finance-confirmations.test.ts`
- Modify: `pbth/api.ts`
- Modify: `pbth/types.ts`
- Modify: `pbth/App.tsx`
- Modify: `pbth/views/FinanceView.tsx`
- Create: `pbth/components/TeamContextSwitcher.tsx`
- Create: `pbth/lib/finance-view-model.ts`
- Create: `pbth/__tests__/unit/finance-view-model.test.ts`

## Chunk 1: Data Model And Tests

### Task 1: Backend confirmation model helpers

**Files:**
- Create: `backend/src/lib/finance-confirmations.ts`
- Test: `backend/src/__tests__/unit/finance-confirmations.test.ts`

- [ ] Step 1: Write failing tests for confirmation status mapping, screenshot validation, and role-aware review states.
- [ ] Step 2: Run `npm run test:unit -- finance-confirmations.test.ts` in `backend` and verify failure.
- [ ] Step 3: Implement minimal helper functions to pass tests.
- [ ] Step 4: Run the same test command and verify pass.

### Task 2: Database support for transfer confirmations

**Files:**
- Create: `backend/src/db/migrations/015_finance_payment_confirmations.sql`

- [ ] Step 1: Add migration for `finance_payment_confirmations`.
- [ ] Step 2: Include fields for team, user, related charge or event scope, screenshot payload, submitter, reviewer, and review timestamps.

## Chunk 2: Backend API

### Task 3: Finance API read support for players

**Files:**
- Modify: `backend/src/modules/finance/routes.ts`
- Modify: `backend/src/modules/init/routes.ts`

- [ ] Step 1: Write failing tests for player-safe read helpers.
- [ ] Step 2: Run backend unit tests and verify failure.
- [ ] Step 3: Update finance access rules so players can read only their own finance data while captains keep full team visibility.
- [ ] Step 4: Return team list metadata needed by the mobile team switcher.
- [ ] Step 5: Run backend unit tests and verify pass.

### Task 4: Confirmation submit/review endpoints

**Files:**
- Modify: `backend/src/modules/finance/routes.ts`
- Modify: `backend/src/openapi/spec.ts`

- [ ] Step 1: Write failing tests for confirmation payload validation helpers.
- [ ] Step 2: Run backend unit tests and verify failure.
- [ ] Step 3: Add endpoints to create a transfer confirmation with screenshot data and to approve or reject it.
- [ ] Step 4: Ensure pending confirmations do not change outstanding debt until captain approval.
- [ ] Step 5: Expose pending confirmation summaries in finance responses.
- [ ] Step 6: Run backend unit tests and `npm run check`.

## Chunk 3: Frontend View Model And UX

### Task 5: Frontend view-model helpers

**Files:**
- Create: `pbth/lib/finance-view-model.ts`
- Test: `pbth/__tests__/unit/finance-view-model.test.ts`

- [ ] Step 1: Write failing tests for role-specific sections, team-switcher options, and pending confirmation badges.
- [ ] Step 2: Run `npm run test:unit -- finance-view-model.test.ts` in `pbth` and verify failure.
- [ ] Step 3: Implement the minimal view-model helpers.
- [ ] Step 4: Run the same test command and verify pass.

### Task 6: Finance API client and types

**Files:**
- Modify: `pbth/api.ts`
- Modify: `pbth/types.ts`

- [ ] Step 1: Add client DTOs for team contexts, finance summaries, and transfer confirmations.
- [ ] Step 2: Add `switchTeamContext`, confirmation create, and confirmation review client methods.

### Task 7: Team switcher and finance UI

**Files:**
- Create: `pbth/components/TeamContextSwitcher.tsx`
- Modify: `pbth/views/FinanceView.tsx`
- Modify: `pbth/App.tsx`

- [ ] Step 1: Add a simple team switcher for both captain and player flows.
- [ ] Step 2: Reload finance data when the active team changes through `/auth/context`.
- [ ] Step 3: Replace log-first finance layout with sections for summary, pending confirmations, and debt collection status.
- [ ] Step 4: Add screenshot-based transfer confirmation submission and captain review controls.
- [ ] Step 5: Run frontend unit tests and `npm run typecheck`.

## Verification

- `cd backend && npm run test:unit`
- `cd backend && npm run check`
- `cd pbth && npm run test:unit`
- `cd pbth && npm run typecheck`

## Notes

- Terminology in UI must use `подтверждение перевода`, not `доказательство`.
- Confirmation attachment type is screenshot only in this slice.
- Pending confirmations must stay informational until reviewed by captain.
