# Treasury V2 Cross-Team And Event Finance Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `Казна` into a collection-first finance workspace with player all-team visibility, captain team-scoped control, event-linked expenses, and event-level finance actions.

**Architecture:** Keep the current finance foundation (`transactions`, `event_member_charges`, `event_payment_allocations`, `transfer confirmations`) and add a thin orchestration layer on top of it. The key structural change is to separate finance display context from auth team context for players, introduce a unified expense creation flow with optional `eventId`, and surface event finance operations directly inside the event detail experience.

**Tech Stack:** Express, PostgreSQL, React, TypeScript, Vite, Vitest

---

## File Map

- Modify: `backend/src/modules/finance/routes.ts`
- Modify: `backend/src/openapi/spec.ts`
- Modify: `backend/src/__tests__/unit/finance-confirmations.test.ts`
- Modify: `pbth/api.ts`
- Modify: `pbth/types.ts`
- Modify: `pbth/App.tsx`
- Modify: `pbth/views/FinanceView.tsx`
- Modify: `pbth/views/EventDetailView.tsx`
- Modify: `pbth/components/TeamContextSwitcher.tsx`
- Modify: `pbth/lib/finance-view-model.ts`
- Modify: `pbth/__tests__/unit/finance-view-model.test.ts`
- Create: `pbth/__tests__/unit/finance-cross-team.test.ts`
- Create: `pbth/__tests__/unit/event-finance-view-model.test.ts`

## Chunk 1: Player All-Teams And Captain Team Scope

### Task 1: Define frontend finance context behavior

**Files:**
- Modify: `pbth/lib/finance-view-model.ts`
- Modify: `pbth/__tests__/unit/finance-view-model.test.ts`
- Create: `pbth/__tests__/unit/finance-cross-team.test.ts`

- [ ] **Step 1: Write failing tests for player default `ALL_TEAMS` finance mode and captain team-scoped filter mode.**
- [ ] **Step 2: Run `npm run test:unit -- __tests__/unit/finance-view-model.test.ts __tests__/unit/finance-cross-team.test.ts` in `pbth` and verify failure.**
- [ ] **Step 3: Implement minimal helpers for finance filter options, aggregate hero cards, and role-specific mode rules.**
- [ ] **Step 4: Run the same test command and verify pass.**

### Task 2: Add backend cross-team finance read endpoints for players

**Files:**
- Modify: `backend/src/modules/finance/routes.ts`
- Modify: `backend/src/openapi/spec.ts`

- [ ] **Step 1: Write failing backend tests for player aggregate finance responses across memberships and captain rejection for cross-team aggregate mode.**
- [ ] **Step 2: Run `npm run test:unit -- finance-confirmations.test.ts` in `backend` and verify failure.**
- [ ] **Step 3: Add team-filter-aware finance endpoints that support `scope=all` for players and explicit team-only reads for captains.**
- [ ] **Step 4: Return aggregate summary, team buckets, debt items, and confirmation buckets for player all-team mode.**
- [ ] **Step 5: Run the same backend unit tests and verify pass.**

### Task 3: Wire app state to finance filters instead of auth context for players

**Files:**
- Modify: `pbth/App.tsx`
- Modify: `pbth/api.ts`
- Modify: `pbth/types.ts`
- Modify: `pbth/components/TeamContextSwitcher.tsx`
- Modify: `pbth/views/FinanceView.tsx`

- [ ] **Step 1: Add finance filter state that defaults to `ALL_TEAMS` for players and active team only for captains.**
- [ ] **Step 2: Keep auth context switching only for captain flows; do not force players through auth context changes when browsing finance.**
- [ ] **Step 3: Render player aggregate view and captain team filter view from the same screen with role-aware controls.**
- [ ] **Step 4: Run `npm run test:unit` and `npm run typecheck` in `pbth`.**

## Chunk 2: Unified Expense Creation And Event Linking

### Task 4: Formalize expense payloads around optional event linkage

