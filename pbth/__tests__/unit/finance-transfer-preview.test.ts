import { describe, expect, it } from "vitest";
import { buildTransferAllocationPreview } from "../../lib/finance-transfer-preview";

describe("buildTransferAllocationPreview", () => {
  it("allocates against the oldest open debts first", () => {
    const preview = buildTransferAllocationPreview({
      amount: 2000,
      debts: [
        { eventId: "event-2", title: "Alpha Cup", date: "2026-03-21T10:00:00.000Z", outstanding: 1200 },
        { eventId: "event-1", title: "Взнос марта", date: "2026-03-10T10:00:00.000Z", outstanding: 800 },
        { eventId: "event-3", title: "Форма", date: "2026-03-25T10:00:00.000Z", outstanding: 500 },
      ],
    });

    expect(preview.totalOutstanding).toBe(2500);
    expect(preview.allocatedTotal).toBe(2000);
    expect(preview.leftoverAmount).toBe(0);
    expect(preview.items).toEqual([
      { eventId: "event-1", title: "Взнос марта", outstanding: 800, allocated: 800, remainingAfterAllocation: 0 },
      { eventId: "event-2", title: "Alpha Cup", outstanding: 1200, allocated: 1200, remainingAfterAllocation: 0 },
    ]);
  });

  it("keeps leftover amount when payment exceeds open debt", () => {
    const preview = buildTransferAllocationPreview({
      amount: 3000,
      debts: [
        { eventId: "event-1", title: "Взнос марта", date: "2026-03-10T10:00:00.000Z", outstanding: 800 },
        { eventId: "event-2", title: "Alpha Cup", date: "2026-03-21T10:00:00.000Z", outstanding: 1200 },
      ],
    });

    expect(preview.totalOutstanding).toBe(2000);
    expect(preview.allocatedTotal).toBe(2000);
    expect(preview.leftoverAmount).toBe(1000);
    expect(preview.items).toEqual([
      { eventId: "event-1", title: "Взнос марта", outstanding: 800, allocated: 800, remainingAfterAllocation: 0 },
      { eventId: "event-2", title: "Alpha Cup", outstanding: 1200, allocated: 1200, remainingAfterAllocation: 0 },
    ]);
  });

  it("supports partial covering of the oldest debt", () => {
    const preview = buildTransferAllocationPreview({
      amount: 500,
      debts: [
        { eventId: "event-1", title: "Взнос марта", date: "2026-03-10T10:00:00.000Z", outstanding: 800 },
        { eventId: "event-2", title: "Alpha Cup", date: "2026-03-21T10:00:00.000Z", outstanding: 1200 },
      ],
    });

    expect(preview.totalOutstanding).toBe(2000);
    expect(preview.allocatedTotal).toBe(500);
    expect(preview.leftoverAmount).toBe(0);
    expect(preview.items).toEqual([
      { eventId: "event-1", title: "Взнос марта", outstanding: 800, allocated: 500, remainingAfterAllocation: 300 },
    ]);
  });

  it("prioritizes the preferred event in event context before older debts", () => {
    const preview = buildTransferAllocationPreview({
      amount: 1000,
      preferredEventId: "event-2",
      debts: [
        { eventId: "event-1", title: "Взнос марта", date: "2026-03-10T10:00:00.000Z", outstanding: 800 },
        { eventId: "event-2", title: "Alpha Cup", date: "2026-03-21T10:00:00.000Z", outstanding: 1200 },
        { eventId: "event-3", title: "Форма", date: "2026-03-25T10:00:00.000Z", outstanding: 500 },
      ],
    });

    expect(preview.totalOutstanding).toBe(2500);
    expect(preview.allocatedTotal).toBe(1000);
    expect(preview.leftoverAmount).toBe(0);
    expect(preview.items).toEqual([
      { eventId: "event-2", title: "Alpha Cup", outstanding: 1200, allocated: 1000, remainingAfterAllocation: 200 },
    ]);
  });
});
