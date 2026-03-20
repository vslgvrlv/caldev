import { Role, TransactionType } from "../types";

type EventFinanceDetail = {
  event: {
    id: string;
    title: string;
    type: string;
    startDate: string;
    cost?: number;
    costStatus?: "UNKNOWN" | "ESTIMATED" | "FINAL";
    financeState: "NOT_CALCULATED" | "COLLECTING" | "CLOSED";
  };
  summary: {
    chargedTotal: number;
    paidTotal: number;
    outstandingTotal: number;
    collectionRatePct: number;
  };
  collection?: {
    expenseTotal: number;
    targetTotal: number;
    chargedTotal: number;
    paidTotal: number;
    undistributedTotal: number;
    remainingToCollect: number;
    overpaidTotal: number;
    membersCharged: number;
    membersPaid: number;
    state: "EMPTY" | "NEEDS_DISTRIBUTION" | "COLLECTING" | "COLLECTED" | "OVERPAID";
  };
  participants: Array<{
    userId: string;
    name: string;
    nickname?: string;
    amountDue: number;
    amountPaid: number;
    amountOutstanding: number;
    chargeStatus: "PENDING" | "PARTIAL" | "PAID";
  }>;
  payments: Array<{
    transactionId: string;
    date: string;
    type: TransactionType;
    title: string;
    amount: number;
    payerName?: string;
    status: "PENDING" | "COMPLETED";
    allocations: Array<{ userId: string; amount: number }>;
  }>;
};

type EventFinanceCard = {
  label: string;
  value: string;
};

export function buildEventFinanceViewModel(params: {
  currentUserRole: Role;
  detail: EventFinanceDetail;
}) {
  const canManage = params.currentUserRole === Role.CAPTAIN || params.currentUserRole === Role.ADMIN;
  const chargedParticipants = params.detail.participants.filter((item) => Number(item.amountDue || 0) > 0);
  const fallbackExpenseTotal = params.detail.payments
    .filter((item) => item.type === TransactionType.EXPENSE && item.status === "COMPLETED")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const collection = params.detail.collection;
  const expenseTotal = Number(collection?.expenseTotal ?? fallbackExpenseTotal);
  const chargedTotal = Number(collection?.chargedTotal ?? params.detail.summary.chargedTotal);
  const paidTotal = Number(collection?.paidTotal ?? params.detail.summary.paidTotal);
  const remainingToCollect = Number(collection?.remainingToCollect ?? params.detail.summary.outstandingTotal);
  const undistributedTotal = Number(collection?.undistributedTotal ?? 0);
  const chargedMembers = Number(collection?.membersCharged ?? chargedParticipants.length);
  const hasCollectionWorkspace = expenseTotal > 0 || chargedTotal > 0;

  return {
    canManage,
    collectionStatusLabel: getCollectionStatusLabel(collection?.state, params.detail.event.financeState),
    summaryCards: [
      { label: "Потрачено", value: formatRub(expenseTotal) },
      { label: "Собрано", value: formatRub(paidTotal) },
      { label: "Осталось собрать", value: formatRub(remainingToCollect) },
      { label: "Участников в сборе", value: String(chargedMembers) },
    ] satisfies EventFinanceCard[],
    collectionCards: [
      { label: "Расходы", value: formatRub(expenseTotal) },
      { label: "Начислено", value: formatRub(chargedTotal) },
      { label: "Не распределено", value: formatRub(undistributedTotal) },
      { label: "Собрано", value: formatRub(paidTotal) },
      { label: "Осталось собрать", value: formatRub(remainingToCollect) },
    ] satisfies EventFinanceCard[],
    primaryCtaLabel: hasCollectionWorkspace ? "Открыть сбор" : "Создать сбор",
    primaryActions: canManage ? ["Зачесть перевод", "Напомнить должникам", "Добавить расход", "Доначислить"] : [],
    debtors: params.detail.participants
      .filter((item) => item.amountOutstanding > 0)
      .sort((a, b) => b.amountOutstanding - a.amountOutstanding || a.name.localeCompare(b.name, "ru")),
    expenses: params.detail.payments
      .filter((item) => item.type === TransactionType.EXPENSE)
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date)),
    recentOperations: [...params.detail.payments].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)),
  };
}

function formatRub(value: number): string {
  return `${Number(value || 0).toLocaleString("ru-RU").replace(/\u00A0/g, " ")} ₽`;
}

function getCollectionStatusLabel(
  collectionState: NonNullable<EventFinanceDetail["collection"]>["state"] | undefined,
  legacyState: EventFinanceDetail["event"]["financeState"]
): string {
  if (collectionState === "NEEDS_DISTRIBUTION") return "Нужно распределить";
  if (collectionState === "COLLECTING") return "Сбор идет";
  if (collectionState === "COLLECTED") return "Собран";
  if (collectionState === "OVERPAID") return "Есть переплата";
  if (legacyState === "COLLECTING") return "Сбор идет";
  if (legacyState === "CLOSED") return "Собран";
  return "Сбор не создан";
}
