# Treasury V2 Cross-Team And Event Finance Status

## Current Status

- [x] Chunk 1 complete: Player all-teams mode and captain team scope
- [x] Chunk 2 complete: Unified expense creation with optional event linking
- [x] Chunk 3 complete: Event finance workspace in event detail
- [x] Chunk 4 complete: UX tightening and full verification

## Active Work

- [x] Write plan markdown
- [x] Initialize status markdown
- [x] Implement player all-teams finance aggregate
- [x] Implement captain team-only finance filter
- [x] Implement unified expense modal with optional event link
- [x] Implement event finance section in event detail
- [x] Run backend verification
- [x] Run frontend verification

## Progress Notes

- `2026-03-18`: Finance filter decoupled from auth context. Players now default to `Все команды`, captains stay team-scoped, and finance actions use the selected finance team instead of the active app team.
- `2026-03-18`: Unified expense modal now supports optional event linking in treasury and locked event context inside event detail.
- `2026-03-18`: Event detail now includes finance summary, debtors, linked operations, charge generation, and debtor reminders.
- `2026-03-18`: Verification completed: backend `test:unit/check/build` passed; frontend `test:unit/typecheck/build` passed. Vite still prints the known local warning about non-module vendor scripts in `index.html`, but production build exits `0`.

## Notes

- Players must default to `Все команды` inside `Казна`.
- Captains stay team-scoped in `Казна`; team switching remains available.
- Expense creation must work from both treasury and event detail.
- Event detail must expose finance actions, not just passive finance status.
