# Event Collection And Transfer Allocation Design

> **Superseded in part:** This document no longer defines the primary event hierarchy.
> Use [2026-03-19-event-centric-expense-first-finance-design.md](/Users/pk/Documents/CalDEV/docs/superpowers/specs/2026-03-19-event-centric-expense-first-finance-design.md) as the canonical product rule for:
> - `event-first` hierarchy,
> - `expense-first` event finance,
> - `one event -> many expenses -> one collection`.
>
> This document remains useful only for the transfer allocation preview mechanics and the shape of a collection workspace after the event-centric hierarchy is applied.

## Goal

Simplify the captain finance UX around two core workflows:

1. Working with an event after it finishes and the final amount is known.
2. Crediting a player's transfer against their real open debts with a visible auto-allocation preview.

## Product Principles

- `Событие` is not the captain's working finance screen.
- `Сбор` is the working finance screen.
- A captain should never approve a transfer “into the void”.
- Finance UI should answer:
  - how much was spent;
  - how much was charged;
  - how much was collected;
  - who still owes money.

## Event Detail

The event detail page becomes a compact event summary with a collection entry point.

### Top Finance Block

Replace the current mixed finance block with a short `Сбор по событию` summary:

- `Потрачено`
- `Собрано`
- `Осталось собрать`
- `Участников в сборе`

Primary action:

- if no charges exist: `Создать сбор`
- if charges exist: `Открыть сбор`

Secondary actions:

- `Добавить расход`
- `Напомнить должникам` when relevant

Remove from the main event page:

- `План события` as a major concept
- `Экономика события`
- the long debtor list
- the long linked-operations list

These move into the collection workspace.

## Event Collection Workspace

The collection workspace is opened from the event detail page as a dedicated sheet/screen.

### Header

- Event title
- Event date
- Collection status:
  - `Сбор не создан`
  - `Сбор идет`
  - `Собран`

### Summary Cards

- `Потрачено`
- `Начислено`
- `Собрано`
- `Осталось собрать`

### Actions

- `Зачесть перевод`
- `Напомнить должникам`
- `Добавить расход`
- `Начислить участникам` or `Доначислить` depending on state

### Player Rows

Each player row shows:

- player name
- charged amount
- paid amount
- remaining amount
- action button

The row should not rely on a complex status system. A small helper badge is allowed, but the numbers are primary.

### Supporting Sections

- `Расходы события`
- `История` / recent linked operations

Pending transfer confirmations are not shown as an event-scoped queue in this pass because confirmations are team-level until approval.

## Captain Transfer Credit Flow

The current `Зачесть перевод` modal is replaced with a debt-aware settlement flow.

### Captain Flow

1. Captain selects a player.
2. System loads that player's open debts.
3. Captain enters transfer amount.
4. System shows:
   - total open debt;
   - list of debts;
   - auto-allocation preview;
   - any leftover amount.
5. Captain attaches screenshot and confirms.

### Allocation Rule

For this pass, default behavior is:

- auto-allocate against the oldest open debts first;
- preview must match backend approval behavior.

### Information Shown

- `Общий долг`
- `Будет зачтено`
- `Остаток после зачета`, if any
- per-debt preview rows:
  - debt title
  - debt amount remaining
  - amount that will be covered by this transfer

### Future Extensions

Not in this pass:

- manual allocation editing
- “this collection only” allocation mode with explicit backend allocations
- club-level finance command center

## Technical Approach

- Reuse `getFinanceMember(teamId, userId)` to load captain-visible debt details for the selected player.
- Keep backend transfer-confirmation approval logic aligned with the existing oldest-debt allocation plan so UI preview stays truthful.
- Compute event collection summaries from the existing event finance detail payload.
- Introduce focused frontend view-model helpers for:
  - event collection summary/sheet
  - transfer allocation preview

## Success Criteria

- A captain can understand the event finance state from one compact summary block.
- A captain can open a collection workspace and see exactly who still owes money.
- A captain can credit a transfer and understand where the money will be allocated before confirming.
- The UI uses operational language instead of abstract finance language.
