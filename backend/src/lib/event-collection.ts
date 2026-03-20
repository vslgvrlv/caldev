export type EventCollectionChargeRow = {
  amountDue: number;
  amountPaid: number;
};

export type EventCollectionAudienceChargeRow = EventCollectionChargeRow & {
  role?: "ADMIN" | "CAPTAIN" | "TRAINER" | "PLAYER";
};

export type EventCollectionProjectionState =
  | "EMPTY"
  | "NEEDS_DISTRIBUTION"
  | "COLLECTING"
  | "COLLECTED"
  | "OVERPAID";

export type EventCollectionProjection = {
  expenseTotal: number;
  collectionTargetTotal: number;
  chargedTotal: number;
  paidTotal: number;
  undistributedTotal: number;
  remainingToCollect: number;
  overpaidTotal: number;
  membersCharged: number;
  membersPaid: number;
  state: EventCollectionProjectionState;
};

export function buildEventCollectionProjection(params: {
  expenseTotal: number;
  adjustmentTotal?: number;
  charges: EventCollectionChargeRow[];
}): EventCollectionProjection {
  const expenseTotal = roundMoney(params.expenseTotal);
  const collectionTargetTotal = roundMoney(expenseTotal + Number(params.adjustmentTotal || 0));
  const chargedTotal = roundMoney(params.charges.reduce((sum, row) => sum + Number(row.amountDue || 0), 0));
  const paidTotal = roundMoney(params.charges.reduce((sum, row) => sum + Number(row.amountPaid || 0), 0));
  const undistributedTotal = roundMoney(Math.max(collectionTargetTotal - chargedTotal, 0));
  const remainingToCollect = roundMoney(Math.max(collectionTargetTotal - paidTotal, 0));
  const overpaidTotal = roundMoney(Math.max(paidTotal - collectionTargetTotal, 0));
  const membersCharged = params.charges.filter((row) => Number(row.amountDue || 0) > 0).length;
  const membersPaid = params.charges.filter((row) => Number(row.amountDue || 0) > 0 && Number(row.amountPaid || 0) >= Number(row.amountDue || 0)).length;

  let state: EventCollectionProjectionState = "EMPTY";
  if (collectionTargetTotal > 0 && overpaidTotal > 0) {
    state = "OVERPAID";
  } else if (collectionTargetTotal > 0 && undistributedTotal > 0) {
    state = "NEEDS_DISTRIBUTION";
  } else if (collectionTargetTotal > 0 && remainingToCollect > 0) {
    state = "COLLECTING";
  } else if (collectionTargetTotal > 0) {
    state = "COLLECTED";
  }

  return {
    expenseTotal,
    collectionTargetTotal,
    chargedTotal,
    paidTotal,
    undistributedTotal,
    remainingToCollect,
    overpaidTotal,
    membersCharged,
    membersPaid,
    state,
  };
}

export function buildEventCollectionProjectionForAudience(params: {
  expenseTotal: number;
  adjustmentTotal?: number;
  charges: EventCollectionAudienceChargeRow[];
}): EventCollectionProjection {
  return buildEventCollectionProjection({
    expenseTotal: params.expenseTotal,
    adjustmentTotal: params.adjustmentTotal,
    charges: params.charges
      .filter((row) => row.role !== "CAPTAIN" && row.role !== "ADMIN")
      .map((row) => ({
        amountDue: Number(row.amountDue || 0),
        amountPaid: Number(row.amountPaid || 0),
      })),
  });
}

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(2));
}
