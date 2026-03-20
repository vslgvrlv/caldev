import { describe, expect, it } from "vitest";
import { mergePlayerFinanceSnapshots } from "../../lib/finance-view-model";

describe("mergePlayerFinanceSnapshots", () => {
  it("aggregates player debts and confirmations across teams", () => {
    const merged = mergePlayerFinanceSnapshots([
      {
        teamId: "team-1",
        teamName: "Alpha",
        summary: { totalDue: 1500, totalPaid: 500, outstanding: 1000, eventsWithDebt: 1 },
        eventDebts: [
          {
            eventId: "event-1",
            title: "Alpha Cup",
            date: "2026-03-10T10:00:00.000Z",
            amountDue: 1500,
            amountPaid: 500,
            outstanding: 1000,
            chargeStatus: "PARTIAL" as const,
          },
        ],
        confirmations: [
          {
            id: "c-1",
            teamId: "team-1",
            userId: "user-1",
            userName: "Игрок",
            amount: 500,
            screenshotDataUrl: "data:image/png;base64,AAA=",
            status: "PENDING_REVIEW" as const,
            submittedAt: "2026-03-12T10:00:00.000Z",
            submittedBy: { userId: "user-1" },
          },
        ],
      },
      {
        teamId: "team-2",
        teamName: "Bravo",
        summary: { totalDue: 800, totalPaid: 0, outstanding: 800, eventsWithDebt: 1 },
        eventDebts: [
          {
            eventId: "event-2",
            title: "Bravo League",
            date: "2026-03-15T10:00:00.000Z",
            amountDue: 800,
            amountPaid: 0,
            outstanding: 800,
            chargeStatus: "PENDING" as const,
          },
        ],
        confirmations: [],
      },
    ]);

    expect(merged.summary).toEqual({
      totalDue: 2300,
      totalPaid: 500,
      outstanding: 1800,
      eventsWithDebt: 2,
      pendingConfirmations: 1,
    });
    expect(merged.eventDebts.map((item) => item.teamName)).toEqual(["Bravo", "Alpha"]);
    expect(merged.confirmations).toHaveLength(1);
  });
});
