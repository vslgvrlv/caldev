import { FinanceEventDetailResponse } from "../api";
import { Role, TransactionType } from "../types";

export function buildEventExpensesViewModel(params: {
  currentUserRole: Role;
  detail: FinanceEventDetailResponse;
}) {
  const canManage = params.currentUserRole === Role.CAPTAIN || params.currentUserRole === Role.ADMIN;
  const expenses = [...(params.detail.payments || [])]
    .filter((item) => item.type === TransactionType.EXPENSE)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const expenseTotal =
    params.detail.collection?.expenseTotal ??
    expenses.filter((item) => item.status === "COMPLETED").reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const collectionState = params.detail.collection?.state;
  const undistributedTotal = Number(params.detail.collection?.undistributedTotal || 0);
  const canOpenCollection = Number(expenseTotal || 0) > 0 || Number(params.detail.collection?.chargedTotal || 0) > 0;

  return {
    canManage,
    totalSpentLabel: formatRub(expenseTotal),
    expenseCountLabel: String(expenses.length),
    collectionStatusLabel: getCollectionStatusLabel(collectionState, params.detail.event.financeState),
    canOpenCollection,
    collectionActionLabel: canOpenCollection ? "Управлять сбором" : "Сбор появится после расходов",
    deltaHint: undistributedTotal > 0 ? `Не распределено: ${formatRub(undistributedTotal)}` : null,
    expenses,
  };
}

function formatRub(value: number): string {
  return `${Number(value || 0).toLocaleString("ru-RU").replace(/\u00A0/g, " ")} ₽`;
}

function getCollectionStatusLabel(
  collectionState: NonNullable<FinanceEventDetailResponse["collection"]>["state"] | undefined,
  legacyState: FinanceEventDetailResponse["event"]["financeState"]
): string {
  if (collectionState === "NEEDS_DISTRIBUTION") return "Нужно распределить";
  if (collectionState === "COLLECTING") return "Сбор идет";
  if (collectionState === "COLLECTED") return "Собран";
  if (collectionState === "OVERPAID") return "Есть переплата";
  if (legacyState === "COLLECTING") return "Сбор идет";
  if (legacyState === "CLOSED") return "Собран";
  return "Сбор не создан";
}
