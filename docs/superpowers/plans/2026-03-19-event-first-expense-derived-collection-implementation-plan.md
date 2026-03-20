# Event-First Expense-Derived Collection Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild PBTH event finance so event-linked expenses define the collection target, the event page exposes only the expense entry point, and one live event collection remains editable through distribution, corrections, and event-first transfer settlement.

**Architecture:** Keep `Событие` as the primary surface and treat finance as a derived submodule. Reuse `transactions` as the source of truth for event expenses and `event_member_charges` as the live per-player debt ledger, then add a derived event-collection projection plus explicit adjustment history instead of introducing multiple default collection rounds. Replace the old “generate charges from an arbitrary amount” flow with “distribute undistributed event expenses”, add per-player debt correction, and make transfer auto-allocation prefer the current event when settlement starts from event context.

**Tech Stack:** React, TypeScript, Express, PostgreSQL, Vitest

---

## File Map

- Create: `docs/superpowers/plans/2026-03-19-event-first-expense-derived-collection-status.md`
- Create: `backend/src/db/migrations/016_event_charge_adjustments.sql`
- Create: `backend/src/lib/event-collection.ts`
- Modify: `backend/src/lib/finance-confirmations.ts`
- Modify: `backend/src/modules/finance/routes.ts`
- Create: `backend/src/__tests__/unit/event-collection.test.ts`
- Modify: `backend/src/__tests__/unit/finance-confirmations.test.ts`
- Modify: `pbth/api.ts`
- Create: `pbth/lib/event-expenses-view-model.ts`
- Modify: `pbth/lib/event-finance-view-model.ts`
- Modify: `pbth/lib/finance-transfer-preview.ts`
- Modify: `pbth/components/FinanceTransactionModal.tsx`
- Create: `pbth/components/EventExpensesSheet.tsx`
- Modify: `pbth/components/EventCollectionSheet.tsx`
- Create: `pbth/components/EventChargeAdjustmentModal.tsx`
- Modify: `pbth/components/TransferConfirmationModal.tsx`
- Modify: `pbth/views/EventDetailView.tsx`
- Modify: `pbth/views/FinanceView.tsx`
- Modify: `pbth/__tests__/unit/event-finance-view-model.test.ts`
- Create: `pbth/__tests__/unit/event-expenses-view-model.test.ts`
- Modify: `pbth/__tests__/unit/finance-transfer-preview.test.ts`

## Domain Model Decisions

- One event can have many expenses.
- One event has one live collection by default.
- Event expenses are the canonical source of `сколько нужно собрать`.
- `event_member_charges` remains one live debt row per `(event_id, user_id)`.
- New expenses after partial or full collection do not create a new default round.
- New expenses create `не распределено` delta inside the same event collection.
- Manual changes to a single player debt are explicit corrections with history.
- Editing an expense changes only the event collection target and derived deltas. It must never silently rewrite player debts or existing payment allocations.
- If a correction or expense decrease makes `paid > due`, the system keeps existing allocations intact and surfaces the delta as explicit event overpayment/credit instead of silently losing money.
- Advanced multi-round collection support is out of scope for this implementation and must not leak into the default UX or schema.

## Chunk 1: Backend Collection Projection

### Task 1: Introduce a canonical event-collection projection helper

**Files:**
- Create: `backend/src/lib/event-collection.ts`
- Create: `backend/src/__tests__/unit/event-collection.test.ts`

- [ ] **Step 1: Write failing unit tests for event collection projection semantics.**
  Cover:
  - expenses exist, charges do not exist;
  - charges exist but do not cover full expense total;
  - charges fully cover expenses while payments still lag;
  - payments fully cover expenses;
  - a new expense appears after the event had been fully collected;
  - expense decrease or manual correction makes `paid > due`.
- [ ] **Step 2: Run `cd backend && npm run test:unit -- src/__tests__/unit/event-collection.test.ts` and verify RED.**
- [ ] **Step 3: Implement a pure helper that derives these fields from expenses, charges, and payments:**
  - `expenseTotal`
  - `collectionTargetTotal`
  - `chargedTotal`
  - `paidTotal`
  - `undistributedTotal`
  - `remainingToCollect`
  - `overpaidTotal`
  - `membersCharged`
  - `membersPaid`
  - `stateLabel` or equivalent computed state
- [ ] **Step 4: Re-run the same test command and verify GREEN.**

### Task 2: Stop treating `events.finance_state` as the sole source of truth for collection UX

**Files:**
- Modify: `backend/src/modules/finance/routes.ts`
- Test: `backend/src/__tests__/unit/event-collection.test.ts`

- [ ] **Step 1: Update `/finance/events` to compute event collection summaries from event-linked expenses plus live charges/payments.**
- [ ] **Step 2: Update `/finance/events/:eventId` to return the same canonical projection fields for event detail.**
- [ ] **Step 3: Keep backward-compatible fields during migration, but add the new derived fields explicitly instead of forcing the frontend to infer them from transactions.**
- [ ] **Step 4: Ensure a late new expense can surface `undistributedTotal > 0` even when old `finance_state` was effectively closed.**
- [ ] **Step 5: Add explicit tests for the invariant `expense edit -> target delta only, no silent charge or allocation rewrite`.**
- [ ] **Step 6: Run `cd backend && npm run test:unit -- src/__tests__/unit/event-collection.test.ts src/__tests__/unit/finance-confirmations.test.ts` and verify GREEN.**

