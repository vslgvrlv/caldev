import { describe, expect, it } from "vitest";
import { buildEventCollectionProjection, buildEventCollectionProjectionForAudience } from "../../lib/event-collection.js";

describe("buildEventCollectionProjection", () => {
  it("returns undistributed collection target when expenses exist but charges do not", () => {
    const projection = buildEventCollectionProjection({
      expenseTotal: 3600,
      charges: [],
    });

    expect(projection).toEqual({
      expenseTotal: 3600,
      collectionTargetTotal: 3600,
      chargedTotal: 0,
      paidTotal: 0,
      undistributedTotal: 3600,
      remainingToCollect: 3600,
      overpaidTotal: 0,
      membersCharged: 0,
      membersPaid: 0,
      state: "NEEDS_DISTRIBUTION",
    });
  });

  it("keeps a delta when charges cover only part of the expense total", () => {
    const projection = buildEventCollectionProjection({
      expenseTotal: 3600,
      charges: [
        { amountDue: 1200, amountPaid: 0 },
        { amountDue: 600, amountPaid: 0 },
      ],
    });

    expect(projection).toEqual({
      expenseTotal: 3600,
      collectionTargetTotal: 3600,
      chargedTotal: 1800,
      paidTotal: 0,
      undistributedTotal: 1800,
      remainingToCollect: 3600,
      overpaidTotal: 0,
      membersCharged: 2,
      membersPaid: 0,
      state: "NEEDS_DISTRIBUTION",
    });
  });

  it("moves to collecting once the full target is distributed but not yet fully paid", () => {
    const projection = buildEventCollectionProjection({
      expenseTotal: 3600,
      charges: [
        { amountDue: 1200, amountPaid: 600 },
        { amountDue: 1200, amountPaid: 1200 },
        { amountDue: 1200, amountPaid: 0 },
      ],
    });

    expect(projection).toEqual({
      expenseTotal: 3600,
      collectionTargetTotal: 3600,
      chargedTotal: 3600,
      paidTotal: 1800,
      undistributedTotal: 0,
      remainingToCollect: 1800,
      overpaidTotal: 0,
      membersCharged: 3,
      membersPaid: 1,
      state: "COLLECTING",
    });
  });

  it("marks the collection as collected when paid amount matches the target", () => {
    const projection = buildEventCollectionProjection({
      expenseTotal: 3600,
      charges: [
        { amountDue: 1200, amountPaid: 1200 },
        { amountDue: 1200, amountPaid: 1200 },
        { amountDue: 1200, amountPaid: 1200 },
      ],
    });

    expect(projection).toEqual({
      expenseTotal: 3600,
      collectionTargetTotal: 3600,
      chargedTotal: 3600,
      paidTotal: 3600,
      undistributedTotal: 0,
      remainingToCollect: 0,
      overpaidTotal: 0,
      membersCharged: 3,
      membersPaid: 3,
      state: "COLLECTED",
    });
  });

  it("reopens into undistributed state when a new expense appears after the event was collected", () => {
    const projection = buildEventCollectionProjection({
      expenseTotal: 4500,
      charges: [
        { amountDue: 1200, amountPaid: 1200 },
        { amountDue: 1200, amountPaid: 1200 },
        { amountDue: 1200, amountPaid: 1200 },
      ],
    });

    expect(projection).toEqual({
      expenseTotal: 4500,
      collectionTargetTotal: 4500,
      chargedTotal: 3600,
      paidTotal: 3600,
      undistributedTotal: 900,
      remainingToCollect: 900,
      overpaidTotal: 0,
      membersCharged: 3,
      membersPaid: 3,
      state: "NEEDS_DISTRIBUTION",
    });
  });

  it("surfaces explicit overpayment when target is reduced below already paid amount", () => {
    const projection = buildEventCollectionProjection({
      expenseTotal: 3000,
      charges: [
        { amountDue: 1000, amountPaid: 1200 },
        { amountDue: 1000, amountPaid: 1200 },
        { amountDue: 1000, amountPaid: 1200 },
      ],
    });

    expect(projection).toEqual({
      expenseTotal: 3000,
      collectionTargetTotal: 3000,
      chargedTotal: 3000,
      paidTotal: 3600,
      undistributedTotal: 0,
      remainingToCollect: 0,
      overpaidTotal: 600,
      membersCharged: 3,
      membersPaid: 3,
      state: "OVERPAID",
    });
  });

  it("ignores captain rows when building collection projection for finance audience", () => {
    const projection = buildEventCollectionProjectionForAudience({
      expenseTotal: 3000,
      charges: [
        { role: "CAPTAIN", amountDue: 999, amountPaid: 999 },
        { role: "PLAYER", amountDue: 1000, amountPaid: 500 },
        { role: "TRAINER", amountDue: 1000, amountPaid: 1000 },
        { role: "PLAYER", amountDue: 1000, amountPaid: 0 },
      ],
    });

    expect(projection).toEqual({
      expenseTotal: 3000,
      collectionTargetTotal: 3000,
      chargedTotal: 3000,
      paidTotal: 1500,
      undistributedTotal: 0,
      remainingToCollect: 1500,
      overpaidTotal: 0,
      membersCharged: 3,
      membersPaid: 1,
      state: "COLLECTING",
    });
  });
});
