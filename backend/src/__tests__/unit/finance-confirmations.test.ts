import { describe, expect, it } from "vitest";
import {
  filterAutoEventChargeMembers,
  filterFinanceMembersForActor,
  isTransferScreenshotDataUrl,
  planTransferConfirmationAllocations,
  resolveFinanceAccessFromMemberships,
  validateEventChargeGeneration,
} from "../../lib/finance-confirmations.js";

describe("finance confirmations helpers", () => {
  describe("isTransferScreenshotDataUrl", () => {
    it("accepts supported screenshot data URLs", () => {
      expect(isTransferScreenshotDataUrl("data:image/png;base64,AAA=")).toBe(true);
      expect(isTransferScreenshotDataUrl("data:image/jpeg;base64,BBB=")).toBe(true);
      expect(isTransferScreenshotDataUrl("data:image/webp;base64,CCC=")).toBe(true);
    });

    it("rejects unsupported or malformed data URLs", () => {
      expect(isTransferScreenshotDataUrl("data:text/plain;base64,AAA=")).toBe(false);
      expect(isTransferScreenshotDataUrl("https://example.com/image.png")).toBe(false);
      expect(isTransferScreenshotDataUrl("data:image/png,not-base64")).toBe(false);
    });
  });

  describe("planTransferConfirmationAllocations", () => {
    it("allocates approved amount to oldest outstanding charges first", () => {
      const allocations = planTransferConfirmationAllocations(
        [
          { chargeId: "charge-2", eventId: "event-2", outstanding: 700, startAt: "2026-03-20T10:00:00.000Z" },
          { chargeId: "charge-1", eventId: "event-1", outstanding: 400, startAt: "2026-03-10T10:00:00.000Z" },
          { chargeId: "charge-3", eventId: "event-3", outstanding: 300, startAt: "2026-03-25T10:00:00.000Z" },
        ],
        900
      );

      expect(allocations).toEqual([
        { chargeId: "charge-1", eventId: "event-1", amount: 400 },
        { chargeId: "charge-2", eventId: "event-2", amount: 500 },
      ]);
    });

    it("prioritizes the preferred event before older debts when event context is supplied", () => {
      const allocations = planTransferConfirmationAllocations(
        [
          { chargeId: "charge-2", eventId: "event-2", outstanding: 700, startAt: "2026-03-20T10:00:00.000Z" },
          { chargeId: "charge-1", eventId: "event-1", outstanding: 400, startAt: "2026-03-10T10:00:00.000Z" },
          { chargeId: "charge-3", eventId: "event-3", outstanding: 300, startAt: "2026-03-25T10:00:00.000Z" },
        ],
        900,
        "event-2"
      );

      expect(allocations).toEqual([
        { chargeId: "charge-2", eventId: "event-2", amount: 700 },
        { chargeId: "charge-1", eventId: "event-1", amount: 200 },
      ]);
    });

    it("skips zero-balance rows and stops after full allocation", () => {
      const allocations = planTransferConfirmationAllocations(
        [
          { chargeId: "charge-1", eventId: "event-1", outstanding: 0, startAt: "2026-03-01T10:00:00.000Z" },
          { chargeId: "charge-2", eventId: "event-2", outstanding: 150, startAt: "2026-03-02T10:00:00.000Z" },
        ],
        150
      );

      expect(allocations).toEqual([{ chargeId: "charge-2", eventId: "event-2", amount: 150 }]);
    });
  });

  describe("filterFinanceMembersForActor", () => {
    const rows = [
      { userId: "user-1", outstanding: 1200, overpaid: 0 },
      { userId: "user-2", outstanding: 300, overpaid: 0 },
    ];

    it("keeps all team members for captains", () => {
      expect(filterFinanceMembersForActor(rows, { actorRole: "CAPTAIN", actorUserId: "user-1" })).toEqual(rows);
    });

    it("keeps only own finance row for players", () => {
      expect(filterFinanceMembersForActor(rows, { actorRole: "PLAYER", actorUserId: "user-2" })).toEqual([
        { userId: "user-2", outstanding: 300, overpaid: 0 },
      ]);
    });
  });

  describe("resolveFinanceAccessFromMemberships", () => {
    const memberships = [
      { teamId: "team-1", role: "PLAYER" as const, userId: "user-1" },
      { teamId: "team-2", role: "CAPTAIN" as const, userId: "user-1" },
    ];

    it("uses explicit team membership instead of active context when available", () => {
      const access = resolveFinanceAccessFromMemberships({
        accountRole: "USER",
        userId: "user-1",
        requestedTeamId: "team-2",
        activeContext: { membershipId: "m-1", teamId: "team-1", role: "PLAYER", userId: "user-1" },
        memberships,
      });

      expect(access).toEqual({
        userId: "user-1",
        teamId: "team-2",
        actorRole: "CAPTAIN",
        canWrite: true,
      });
    });

    it("falls back to active context when no explicit team is requested", () => {
      const access = resolveFinanceAccessFromMemberships({
        accountRole: "USER",
        userId: "user-1",
        activeContext: { membershipId: "m-1", teamId: "team-1", role: "PLAYER", userId: "user-1" },
        memberships,
      });

      expect(access).toEqual({
        userId: "user-1",
        teamId: "team-1",
        actorRole: "PLAYER",
        canWrite: false,
      });
    });
  });

  describe("filterAutoEventChargeMembers", () => {
    it("keeps only player collection audience for automatic event charge generation", () => {
      const rows = [
        { userId: "captain-1", role: "CAPTAIN" as const, existingAmountDue: 0 },
        { userId: "trainer-1", role: "TRAINER" as const, existingAmountDue: 1200 },
        { userId: "player-1", role: "PLAYER" as const, existingAmountDue: 1200 },
      ];

      expect(filterAutoEventChargeMembers(rows)).toEqual([
        { userId: "trainer-1", role: "TRAINER", existingAmountDue: 1200 },
        { userId: "player-1", role: "PLAYER", existingAmountDue: 1200 },
      ]);
    });
  });

  describe("validateEventChargeGeneration", () => {
    const partiallyChargedAudience = [
      { userId: "trainer-1", role: "TRAINER" as const, existingAmountDue: 1200 },
      { userId: "player-1", role: "PLAYER" as const, existingAmountDue: 1200 },
      { userId: "player-2", role: "PLAYER" as const, existingAmountDue: 1200 },
      { userId: "player-3", role: "PLAYER" as const, existingAmountDue: 0 },
    ];

    it("rejects total split regeneration when some selected participants already have charges", () => {
      expect(
        validateEventChargeGeneration({
          candidates: partiallyChargedAudience,
          amountType: "TOTAL_SPLIT",
          overwriteExisting: false,
        })
      ).toEqual({
        ok: false,
        code: "UNSAFE_TOTAL_SPLIT_REGENERATION",
        detail:
          "По событию уже есть начисления. Повторное распределение общей суммы исказит сбор. Используйте фиксированную сумму для новых участников или корректировку.",
        existingChargeCount: 3,
        missingChargeCount: 1,
        suggestedFixedAmount: 1200,
      });
    });

    it("allows undistributed split on top of an active collection with existing charges", () => {
      expect(
        validateEventChargeGeneration({
          candidates: partiallyChargedAudience,
          amountType: "UNDISTRIBUTED_SPLIT",
          overwriteExisting: false,
        })
      ).toEqual({
        ok: true,
        existingChargeCount: 3,
        missingChargeCount: 1,
        suggestedFixedAmount: 1200,
      });
    });

    it("allows fixed per person add-missing flow when existing charges are uniform", () => {
      expect(
        validateEventChargeGeneration({
          candidates: partiallyChargedAudience,
          amountType: "FIXED_PER_PERSON",
          fixedAmount: 1200,
          overwriteExisting: false,
        })
      ).toEqual({
        ok: true,
        existingChargeCount: 3,
        missingChargeCount: 1,
        suggestedFixedAmount: 1200,
      });
    });

    it("rejects fixed amount add-missing flow when it does not match the existing uniform charge", () => {
      expect(
        validateEventChargeGeneration({
          candidates: partiallyChargedAudience,
          amountType: "FIXED_PER_PERSON",
          fixedAmount: 2000,
          overwriteExisting: false,
        })
      ).toEqual({
        ok: false,
        code: "FIXED_AMOUNT_MISMATCH",
        detail:
          "По событию уже есть начисления по 1 200 ₽. Для новых участников используйте ту же сумму или создайте корректировку.",
        existingChargeCount: 3,
        missingChargeCount: 1,
        suggestedFixedAmount: 1200,
      });
    });

    it("allows undistributed split even when the full selected audience is already charged", () => {
      expect(
        validateEventChargeGeneration({
          candidates: partiallyChargedAudience.filter((item) => item.existingAmountDue > 0),
          amountType: "UNDISTRIBUTED_SPLIT",
          overwriteExisting: false,
        })
      ).toEqual({
        ok: true,
        existingChargeCount: 3,
        missingChargeCount: 0,
        suggestedFixedAmount: 1200,
      });
    });
  });
});