## Chunk 2: Expense History And Member Corrections

### Task 3: Add explicit history for debt corrections

**Files:**
- Create: `backend/src/db/migrations/016_event_charge_adjustments.sql`
- Modify: `backend/src/modules/finance/routes.ts`

- [ ] **Step 1: Add a table for event charge adjustment history with event, user, delta, reason, optional note, actor, and timestamps.**
- [ ] **Step 2: Keep `event_member_charges` as the live current debt table instead of introducing multiple default collection rounds.**
- [ ] **Step 3: Store enough metadata to explain why the live debt changed: manual correction, participant add, expense delta, or reopen after late expense.**
- [ ] **Step 4: Wire future manual correction writes to always append history and then update the live debt row.**
- [ ] **Step 5: Run `cd backend && npm run build` and verify the migration types compile cleanly.**

### Task 4: Add event expense editing and collection-safe correction endpoints

**Files:**
- Modify: `backend/src/modules/finance/routes.ts`
- Modify: `backend/src/lib/finance-confirmations.ts`
- Modify: `backend/src/__tests__/unit/finance-confirmations.test.ts`

- [ ] **Step 1: Add event-scoped expense CRUD endpoints for create and edit.**
  Keep delete out of scope unless a safe reversible model is introduced in the same pass.
- [ ] **Step 2: Add an endpoint that distributes the current `undistributedTotal` across selected participants instead of re-running raw `TOTAL_SPLIT` against arbitrary totals.**
- [ ] **Step 3: Add an endpoint for per-player debt correction inside an event collection using either `deltaAmount` or `finalAmount`.**
- [ ] **Step 4: Reject old unsafe flows that overwrite live charges after collection has started.**
- [ ] **Step 5: Define canonical behavior for `paid > due` after correction or expense decrease.**
  For this pass:
  - keep allocations intact;
  - surface overpayment explicitly in event/member finance;
  - do not auto-convert it into cross-event credit or silent refund logic.
- [ ] **Step 6: Extend validation helpers so they operate on “undistributed event amount”, “correction”, and “overpayment visibility” semantics, not on “blind regeneration” semantics.**
- [ ] **Step 7: Run `cd backend && npm run test:unit -- src/__tests__/unit/finance-confirmations.test.ts` and verify GREEN.**

## Chunk 3: Event-First Transfer Allocation

### Task 5: Make transfer auto-allocation prefer the current event when opened from event context

**Files:**
- Modify: `backend/src/lib/finance-confirmations.ts`
- Modify: `backend/src/modules/finance/routes.ts`
- Modify: `pbth/lib/finance-transfer-preview.ts`
- Modify: `pbth/__tests__/unit/finance-transfer-preview.test.ts`

- [ ] **Step 1: Write failing tests for preferred-event-first allocation while preserving oldest-debt fallback outside event context.**
- [ ] **Step 2: Add an optional `preferredEventId` input to allocation planning in backend and frontend helpers.**
- [ ] **Step 3: Sort candidates so the current event debt is settled first when settlement starts from `Event Collection`, then fall back to oldest debt order.**
- [ ] **Step 4: Keep the captain treasury flow honest by using plain oldest-debt order when no preferred event is supplied.**
- [ ] **Step 5: Run `cd pbth && npm run test:unit -- __tests__/unit/finance-transfer-preview.test.ts` and verify GREEN.**

## Chunk 4: Event Screen And Expenses Workspace

### Task 6: Replace the event-page finance CTA model with an expense-first workspace

**Files:**
- Create: `pbth/lib/event-expenses-view-model.ts`
- Create: `pbth/__tests__/unit/event-expenses-view-model.test.ts`
- Modify: `pbth/components/FinanceTransactionModal.tsx`
- Create: `pbth/components/EventExpensesSheet.tsx`
- Modify: `pbth/views/EventDetailView.tsx`
- Modify: `pbth/api.ts`

- [ ] **Step 1: Write failing tests for the event expenses view-model.**
  Cover:
  - event page shows one finance entry point;
  - expense workspace totals;
  - presence or absence of `Открыть сбор`;
  - messaging for `не распределено`.
- [ ] **Step 2: Run `cd pbth && npm run test:unit -- __tests__/unit/event-expenses-view-model.test.ts` and verify RED.**
- [ ] **Step 3: Build `EventExpensesSheet` as the finance entry point from event detail.**
  Include:
  - list of expenses;
  - total spent;
  - edit action per expense;
  - primary action `Открыть сбор`.
