# Event Finance Consistency And Collection UX Status

## Current Status

- [x] Plan written
- [ ] Root causes reproduced from local data
- [x] Root causes reproduced from local data
- [x] Backend charge-generation guard implemented
- [x] Event finance view-model rebuilt
- [x] Event detail UI rebuilt
- [x] Verification complete

## Active Work

- [x] Identify mismatch between event collection summary and linked operations
- [x] Confirm local DB contains unsafe re-generation state for `DEMO: Alpha Cup`
- [x] Add failing tests for backend guard and event-finance semantics
- [x] Implement backend and frontend fixes
- [x] Run full backend/frontend verification

## Root Causes Found

- `Сбор с участников` and `расходы события` are rendered inside one finance block without semantic separation, so the top cards and linked operations appear contradictory even when raw data is individually correct.
- Event charge generation currently allows a new `TOTAL_SPLIT` run after charges already exist when `overwriteExisting=false`; conflicting rows are ignored, so only missing participants receive the new split amount and the event ends up with nonsense totals.
- Automatic event charge generation currently includes confirmed captains in the audience, which is wrong for the default player debt-collection flow.
- Event detail still uses a generic `Стоимость` card with `DollarSign`, which blurs planned event budget, actual expenses, and participant collection into one vague money concept.

## Evidence

- `2026-03-19`: Local DB inspection for `DEMO: Alpha Cup` showed event-linked expense `ball test $` for `14 000 ₽` and linked deposit `DEMO: Tournament payment batch` for `1 800 ₽`, while existing participant charges remained a separate `3 600 ₽` collection flow.
- `2026-03-19`: Local DB inspection also showed a later auto-generated charge for `Demo Captain A` on the same event for `11 250 ₽`, proving that re-running charge generation after collection started can create corrupted participant debt.
- `2026-03-19`: New backend guard tests passed in `backend/src/__tests__/unit/finance-confirmations.test.ts`, covering automatic audience filtering, unsafe `TOTAL_SPLIT` rejection, and fixed-amount add-missing validation.
- `2026-03-19`: New event-finance semantics tests passed in `pbth/__tests__/unit/event-finance-view-model.test.ts`, covering separated collection/economics cards, localized finance state, and distribution hint rendering.
- `2026-03-19`: Full verification passed:
  backend `npm run test:unit`, `npm run check`, `npm run build`
  frontend `npm run test:unit`, `npm run typecheck`, `npm run build`
  frontend build still prints the known Vite warning about non-module vendor scripts in `index.html`, but exits `0`.

## Fixes Applied

- Automatic event charge generation now excludes captains from the default debtor audience.
- Backend rejects unsafe `TOTAL_SPLIT` re-generation once existing charges already exist, instead of silently creating partial garbage debt.
- Safe add-missing flow now steers toward matching fixed amounts for new participants.
- Event detail now separates `Сбор с участников` from `Экономика события`, so collection totals no longer visually compete with event expenses.
- Event detail now explains current charge distribution and previews what a new charge run will do before submit.
- Team finance summaries and event summaries now ignore captain charges in debtor-oriented views, preventing one corrupted captain row from poisoning the main collection UX.

## Notes

- This pass focuses on trustworthiness and collection UX, not on a full “edit event finance” subsystem.
- After this pass, a next logical product step is explicit `корректировка начислений` instead of reusing the initial generation flow for post-start changes.
