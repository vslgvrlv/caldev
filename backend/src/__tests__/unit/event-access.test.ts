import { describe, expect, it } from "vitest";

process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
process.env.TELEGRAM_CALLBACK_URL =
  process.env.TELEGRAM_CALLBACK_URL || "http://127.0.0.1:8000/api/v1/auth/telegram/callback";

const { canManageEvent, teamRoleOf, registerEventAccessProvider, listEventAccessProviders } = await import(
  "../../lib/event-access.js"
);

const base = { eventId: "e", teamId: "t", membershipId: null, via: "membership", readOnly: false } as const;

describe("права в событии", () => {
  it("капитан и владелец правят всё, тренер — тренировки и собрания, игрок — ничего", () => {
    expect(canManageEvent({ ...base, role: "CAPTAIN" }, "TOURNAMENT")).toBe(true);
    expect(canManageEvent({ ...base, role: "CAPTAIN", via: "owner" }, "TOURNAMENT")).toBe(true);
    expect(canManageEvent({ ...base, role: "TRAINER" }, "TRAINING")).toBe(true);
    expect(canManageEvent({ ...base, role: "TRAINER" }, "TOURNAMENT")).toBe(false);
    expect(canManageEvent({ ...base, role: "PLAYER" }, "TRAINING")).toBe(false);
  });

  it("доступ только на чтение не даёт ни правки, ни командной роли", () => {
    const guest = { ...base, role: "CAPTAIN" as const, via: "guest", readOnly: true };
    expect(canManageEvent(guest, "TRAINING")).toBe(false);
    expect(teamRoleOf(guest)).toBeNull();
    expect(teamRoleOf(null)).toBeNull();
    expect(teamRoleOf({ ...base, role: "TRAINER" })).toBe("TRAINER");
  });

  it("поставщики регистрируются по имени и отключаются", () => {
    const first = registerEventAccessProvider({ name: "unit-guest", resolve: async () => null });
    registerEventAccessProvider({ name: "unit-guest", resolve: async () => null });
    expect(listEventAccessProviders().filter((name) => name === "unit-guest")).toHaveLength(1);
    first();
    // Отключение старого экземпляра не трогает заменивший его.
    expect(listEventAccessProviders()).toContain("unit-guest");
  });
});