- [ ] **Step 4: Rework `FinanceTransactionModal` into the canonical create/edit form owner for event expenses, then reuse it inside `EventExpensesSheet`.**
- [ ] **Step 5: Change `EventDetailView` so the only top-level finance CTA is `Добавить расход`, and make it open the expenses workspace instead of a one-off blind modal.**
- [ ] **Step 6: Keep event detail itself compact and event-first.**
- [ ] **Step 7: Re-run `cd pbth && npm run test:unit -- __tests__/unit/event-expenses-view-model.test.ts` and verify GREEN.**

## Chunk 5: Collection Workspace And Player Corrections

### Task 7: Rebuild the collection workspace around derived totals and undistributed delta

**Files:**
- Modify: `pbth/lib/event-finance-view-model.ts`
- Modify: `pbth/__tests__/unit/event-finance-view-model.test.ts`
- Modify: `pbth/components/EventCollectionSheet.tsx`
- Create: `pbth/components/EventChargeAdjustmentModal.tsx`
- Modify: `pbth/views/EventDetailView.tsx`

- [ ] **Step 1: Update the event finance view-model to consume the new backend projection fields.**
- [ ] **Step 2: Surface `Потрачено`, `Начислено`, `Собрано`, `Осталось собрать`, and `Не распределено`, without re-promoting finance to the main event screen.**
- [ ] **Step 3: Replace the current “generate charges” modal with collection actions based on current context:**
  - `Распределить нераскиданное`
  - `Доначислить участника`
  - `Скорректировать долг`
- [ ] **Step 4: Surface explicit `переплата` or `кредит` messaging when `paid > due` becomes true after a correction or expense decrease.**
- [ ] **Step 5: Add a per-player correction modal reachable from the collection row and from the player card context.**
- [ ] **Step 6: Ensure the collection workspace can deep-link back to event expenses instead of duplicating expense-edit logic locally.**
- [ ] **Step 7: Run `cd pbth && npm run test:unit -- __tests__/unit/event-finance-view-model.test.ts` and verify GREEN.**

## Chunk 6: Treasury Alignment And API Contracts

### Task 8: Keep Kazna as a cross-access surface without breaking event hierarchy

**Files:**
- Modify: `pbth/views/FinanceView.tsx`
- Modify: `pbth/components/TransferConfirmationModal.tsx`
- Modify: `pbth/api.ts`
- Modify: `backend/src/modules/finance/routes.ts`

- [ ] **Step 1: Update team finance event cards to use the new derived event summary fields.**
- [ ] **Step 2: Keep `Казна` focused on problematic collections, pending confirmations, and debtor shortcuts, not on redefining the event workflow.**
- [ ] **Step 3: Make treasury event cards deep-link into the event expenses workspace or the event collection workspace as appropriate.**
- [ ] **Step 4: Pass `preferredEventId` into captain transfer settlement when launched from an event collection row.**
- [ ] **Step 5: Keep the generic treasury settlement flow untouched when launched from a cross-team debtor list.**

### Task 9: Extend player and member finance contracts to the new event collection semantics

**Files:**
- Modify: `backend/src/modules/finance/routes.ts`
- Modify: `pbth/api.ts`
- Modify: `pbth/views/FinanceView.tsx`
- Modify: `pbth/components/TransferConfirmationModal.tsx`

- [ ] **Step 1: Extend `/finance/members/:userId` to return `overpaid` and event-level correction history needed by player/captain views.**
- [ ] **Step 2: Keep player debt views aligned with the same event collection projection used by the event workspace.**
- [ ] **Step 3: Show explicit event overpayment/credit when `paid > due`, instead of silently flattening it away in player or member detail.**
- [ ] **Step 4: Verify settlement preview and player debt views still tell the same truth after expense edits and manual corrections.**

## Chunk 7: Verification And Status

### Task 10: Full verification and rollout notes

**Files:**
- Create: `docs/superpowers/plans/2026-03-19-event-first-expense-derived-collection-status.md`

- [ ] **Step 1: Run `cd backend && npm run db:migrate`.**
- [ ] **Step 2: Run `cd backend && npm run test:unit`.**
- [ ] **Step 3: Run `cd backend && npm run check`.**
- [ ] **Step 4: Run `cd backend && npm run build`.**
- [ ] **Step 5: Run `cd pbth && npm run test:unit`.**
- [ ] **Step 6: Run `cd pbth && npm run typecheck`.**
- [ ] **Step 7: Run `cd pbth && npm run build`.**
- [ ] **Step 8: Smoke-test these user flows locally on a real DB state:**
  - event detail -> add expense -> open expenses workspace;
  - expenses workspace -> edit an existing expense and verify only target delta changes;
  - expenses workspace -> open collection;
  - collection -> distribute undistributed amount;
  - collection -> correct a single player debt;
  - collection -> reduce due below already paid and verify overpayment is visible;
  - collection -> settle a player transfer with current-event-first auto-allocation;
  - treasury -> open event-linked collection without breaking team filters;
  - player/member finance -> view the same debt/overpayment truth after corrections.
- [ ] **Step 9: Update the status markdown with exact verification evidence, incomplete items, and known follow-ups.**

Plan complete and saved to `docs/superpowers/plans/2026-03-19-event-first-expense-derived-collection-implementation-plan.md`. Ready to execute?
