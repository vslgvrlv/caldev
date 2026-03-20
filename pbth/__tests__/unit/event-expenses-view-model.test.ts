import { describe, expect, it } from "vitest";
import { buildEventExpensesViewModel } from "../../lib/event-expenses-view-model";
import { Role, TransactionType } from "../../types";

describe("buildEventExpensesViewModel", () => {
  it("builds event expenses workspace around spent total and collection entry", () => {
    const model = buildEventExpensesViewModel({
      currentUserRole: Role.CAPTAIN,
      detail: {
        event: {
          id: "event-1",
          title: "Alpha Cup",
          type: "TOURNAMENT",
          startDate: "2026-03-21T10:00:00.000Z",
          costStatus: "FINAL",
          financeState: "COLLECTING",
        },
        summary: {
          chargedTotal: 3600,
          paidTotal: 1800,
          outstandingTotal: 1800,
          collectionRatePct: 50,
        },
        collection: {
          expenseTotal: 14000,
          targetTotal: 14000,
          chargedTotal: 3600,
          paidTotal: 1800,
          undistributedTotal: 10400,
          remainingToCollect: 12200,
          overpaidTotal: 0,
          membersCharged: 3,
          membersPaid: 1,
          state: "NEEDS_DISTRIBUTION",
        },
        participants: [],
        payments: [
          {
            transactionId: "tx-2",
            date: "2026-03-21T11:00:00.000Z",
            type: TransactionType.EXPENSE,
            title: "Шары",
            amount: 8000,
            status: "COMPLETED",
            allocations: [],
          },
          {
            transactionId: "tx-3",
            date: "2026-03-21T12:00:00.000Z",
            type: TransactionType.EXPENSE,
            title: "Поле",
            amount: 6000,
            status: "COMPLETED",
            allocations: [],
          },
        ],
      },
    });

    expect(model.canManage).toBe(true);
    expect(model.totalSpentLabel).toBe("14 000 ₽");
    expect(model.expenseCountLabel).toBe("2");
    expect(model.collectionStatusLabel).toBe("Нужно распределить");
    expect(model.canOpenCollection).toBe(true);
    expect(model.collectionActionLabel).toBe("Управлять сбором");
    expect(model.deltaHint).toBe("Не распределено: 10 400 ₽");
    expect(model.expenses.map((item) => item.title)).toEqual(["Поле", "Шары"]);
  });

  it("keeps collection entry hidden when there are no expenses yet", () => {
    const model = buildEventExpensesViewModel({
      currentUserRole: Role.CAPTAIN,
      detail: {
        event: {
          id: "event-1",
          title: "Alpha Cup",
          type: "TOURNAMENT",
          startDate: "2026-03-21T10:00:00.000Z",
          costStatus: "UNKNOWN",
          financeState: "NOT_CALCULATED",
        },
        summary: {
          chargedTotal: 0,
          paidTotal: 0,
          outstandingTotal: 0,
          collectionRatePct: 0,
        },
        collection: {
          expenseTotal: 0,
          targetTotal: 0,
          chargedTotal: 0,
          paidTotal: 0,
          undistributedTotal: 0,
          remainingToCollect: 0,
          overpaidTotal: 0,
          membersCharged: 0,
          membersPaid: 0,
          state: "EMPTY",
        },
        participants: [],
        payments: [],
      },
    });

    expect(model.totalSpentLabel).toBe("0 ₽");
    expect(model.expenseCountLabel).toBe("0");
    expect(model.canOpenCollection).toBe(false);
    expect(model.collectionActionLabel).toBe("Сбор появится после расходов");
    expect(model.deltaHint).toBeNull();
  });
});
