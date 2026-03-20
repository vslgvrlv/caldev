# Event Finance Consistency And Collection UX Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make event finance trustworthy by separating collection math from event economics, preventing broken re-generation of charges, and clarifying how event charges are distributed across participants.

**Architecture:** Keep the existing `event_member_charges`, `event_payment_allocations`, and event-linked `transactions`, but stop treating them as one flat money stream in the event screen. Backend charge generation must reject unsafe re-splits once collection has started, and frontend event finance should present two explicit layers: `сбор с участников` and `экономика события`.

**Tech Stack:** Express, PostgreSQL, React, TypeScript, Vitest

---

## File Map

- Modify: `backend/src/modules/finance/routes.ts`
- Modify: `backend/src/lib/finance-confirmations.ts`
- Modify: `backend/src/__tests__/unit/finance-confirmations.test.ts`
- Modify: `pbth/api.ts`
- Modify: `pbth/views/EventDetailView.tsx`
- Modify: `pbth/lib/event-finance-view-model.ts`
- Modify: `pbth/__tests__/unit/event-finance-view-model.test.ts`
- Create: `docs/superpowers/plans/2026-03-19-event-finance-consistency-and-collection-ux-status.md`

## Chunk 1: Reproduce And Lock Root Causes

### Task 1: Codify the unsafe charge re-generation rules

**Files:**
- Modify: `backend/src/lib/finance-confirmations.ts`
- Modify: `backend/src/__tests__/unit/finance-confirmations.test.ts`

- [ ] **Step 1: Write failing unit tests for charge-generation guard rules.**
- [ ] **Step 2: Cover at least these cases:**
  existing equal charges + `TOTAL_SPLIT` re-run without overwrite => reject
  existing equal charges + `FIXED_PER_PERSON` with matching amount => allow add-missing flow
  auto audience must ignore captain/admin rows for player collection flow
- [ ] **Step 3: Run `cd backend && npm run test:unit -- src/__tests__/unit/finance-confirmations.test.ts` and verify RED.**
- [ ] **Step 4: Implement minimal helpers for audience filtering and unsafe re-split detection.**
- [ ] **Step 5: Re-run the same test command and verify GREEN.**

### Task 2: Lock the event-finance presentation semantics

**Files:**
- Modify: `pbth/lib/event-finance-view-model.ts`
- Modify: `pbth/__tests__/unit/event-finance-view-model.test.ts`

- [ ] **Step 1: Write failing tests for a split event-finance model.**
- [ ] **Step 2: Cover at least these cases:**
  summary cards for `сбор с участников`
  separate cards for event economics (`план`, `расходы`, `покрытие/дефицит`)
  derived distribution hint (`3 участника · поровну по 1 200 ₽`)
  localized finance-state label instead of raw enum
- [ ] **Step 3: Run `cd pbth && npm run test:unit -- __tests__/unit/event-finance-view-model.test.ts` and verify RED.**
- [ ] **Step 4: Implement minimal view-model helpers to satisfy the tests.**
- [ ] **Step 5: Re-run the same test command and verify GREEN.**

## Chunk 2: Fix Event Charge Generation Logic

### Task 3: Prevent broken re-splits and narrow automatic audience

**Files:**
- Modify: `backend/src/modules/finance/routes.ts`
- Modify: `backend/src/lib/finance-confirmations.ts`

- [ ] **Step 1: Use the tested helpers inside `/finance/events/:eventId/charges/generate`.**
- [ ] **Step 2: Exclude `ADMIN` and `CAPTAIN` from automatic audience selection for event debt collection.**
- [ ] **Step 3: If selected participants already have charges, reject `TOTAL_SPLIT` re-generation without overwrite with a clear 409 message.**
- [ ] **Step 4: Allow safe add-missing behavior only for compatible fixed/custom flows.**
- [ ] **Step 5: Keep `overwriteExisting` path untouched for pre-collection recalculation only.**

## Chunk 3: Rebuild Event Finance UX

### Task 4: Separate collection math from event economics in the event screen

**Files:**
- Modify: `pbth/views/EventDetailView.tsx`
- Modify: `pbth/lib/event-finance-view-model.ts`
- Modify: `pbth/api.ts`

- [ ] **Step 1: Replace the single mixed hero row with two labeled sections: `Сбор с участников` and `Экономика события`.**
- [ ] **Step 2: Rename the generic `payments` usage in the event screen to linked operations and keep deposits/expenses visually distinct.**
- [ ] **Step 3: Replace the `DollarSign` cost card with a neutral budget/cost presentation and show cost status text.**
- [ ] **Step 4: Show a distribution hint for current charges and a short explanation when charges are uneven.**
- [ ] **Step 5: Tighten button copy and helper text so captains understand what will be charged and to whom.**

### Task 5: Make the charge modal safer and clearer

**Files:**
- Modify: `pbth/views/EventDetailView.tsx`

- [ ] **Step 1: Disable or warn on `TOTAL_SPLIT` when event charges already exist.**
- [ ] **Step 2: Prefill a fixed amount suggestion when existing charges are uniform.**
- [ ] **Step 3: Show a preview line before submit: selected audience count and resulting per-person amount or rule.**
- [ ] **Step 4: Surface backend conflict errors inline instead of a generic “unknown error” alert when possible.**

## Chunk 4: Verification And Status

### Task 6: Full verification and status update

**Files:**
- Modify: `docs/superpowers/plans/2026-03-19-event-finance-consistency-and-collection-ux-status.md`

- [ ] **Step 1: Run `cd backend && npm run test:unit`.**
- [ ] **Step 2: Run `cd backend && npm run check`.**
- [ ] **Step 3: Run `cd backend && npm run build`.**
- [ ] **Step 4: Run `cd pbth && npm run test:unit`.**
- [ ] **Step 5: Run `cd pbth && npm run typecheck`.**
- [ ] **Step 6: Run `cd pbth && npm run build`.**
- [ ] **Step 7: Update status markdown with actual evidence, fixed root causes, and any remaining product gaps.**
