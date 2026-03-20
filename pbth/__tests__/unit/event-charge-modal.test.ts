import { describe, expect, it } from "vitest";
import { buildEventChargeModalState } from "../../lib/event-charge-modal";

describe("buildEventChargeModalState", () => {
  it("blocks submit when there is no eligible player audience", () => {
    const state = buildEventChargeModalState({
      participants: [
        { userId: "captain-1", role: "CAPTAIN", rsvpStatus: "CONFIRMED", amountDue: 0 },
        { userId: "captain-2", role: "CAPTAIN", rsvpStatus: "PENDING", amountDue: 0 },
      ],
      audience: "CONFIRMED_ONLY",
      amountMode: "UNDISTRIBUTED_SPLIT",
      undistributedAmount: 2400,
      fixedAmount: "",
    });

    expect(state.eligibleParticipants).toHaveLength(0);
    expect(state.canSubmit).toBe(false);
    expect(state.blockingReason).toContain("Нет игроков");
    expect(state.preview).toContain("Нет подходящих участников");
  });

  it("builds split preview for eligible confirmed players", () => {
    const state = buildEventChargeModalState({
      participants: [
        { userId: "player-1", role: "PLAYER", rsvpStatus: "CONFIRMED", amountDue: 0 },
        { userId: "player-2", role: "PLAYER", rsvpStatus: "CONFIRMED", amountDue: 0 },
        { userId: "trainer-1", role: "TRAINER", rsvpStatus: "PENDING", amountDue: 0 },
      ],
      audience: "CONFIRMED_ONLY",
      amountMode: "UNDISTRIBUTED_SPLIT",
      undistributedAmount: 3000,
      fixedAmount: "",
    });

    expect(state.eligibleParticipants.map((item) => item.userId)).toEqual(["player-1", "player-2"]);
    expect(state.canSubmit).toBe(true);
    expect(state.preview.replace(/\u00A0/g, " ")).toContain("2 участникам по 1 500");
  });

  it("blocks fixed-per-person submit when every eligible participant is already charged", () => {
    const state = buildEventChargeModalState({
      participants: [
        { userId: "player-1", role: "PLAYER", rsvpStatus: "CONFIRMED", amountDue: 1200 },
        { userId: "player-2", role: "PLAYER", rsvpStatus: "CONFIRMED", amountDue: 1200 },
      ],
      audience: "CONFIRMED_ONLY",
      amountMode: "FIXED_PER_PERSON",
      undistributedAmount: 0,
      fixedAmount: "1200",
    });

    expect(state.canSubmit).toBe(false);
    expect(state.blockingReason).toContain("уже есть начисления");
  });

  it("counts only new participants in fixed-per-person preview when collection is already active", () => {
    const state = buildEventChargeModalState({
      participants: [
        { userId: "player-1", role: "PLAYER", rsvpStatus: "CONFIRMED", amountDue: 1200 },
        { userId: "player-2", role: "PLAYER", rsvpStatus: "CONFIRMED", amountDue: 0 },
        { userId: "player-3", role: "PLAYER", rsvpStatus: "CONFIRMED", amountDue: 0 },
      ],
      audience: "CONFIRMED_ONLY",
      amountMode: "FIXED_PER_PERSON",
      undistributedAmount: 0,
      fixedAmount: "1200",
    });

    expect(state.canSubmit).toBe(true);
    expect(state.preview.replace(/\u00A0/g, " ")).toContain("2 участникам по 1 200");
  });
});
