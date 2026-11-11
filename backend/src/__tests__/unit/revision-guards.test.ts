import { describe, expect, it } from "vitest";
import { checkProductionSecrets, DEV_DEFAULT_SECRETS, openApiForRequest, safeEqualSecret } from "../../lib/production-guards.js";
import { isHttpUrl, locationUrlSchema, safeHttpUrl } from "../../lib/http-url.js";
import { anonymizeEventSummary, anonymizeEventTable, reflectionScopeForRole } from "../../lib/reflection-visibility.js";
import { debtsOnlyBalance, financeScopeForRole } from "../../lib/finance-visibility.js";
import { sameBrowserAsState } from "../../lib/oauth-state.js";

describe("секреты в production", () => {
  it("значения по умолчанию из env.ts в production — отказ старта", () => {
    const res = checkProductionSecrets({ isProd: true, secrets: { ...DEV_DEFAULT_SECRETS } });
    expect(res.fatal).toHaveLength(2);
  });
  it("заглушки change-me — предупреждение, не отказ", () => {
    const res = checkProductionSecrets({
      isProd: true,
      secrets: { SESSION_SECRET: "change-me-session-secret", ICS_TOKEN_SECRET: "x".repeat(40) },
    });
    expect(res.fatal).toEqual([]);
    expect(res.warnings).toHaveLength(1);
  });
  it("вне production ничего не проверяется", () => {
    expect(checkProductionSecrets({ isProd: false, secrets: { ...DEV_DEFAULT_SECRETS } })).toEqual({ fatal: [], warnings: [] });
  });
});

describe("описание API в production", () => {
  const spec = { openapi: "3.0.3", info: { title: "PBTH" }, paths: { "/x": {} } };
  it("без токена — заглушка без путей, версия на месте для проверок выката", () => {
    const res = openApiForRequest(spec, { isProd: true, configuredToken: "", providedToken: "" });
    expect(res).toEqual({ openapi: "3.0.3", info: { title: "PBTH" }, paths: {} });
  });
  it("с верным токеном — полное описание", () => {
    expect(openApiForRequest(spec, { isProd: true, configuredToken: "tok-123", providedToken: "tok-123" })).toBe(spec);
    expect(openApiForRequest(spec, { isProd: true, configuredToken: "tok-123", providedToken: "nope" }).paths).toEqual({});
  });
  it("вне production — как было", () => {
    expect(openApiForRequest(spec, { isProd: false, configuredToken: "", providedToken: "" })).toBe(spec);
  });
  it("сравнение секрета", () => {
    expect(safeEqualSecret("abc", "abc")).toBe(true);
    expect(safeEqualSecret("abc", "abd")).toBe(false);
    expect(safeEqualSecret("ab", "abc")).toBe(false);
  });
});

describe("ссылка на место", () => {
  it("пускает только http(s)", () => {
    expect(isHttpUrl("https://yandex.ru/maps/-/x")).toBe(true);
    expect(isHttpUrl("http://example.com")).toBe(true);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("JaVaScRiPt:alert(1)")).toBe(false);
    expect(isHttpUrl("data:text/html,<b>")).toBe(false);
    expect(isHttpUrl("//evil.com")).toBe(false);
  });
  it("пустая строка в запросе допустима — ссылки нет", () => {
    expect(locationUrlSchema.safeParse("").success).toBe(true);
    expect(locationUrlSchema.safeParse("  javascript:alert(1)").success).toBe(false);
  });
  it("в ответе небезопасная ссылка превращается в null", () => {
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl(" https://a.ru ")).toBe("https://a.ru");
    expect(safeHttpUrl(null)).toBeNull();
  });
});

describe("видимость рефлексий и денег", () => {
  it("роли", () => {
    expect(reflectionScopeForRole("PLAYER")).toBe("OWN");
    expect(reflectionScopeForRole("TRAINER")).toBe("TEAM");
    expect(financeScopeForRole("TRAINER")).toBe("DEBTS_ONLY");
    expect(financeScopeForRole("CAPTAIN")).toBe("FULL");
    expect(financeScopeForRole("ADMIN")).toBe("FULL");
  });
  it("таблица и сводка игроку: агрегаты целиком, строки свои", () => {
    const table = {
      eventId: "e",
      games: [{ gameId: "g", points: [{ submitted: 2, reflections: [{ userId: "me" }, { userId: "other" }] }] }],
    };
    const own = anonymizeEventTable(table, "me");
    expect(own.games[0].points[0].submitted).toBe(2);
    expect(own.games[0].points[0].reflections).toEqual([{ userId: "me" }]);
    expect(table.games[0].points[0].reflections).toHaveLength(2);
    expect(anonymizeEventSummary({ overall: 1, players: [{ userId: "me" }, { userId: "other" }] }, "me").players).toEqual([
      { userId: "me" },
    ]);
  });
  it("баланс без книги: чужой — только долг, свой — целиком", () => {
    const t = { totalDue: 500, totalPaid: 700, outstanding: 0, overpaid: 200 };
    expect(debtsOnlyBalance(t, false)).toBe(0);
    expect(debtsOnlyBalance(t, true)).toBe(200);
    expect(debtsOnlyBalance({ totalDue: 500, totalPaid: 0, outstanding: 500, overpaid: 0 }, false)).toBe(-500);
    expect(debtsOnlyBalance(undefined, false)).toBe(0);
  });
  it("чужой с переплатой по одному событию и долгом по другому — чистый долг, как у капитана", () => {
    const mixed = { totalDue: 800, totalPaid: 500, outstanding: 500, overpaid: 200 };
    expect(debtsOnlyBalance(mixed, false)).toBe(-300);
    expect(debtsOnlyBalance(mixed, true)).toBe(-300);
    const covered = { totalDue: 800, totalPaid: 800, outstanding: 300, overpaid: 300 };
    expect(Object.is(debtsOnlyBalance(covered, false), 0)).toBe(true);
  });
});

describe("привязка Яндекса: тот же браузер", () => {
  it("IP обязателен и должен совпасть, User-Agent — тоже", () => {
    expect(sameBrowserAsState({ ipHash: "a", uaHash: "u" }, { ipHash: "a", uaHash: "u" })).toBe(true);
    expect(sameBrowserAsState({ ipHash: "a", uaHash: "u" }, { ipHash: "b", uaHash: "u" })).toBe(false);
    expect(sameBrowserAsState({ ipHash: "a", uaHash: "u" }, { ipHash: "a", uaHash: "v" })).toBe(false);
    expect(sameBrowserAsState({ ipHash: null, uaHash: null }, { ipHash: null, uaHash: null })).toBe(false);
  });
});
