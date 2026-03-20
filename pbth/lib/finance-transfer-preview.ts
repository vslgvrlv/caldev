type TransferDebtItem = {
  eventId: string;
  title: string;
  date: string;
  outstanding: number;
};

export function buildTransferAllocationPreview(params: {
  amount: number;
  debts: TransferDebtItem[];
  preferredEventId?: string;
}) {
  const totalOutstanding = params.debts.reduce((sum, debt) => sum + Number(debt.outstanding || 0), 0);
  let remaining = Number(params.amount || 0);
  const items: Array<{
    eventId: string;
    title: string;
    outstanding: number;
    allocated: number;
    remainingAfterAllocation: number;
  }> = [];

  const orderedDebts = [...params.debts]
    .filter((debt) => Number(debt.outstanding || 0) > 0)
    .sort((a, b) => {
      const aPreferred = params.preferredEventId && a.eventId === params.preferredEventId ? 1 : 0;
      const bPreferred = params.preferredEventId && b.eventId === params.preferredEventId ? 1 : 0;
      if (aPreferred !== bPreferred) return bPreferred - aPreferred;
      return Date.parse(a.date) - Date.parse(b.date) || a.title.localeCompare(b.title, "ru");
    });

  for (const debt of orderedDebts) {
    if (remaining <= 0) break;
    const outstanding = Number(debt.outstanding || 0);
    const allocated = Math.min(outstanding, remaining);
    if (allocated <= 0) continue;
    items.push({
      eventId: debt.eventId,
      title: debt.title,
      outstanding,
      allocated,
      remainingAfterAllocation: Number((outstanding - allocated).toFixed(2)),
    });
    remaining = Number((remaining - allocated).toFixed(2));
  }

  return {
    totalOutstanding: Number(totalOutstanding.toFixed(2)),
    allocatedTotal: Number((Number(params.amount || 0) - remaining).toFixed(2)),
    leftoverAmount: Math.max(0, Number(remaining.toFixed(2))),
    items,
  };
}
