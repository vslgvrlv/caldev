import { describe, expect, it } from "vitest";
import { buildEventFinanceViewModel } from "../../lib/event-finance-view-model";
import { Role, TransactionType } from "../../types";

describe("buildEventFinanceViewModel", () => {
  it("builds a compact event summary plus collection workspace data for captains", () => {
    const model = buildEventFinanceViewModel({
      currentUserRole: Role.CAPTAIN,
      detail: {
        event: {
          id: "event-1",
          title: "Весенний турнир",
          type: "TOURNAMENT",
          startDate: "2026-04-06T10:00:00.000Z",
          cost: 9000,
          costStatus: "FINAL",
          financeState: "COLLECTING",
        },
        summary: {
          chargedTotal: 4500,
          paidTotal: 5000,
          outstandingTotal: 4000,
          collectionRatePct: 56,
        },
        collection: {
          expenseTotal: 14000,
          targetTotal: 14000,
          chargedTotal: 4500,
          paidTotal: 5000,
          undistributedTotal: 9500,
          remainingToCollect: 9000,
          overpaidTotal: 0,
          membersCharged: 3,
          membersPaid: 2,
          state: "NEEDS_DISTRIBUTION",
        },
        participants: [
          {
            userId: "user-1",
            name: "Иванов",
            nickname: "ivanov",
            amountDue: 1500,
            amountPaid: 0,
            amountOutstanding: 1500,
            chargeStatus: "PENDING",
          },
          {
            userId: "user-2",
            name: "Петров",
            nickname: "petrov",
            amountDue: 1500,
            amountPaid: 1500,
            amountOutstanding: 0,
            chargeStatus: "PAID",
          },
          {
            userId: "user-3",
            name: "Сидоров",
            nickname: "sidorov",
            amountDue: 1500,
            amountPaid: 3500,
            amountOutstanding: 0,
            chargeStatus: "PAID",
          },
        ],
        payments: [
          {
            transactionId: "tx-1",
            date: "2026-04-05T10:00:00.000Z",
            type: TransactionType.DEPOSIT,
            title: "Сбор на турнир",
            amount: 5000,
            payerName: "Команда",
            status: "COMPLETED",
            allocations: [{ userId: "user-2", amount: 1500 }],
          },
          {
            transactionId: "tx-2",
            date: "2026-04-05T11:00:00.000Z",
            type: TransactionType.EXPENSE,
            title: "Шары и взнос",
            amount: 14000,
            payerName: "Команда",
            status: "COMPLETED",
            allocations: [],
          },
        ],
      },
    });

    expect(model.canManage).toBe(true);
    expect(model.collectionStatusLabel).toBe("Нужно распределить");
    expect(model.summaryCards.map((item) => `${item.label}:${item.value}`)).toEqual([
      "Потрачено:14 000 ₽",
      "Собрано:5 000 ₽",
      "Осталось собрать:9 000 ₽",
      "Участников в сборе:3",
    ]);
    expect(model.collectionCards.map((item) => `${item.label}:${item.value}`)).toEqual([
      "Расходы:14 000 ₽",
      "Начислено:4 500 ₽",
      "Не распределено:9 500 ₽",
      "Собрано:5 000 ₽",
      "Осталось собрать:9 000 ₽",
    ]);
    expect(model.primaryCtaLabel).toBe("Открыть сбор");
    expect(model.debtors).toHaveLength(1);
    expect(model.primaryActions).toEqual(["Зачесть перевод", "Напомнить должникам", "Добавить расход", "Доначислить"]);
  });

  it("shows collection creation state when no charges exist yet", () => {
    const model = buildEventFinanceViewModel({
      currentUserRole: Role.CAPTAIN,
      detail: {
        event: {
          id: "event-1",
          title: "Весенний турнир",
          type: "TOURNAMENT",
          startDate: "2026-04-06T10:00:00.000Z",
          cost: 0,
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
          expenseTotal: 14000,
          targetTotal: 14000,
          chargedTotal: 0,
          paidTotal: 0,
          undistributedTotal: 14000,
          remainingToCollect: 14000,
          overpaidTotal: 0,
          membersCharged: 0,
          membersPaid: 0,
          state: "NEEDS_DISTRIBUTION",
        },
        participants: [],
        payments: [
          {
            transactionId: "tx-2",
            date: "2026-04-05T11:00:00.000Z",
            type: TransactionType.EXPENSE,
            title: "Шары и взнос",
            amount: 14000,
            payerName: "Команда",
            status: "COMPLETED",
            allocations: [],
          },
        ],
      },
    });

    expect(model.canManage).toBe(true);
    expect(model.collectionStatusLabel).toBe("Нужно распределить");
    expect(model.primaryCtaLabel).toBe("Открыть сбор");
    expect(model.summaryCards.map((item) => `${item.label}:${item.value}`)).toEqual([
      "Потрачено:14 000 ₽",
      "Собрано:0 ₽",
      "Осталось собрать:14 000 ₽",
      "Участников в сборе:0",
    ]);
  });
});