**Files:**
- Modify: `backend/src/modules/finance/routes.ts`
- Modify: `pbth/api.ts`
- Modify: `pbth/types.ts`

- [ ] **Step 1: Write failing tests for event-linked expense creation and plain team expense creation.**
- [ ] **Step 2: Run targeted backend and frontend tests and verify failure.**
- [ ] **Step 3: Normalize create-payment/create-transaction clients so a single UI flow can create expenses with optional `eventId`.**
- [ ] **Step 4: Ensure backend returns enough transaction/event metadata to refresh event finance blocks without a second ad-hoc transform.**
- [ ] **Step 5: Re-run the targeted tests and verify pass.**

### Task 5: Replace the loose `Новая трата` modal with a unified collection-first form

**Files:**
- Modify: `pbth/views/FinanceView.tsx`
- Modify: `pbth/App.tsx`

- [ ] **Step 1: Add a shared modal/form model that supports `общекомандная` vs `связать с событием`.**
- [ ] **Step 2: When an event is selected in the form, show event label and preserve the link on save.**
- [ ] **Step 3: Keep existing manual charge/deposit tools working while routing expenses through the new unified form.**
- [ ] **Step 4: Run `npm run test:unit` and `npm run typecheck` in `pbth`.**

## Chunk 3: Event Finance Workspace

### Task 6: Expose event finance actions and detail payloads

**Files:**
- Modify: `backend/src/modules/finance/routes.ts`
- Modify: `pbth/api.ts`
- Modify: `pbth/types.ts`

- [ ] **Step 1: Write failing tests for event finance detail payloads that include summary, participants, payments, and pending confirmations.**
- [ ] **Step 2: Run targeted tests and verify failure.**
- [ ] **Step 3: Extend event finance detail responses and client types to support direct event-page rendering and actions.**
- [ ] **Step 4: Re-run targeted tests and verify pass.**

### Task 7: Add finance block to event detail view

**Files:**
- Modify: `pbth/views/EventDetailView.tsx`
- Modify: `pbth/App.tsx`
- Create: `pbth/__tests__/unit/event-finance-view-model.test.ts`

- [ ] **Step 1: Write failing tests for event finance summary and action availability by role.**
- [ ] **Step 2: Run `npm run test:unit -- __tests__/unit/event-finance-view-model.test.ts` in `pbth` and verify failure.**
- [ ] **Step 3: Add event finance summary cards, participant debt list, linked expenses/payments, and actions for `начислить`, `добавить трату`, `напомнить`.**
- [ ] **Step 4: Reuse the unified expense form from `Казна` with preselected event context.**
- [ ] **Step 5: Run the same test command and verify pass.**

## Chunk 4: Final UX Tightening And Verification

### Task 8: Tighten collection workflow in captain and player treasury views

**Files:**
- Modify: `pbth/views/FinanceView.tsx`
- Modify: `pbth/lib/finance-view-model.ts`
- Modify: `pbth/App.tsx`

- [ ] **Step 1: Reorder captain treasury around open collections, attention items, and pending confirmations rather than transaction history.**
- [ ] **Step 2: Reorder player treasury around aggregate debt, overdue items, pending review, and team-filtered debt groups.**
- [ ] **Step 3: Keep transaction/history blocks as secondary sections only.**
- [ ] **Step 4: Run frontend tests and typecheck.**

### Task 9: Full verification

**Files:**
- Modify: `docs/superpowers/plans/2026-03-18-treasury-v2-cross-team-and-event-finance-status.md`

- [ ] **Step 1: Run `cd backend && npm run test:unit`.**
- [ ] **Step 2: Run `cd backend && npm run check`.**
- [ ] **Step 3: Run `cd backend && npm run build`.**
- [ ] **Step 4: Run `cd pbth && npm run test:unit`.**
- [ ] **Step 5: Run `cd pbth && npm run typecheck`.**
- [ ] **Step 6: Run `cd pbth && npm run build`.**
- [ ] **Step 7: Update status markdown with actual results, open risks, and remaining follow-ups.**

