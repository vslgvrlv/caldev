# Event-First Expense-Derived Collection Status

## Current Status

- [x] Product rule fixed in spec and knowledge base
- [x] Default collection model chosen: one live collection per event
- [x] Multi-round collection deferred from default scope
- [x] Implementation plan approved
- [x] Backend projection implemented
- [x] Expense workspace implemented
- [ ] Collection correction flow implemented
- [x] Event-first transfer allocation implemented
- [ ] Verification complete

## Working Decisions

- `Событие` remains the primary entity.
- `Добавить расход` is the only top-level finance CTA on the event page.
- `Расходы события` is the finance entry point from event detail.
- `Сбор` is derived from aggregated event expenses.
- New expenses after closure reopen or adjust the same live collection instead of creating a default new round.
- Manual per-player debt changes are explicit corrections with history.
- Expense edits change target and deltas only. They must not silently rewrite debts or existing payment allocations.
- If `paid > due`, the excess stays visible as explicit event overpayment/credit until a dedicated refund or cross-event credit policy is introduced.
- Transfer settlement from event context must prefer the current event debt first.

## Open Implementation Risks

- Current backend `finance_state` is charge-driven and does not yet reflect expense-driven reopen semantics.
- Current schema stores one live `event_member_charges` row per `(event_id, user_id)`, so correction history needs a dedicated table.
- Current event expense flow supports creation but not safe editing from the event finance workspace.
- Current treasury settlement flow is team-wide and oldest-debt-first, so event-context allocation priority must be added carefully.
- Player/member finance contracts currently under-report overpayment and correction history, so they can drift from event workspace truth if not migrated together.

## Verification Log

- Frontend:
  - `cd /Users/pk/Documents/CalDEV/pbth && npm run typecheck`
  - `cd /Users/pk/Documents/CalDEV/pbth && npm run test:unit -- __tests__/unit/event-expenses-view-model.test.ts __tests__/unit/event-finance-view-model.test.ts __tests__/unit/finance-transfer-preview.test.ts`
  - `cd /Users/pk/Documents/CalDEV/pbth && npm run build`
- Backend:
  - `cd /Users/pk/Documents/CalDEV/backend && npm run test:unit -- src/__tests__/unit/event-collection.test.ts src/__tests__/unit/finance-confirmations.test.ts`
  - `cd /Users/pk/Documents/CalDEV/backend && npm run build`

## Implemented In This Pass

- Event detail now keeps one finance CTA: `Добавить расход`, which opens `Расходы события`.
- Added `EventExpensesSheet` as the expense-first workspace with total spent, expense count, edit actions, and `Открыть сбор`.
- `FinanceTransactionModal` is now reused as the canonical create/edit expense form owner.
- Event collection settlement from event context now prefers the current event debt first.
- Backend event finance detail and list expose canonical collection projection fields:
  - `expenseTotal`
  - `collectionTargetTotal` / `targetTotal`
  - `undistributedTotal`
  - `remainingToCollect`
  - `overpaidTotal`
  - `collectionState`
- Event collection flow now supports `UNDISTRIBUTED_SPLIT`, so late expenses can be distributed on top of an active collection instead of forcing unsafe total regeneration.

## Remaining Follow-Ups

- Add explicit event charge adjustment history table and per-player correction flow.
- Migrate player/member finance contracts to surface correction history and event overpayment/credit consistently.
- Run DB migration + local smoke flows against a real database state.
