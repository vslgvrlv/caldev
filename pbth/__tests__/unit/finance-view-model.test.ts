import { describe, expect, it } from "vitest";
import {
  ALL_TEAMS_FINANCE_FILTER,
  buildFinanceFilterOptions,
  buildFinanceTeamOptions,
  buildFinanceViewModel,
} from "../../lib/finance-view-model";
import { Role } from "../../types";

describe("finance view model", () => {
  describe("buildFinanceFilterOptions", () => {
    it("prepends all teams option for players", () => {
      const options = buildFinanceFilterOptions({
        teams: [
          { membershipId: "m1", teamId: "team-1", teamName: "Alpha", shortCode: "ALP", role: Role.PLAYER },
          { membershipId: "m2", teamId: "team-2", teamName: "Bravo", shortCode: "BRV", role: Role.PLAYER },
        ],
        currentUserRole: Role.PLAYER,
        selectedTeamId: ALL_TEAMS_FINANCE_FILTER,
      });

      expect(options.map((option) => option.value)).toEqual([
        ALL_TEAMS_FINANCE_FILTER,
        "team-1",
        "team-2",
      ]);
      expect(options[0]).toMatchObject({
        label: "Все команды",
        isActive: true,
      });
    });

    it("keeps captains team-scoped without synthetic all teams option", () => {
      const options = buildFinanceFilterOptions({
        teams: [
          { membershipId: "m2", teamId: "team-2", teamName: "Bravo", shortCode: "BRV", role: Role.CAPTAIN },
          { membershipId: "m1", teamId: "team-1", teamName: "Alpha", shortCode: "ALP", role: Role.CAPTAIN },
        ],
        currentUserRole: Role.CAPTAIN,
        selectedTeamId: "team-2",
      });

      expect(options.map((option) => option.value)).toEqual(["team-1", "team-2"]);
      expect(options.some((option) => option.value === ALL_TEAMS_FINANCE_FILTER)).toBe(false);
      expect(options.find((option) => option.value === "team-2")?.isActive).toBe(true);
    });
  });

  describe("buildFinanceTeamOptions", () => {
    it("keeps the active team first and preserves membership ids", () => {
      const options = buildFinanceTeamOptions(
        [
          { membershipId: "m2", teamId: "team-2", teamName: "Bravo", shortCode: "BRV", role: Role.PLAYER },
          { membershipId: "m1", teamId: "team-1", teamName: "Alpha", shortCode: "ALP", role: Role.CAPTAIN },
        ],
        "team-1"
      );

      expect(options).toEqual([
        { membershipId: "m1", teamId: "team-1", label: "Alpha", badge: "ALP", role: Role.CAPTAIN, isActive: true },
        { membershipId: "m2", teamId: "team-2", label: "Bravo", badge: "BRV", role: Role.PLAYER, isActive: false },
      ]);
    });
  });

  describe("buildFinanceViewModel", () => {
    it("builds captain mode with pending confirmation counter", () => {
      const model = buildFinanceViewModel({
        currentUserRole: Role.CAPTAIN,
        activeTeamName: "Alpha",
        summary: { balance: 15000, totalOutstanding: 4200, overdueCount: 3, pendingConfirmations: 2 },
        debtors: [{ userId: "u1", name: "Иванов", debt: 2800 }],
        confirmations: [
          { id: "c1", status: "PENDING_REVIEW", amount: 1500, userName: "Петров" },
          { id: "c2", status: "APPROVED", amount: 800, userName: "Сидоров" },
        ],
      });

      expect(model.mode).toBe("CAPTAIN");
      expect(model.heroCards.map((card) => card.value)).toEqual(["4 200 ₽", "3", "2"]);
      expect(model.attentionItems[0]).toContain("2");
      expect(model.pendingReview.length).toBe(1);
    });

    it("builds player mode with only own open debt and submitted confirmations", () => {
      const model = buildFinanceViewModel({
        currentUserRole: Role.PLAYER,
        activeTeamName: "Bravo",
        summary: { totalOutstanding: 1900, overdueCount: 1, pendingConfirmations: 1 },
        debtors: [],
        confirmations: [
          { id: "c1", status: "PENDING_REVIEW", amount: 1000, userName: "Я" },
          { id: "c2", status: "REJECTED", amount: 500, userName: "Я" },
        ],
      });

      expect(model.mode).toBe("PLAYER");
      expect(model.heroCards.map((card) => card.value)).toEqual(["1 900 ₽", "1", "1"]);
      expect(model.attentionItems[0]).toContain("Bravo");
      expect(model.pendingReview).toEqual([{ id: "c1", status: "PENDING_REVIEW", amount: 1000, userName: "Я" }]);
    });
  });
});
