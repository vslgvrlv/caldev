import { describe, expect, it } from "vitest";

process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
process.env.TELEGRAM_CALLBACK_URL =
  process.env.TELEGRAM_CALLBACK_URL || "http://127.0.0.1:8000/api/v1/auth/telegram/callback";

const { describeJournalRow, JOURNAL_ACTIONS } = await import("../../modules/platform/journal.js");
const { suggestShortCode } = await import("../../modules/platform/short-code.js");

const row = (action: string, payload: Record<string, unknown>, eventTitle: string | null = null) => ({
  id: "a1",
  action,
  payload,
  created_at: "2026-11-11T10:00:00Z",
  actor_name: "Вася",
  event_title: eventTitle,
});

describe("журнал команды", () => {
  it("действия — по-русски, с событием", () => {
    expect(describeJournalRow(row("events.create", { teamId: "t" }, "Спарринг"), "t")?.text).toBe("Создал событие «Спарринг»");
    expect(describeJournalRow(row("rsvp.update", { status: "DECLINED" }, "Спарринг"), "t")?.text).toBe("Не идёт на «Спарринг»");
    expect(describeJournalRow(row("finance.payment.create", { amount: 3000 }), "t")?.text).toBe("Записал оплату 3 000 ₽");
    expect(describeJournalRow(row("teams.invite.create", { role: "CAPTAIN" }), "t")?.text).toBe(
      "Выпустил приглашение для капитана"
    );
  });

  it("действие владельца помечено только в той команде, где он действовал", () => {
    const owner = row("events.update.single", { actorVia: "owner", ownerTeamIds: ["t"] }, "Тренировка");
    expect(describeJournalRow(owner, "t")?.byOwner).toBe(true);
    expect(describeJournalRow(owner, "other")?.byOwner).toBe(false);
  });

  it("служебные записи людям не показываются", () => {
    expect(describeJournalRow(row("auth.context.switch", { teamId: "t" }), "t")).toBeNull();
    expect(describeJournalRow(row("auth.account_role.select", {}), "t")).toBeNull();
    expect(JOURNAL_ACTIONS.some((action) => action.startsWith("auth."))).toBe(false);
  });
});

describe("короткий код команды из названия", () => {
  it("латиница, большие буквы, до 8 знаков", () => {
    expect(suggestShortCode("Дневной Дозор")).toBe("DNEDOZ");
    expect(suggestShortCode("Holy Guns")).toBe("HOLGUN");
    expect(suggestShortCode("Альфа")).toBe("ALFA");
    expect(suggestShortCode("Red Bull Team Moscow")).toBe("REDBULTM");
    expect(suggestShortCode("!!!")).toBe("TEAM");
  });
});
