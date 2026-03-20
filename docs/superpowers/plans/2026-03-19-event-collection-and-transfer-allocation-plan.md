# Event Collection And Transfer Allocation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw event-finance block with a collection-first event summary and add a captain transfer-credit flow that previews how a player's payment will be auto-allocated across debts.

**Architecture:** Keep the backend allocation behavior unchanged for this pass and make the frontend honest about it. Event detail becomes a compact summary plus a collection workspace, and the captain settlement flow loads per-player finance detail on demand and renders a preview that mirrors backend oldest-debt allocation.

**Tech Stack:** React, TypeScript, Express, PostgreSQL, Vitest

---

## File Map

- Create: `docs/superpowers/plans/2026-03-19-event-collection-and-transfer-allocation-status.md`
- Modify: `pbth/views/EventDetailView.tsx`
- Modify: `pbth/views/FinanceView.tsx`
- Modify: `pbth/App.tsx`
- Modify: `pbth/api.ts`
- Modify: `pbth/types.ts`
- Modify: `pbth/lib/event-finance-view-model.ts`
- Create: `pbth/lib/finance-transfer-preview.ts`
- Create: `pbth/components/EventCollectionSheet.tsx`
- Create: `pbth/components/TransferConfirmationModal.tsx`
- Modify: `pbth/__tests__/unit/event-finance-view-model.test.ts`
- Create: `pbth/__tests__/unit/finance-transfer-preview.test.ts`

## Chunk 1: Event Collection Summary

### Task 1: Rewrite the event finance view-model around collection-first summaries

**Files:**
- Modify: `pbth/lib/event-finance-view-model.ts`
- Modify: `pbth/__tests__/unit/event-finance-view-model.test.ts`

- [ ] **Step 1: Write failing tests for the compact event summary and collection workspace labels.**
- [ ] **Step 2: Cover status label, summary cards, participant counts, and collection CTA labels.**
- [ ] **Step 3: Run `cd pbth && npm run test:unit -- __tests__/unit/event-finance-view-model.test.ts` and verify RED.**
- [ ] **Step 4: Implement the minimal view-model changes.**
- [ ] **Step 5: Re-run the same test command and verify GREEN.**

### Task 2: Replace the main event page finance block with the compact collection summary

**Files:**
- Modify: `pbth/views/EventDetailView.tsx`

- [ ] **Step 1: Remove the current long mixed finance presentation from the main event page.**
- [ ] **Step 2: Render `Потрачено / Собрано / Осталось собрать / Участников в сборе`.**
- [ ] **Step 3: Add `Открыть сбор` or `Создать сбор` as the primary entry point.**
- [ ] **Step 4: Keep `Добавить расход` available from the event page.**

## Chunk 2: Event Collection Workspace

### Task 3: Introduce a dedicated collection sheet component

**Files:**
- Create: `pbth/components/EventCollectionSheet.tsx`
- Modify: `pbth/views/EventDetailView.tsx`

- [ ] **Step 1: Create the collection sheet component with header, summary cards, actions, player rows, and linked expenses.**
- [ ] **Step 2: Open it from the event page primary CTA.**
- [ ] **Step 3: Keep current event expense creation and debtor reminders wired into the sheet actions.**
- [ ] **Step 4: Keep charge generation accessible from the sheet instead of the main event page.**

## Chunk 3: Captain Transfer Allocation Preview

### Task 4: Build and test transfer allocation preview helper

**Files:**
- Create: `pbth/lib/finance-transfer-preview.ts`
- Create: `pbth/__tests__/unit/finance-transfer-preview.test.ts`

- [ ] **Step 1: Write failing tests for auto-allocation preview against oldest debts first.**
- [ ] **Step 2: Cover full allocation, partial allocation, and leftover amount cases.**
- [ ] **Step 3: Run `cd pbth && npm run test:unit -- __tests__/unit/finance-transfer-preview.test.ts` and verify RED.**
- [ ] **Step 4: Implement the helper to match backend allocation order.**
- [ ] **Step 5: Re-run the same test command and verify GREEN.**

### Task 5: Replace the current captain settlement modal with a debt-aware flow

**Files:**
- Create: `pbth/components/TransferConfirmationModal.tsx`
- Modify: `pbth/views/FinanceView.tsx`
- Modify: `pbth/App.tsx`

- [ ] **Step 1: Move modal UI out of `FinanceView.tsx` into a dedicated component.**
- [ ] **Step 2: Load selected player finance detail on demand for captains.**
- [ ] **Step 3: Show total debt, debt rows, auto-allocation preview, and leftover amount before submit.**
- [ ] **Step 4: Keep the player self-submit flow working in the same component with a simpler layout.**
- [ ] **Step 5: Add quick-open from debtor rows with preselected player.**

## Chunk 4: Verification And Status

### Task 6: Full verification and status update

**Files:**
- Modify: `docs/superpowers/plans/2026-03-19-event-collection-and-transfer-allocation-status.md`

- [ ] **Step 1: Run `cd pbth && npm run test:unit`.**
- [ ] **Step 2: Run `cd pbth && npm run typecheck`.**
- [ ] **Step 3: Run `cd pbth && npm run build`.**
- [ ] **Step 4: Run `cd backend && npm run test:unit`.**
- [ ] **Step 5: Run `cd backend && npm run check`.**
- [ ] **Step 6: Run `cd backend && npm run build`.**
- [ ] **Step 7: Update status markdown with actual verification evidence and known follow-ups.**
