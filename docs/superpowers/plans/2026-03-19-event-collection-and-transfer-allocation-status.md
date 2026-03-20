# Event Collection And Transfer Allocation Status

## Current Status

- [x] Design approved
- [x] Spec written
- [x] Plan written
- [x] Event collection summary implemented
- [x] Event collection sheet implemented
- [x] Captain transfer allocation preview implemented
- [x] Verification complete

## Active Work

- [x] Rewrite event detail finance block around collection-first summary
- [x] Add collection workspace
- [x] Replace captain `Зачесть перевод` with debt-aware allocation preview
- [x] Run full verification

## Notes

- This pass keeps backend auto-allocation behavior unchanged and makes the UI explicit about that rule.
- Event-scoped explicit transfer allocation is intentionally out of scope for this pass.
- New frontend pieces:
  - `pbth/components/TransferConfirmationModal.tsx`
  - `pbth/components/EventCollectionSheet.tsx`
- Reworked UX:
  - `pbth/views/FinanceView.tsx`
  - `pbth/views/EventDetailView.tsx`
- Verification evidence:
  - `cd pbth && npm run typecheck`
  - `cd pbth && npm run test:unit -- __tests__/unit/event-finance-view-model.test.ts __tests__/unit/finance-transfer-preview.test.ts`
  - `cd pbth && npm run build`
