import { describe, expect, it } from "vitest";
import {
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
  buildPairingConfirmationKeyboard,
  buildPairingConfirmationText,
  buildPairingDeepLink,
  classifyPairingStatus,
  describePairingDevice,
  formatPairingCode,
  generatePairingCode,
  hashPairingCode,
  normalizePairingCode,
  parsePairingCallbackData,
  parsePairingCodeFromText,
  resolvePairingRedirect,
} from "../../lib/auth-pairing.js";

describe("generatePairingCode", () => {
  it("выдаёт код нужной длины только из разрешённого алфавита", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generatePairingCode();
      expect(code).toHaveLength(PAIRING_CODE_LENGTH);
      for (const char of code) expect(PAIRING_CODE_ALPHABET).toContain(char);
    }
  });

  it("не содержит символов, которые путают при переписывании", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generatePairingCode()).not.toMatch(/[ILOU]/);
    }
  });

  it("не повторяется", () => {
    const codes = new Set(Array.from({ length: 500 }, () => generatePairingCode()));
    expect(codes.size).toBe(500);
  });
});

describe("normalizePairingCode", () => {
  it("принимает код как его набрал человек", () => {
    expect(normalizePairingCode("K7M4QX9P")).toBe("K7M4QX9P");
    expect(normalizePairingCode("k7m4-qx9p")).toBe("K7M4QX9P");
    expect(normalizePairingCode(" K7M4 QX9P ")).toBe("K7M4QX9P");
    expect(normalizePairingCode("k7m4_qx9p")).toBe("K7M4QX9P");
  });

  it("чинит подмену похожих символов", () => {
    expect(normalizePairingCode("I7M4QX9P")).toBe("17M4QX9P");
    expect(normalizePairingCode("l7M4QX9P")).toBe("17M4QX9P");
    expect(normalizePairingCode("K7M4QX9O")).toBe("K7M4QX90");
  });

  it("отбивает мусор", () => {
    expect(normalizePairingCode("K7M4QX9")).toBeNull();
    expect(normalizePairingCode("K7M4QX9PP")).toBeNull();
    expect(normalizePairingCode("K7M4QX9!")).toBeNull();
    expect(normalizePairingCode("Привет!!")).toBeNull();
    expect(normalizePairingCode("")).toBeNull();
    expect(normalizePairingCode(null)).toBeNull();
    expect(normalizePairingCode(12345678)).toBeNull();
  });

  it("сгенерированный код всегда проходит нормализацию без изменений", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generatePairingCode();
      expect(normalizePairingCode(code)).toBe(code);
      expect(normalizePairingCode(formatPairingCode(code))).toBe(code);
    }
  });
});

describe("parsePairingCodeFromText", () => {
  it("читает код из диплинка", () => {
    expect(parsePairingCodeFromText("/start pair_K7M4QX9P")).toBe("K7M4QX9P");
    expect(parsePairingCodeFromText("/start@pbth_bot pair_K7M4QX9P")).toBe("K7M4QX9P");
    expect(parsePairingCodeFromText("/start pair-K7M4QX9P")).toBe("K7M4QX9P");
  });

  it("читает код, отправленный голым сообщением", () => {
    // Главный путь, когда переход по ссылке из PWA не сработал.
    expect(parsePairingCodeFromText("K7M4-QX9P")).toBe("K7M4QX9P");
    expect(parsePairingCodeFromText("k7m4qx9p")).toBe("K7M4QX9P");
  });

  it("не принимает другие команды за код", () => {
    expect(parsePairingCodeFromText("/start")).toBeNull();
    expect(parsePairingCodeFromText("/start login_abc")).toBeNull();
    expect(parsePairingCodeFromText("/help")).toBeNull();
  });

  it("не принимает обычную переписку за код", () => {
    expect(parsePairingCodeFromText("привет")).toBeNull();
    expect(parsePairingCodeFromText("а когда игра?")).toBeNull();
    expect(parsePairingCodeFromText(undefined)).toBeNull();
  });
});

describe("hashPairingCode", () => {
  it("устойчив и не обратим глазами", () => {
    const hash = hashPairingCode("K7M4QX9P");
    expect(hash).toHaveLength(64);
    expect(hash).toBe(hashPairingCode("K7M4QX9P"));
    expect(hash).not.toContain("K7M4");
    expect(hash).not.toBe(hashPairingCode("K7M4QX9Q"));
  });
});

describe("describePairingDevice", () => {
  it("узнаёт айфон в Safari — случай из инцидента", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
    expect(describePairingDevice(ua)).toBe("iPhone · Safari");
  });

  it("не принимает Chrome за Safari, а Edge за Chrome", () => {
    const chrome =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
    expect(describePairingDevice(chrome)).toBe("Windows · Chrome");

    const edge =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0";
    expect(describePairingDevice(edge)).toBe("Windows · Edge");
  });

  it("молчит, когда сказать нечего", () => {
    expect(describePairingDevice("")).toBeNull();
    expect(describePairingDevice(undefined)).toBeNull();
    expect(describePairingDevice("curl/8.4.0")).toBeNull();
  });
});

describe("buildPairingConfirmationText", () => {
  it("даёт человеку всё, чтобы узнать себя или не узнать", () => {
    const text = buildPairingConfirmationText({
      firstName: "Василий",
      code: "K7M4QX9P",
      host: "pbthub.ru",
      deviceLabel: "iPhone · Safari",
      requestedIp: "213.155.15.127",
    });
    expect(text).toContain("Василий");
    expect(text).toContain("pbthub.ru");
    expect(text).toContain("K7M4-QX9P");
    expect(text).toContain("iPhone · Safari");
    expect(text).toContain("213.155.15.127");
    expect(text).toContain("Это не я");
  });

  it("держится без имени и без контекста устройства", () => {
    const text = buildPairingConfirmationText({ code: "K7M4QX9P", host: "pbthub.ru" });
    expect(text).toContain("K7M4-QX9P");
    expect(text).not.toContain("Устройство:");
    expect(text).not.toContain("IP:");
  });

  it("экранирует имя из профиля Telegram", () => {
    // Имя приходит от пользователя и попадает в HTML-разметку сообщения.
    const text = buildPairingConfirmationText({
      firstName: "<b>Админ</b>",
      code: "K7M4QX9P",
      host: "pbthub.ru",
    });
    expect(text).toContain("&lt;b&gt;Админ&lt;/b&gt;");
  });
});

describe("parsePairingCallbackData", () => {
  const attemptId = "3f6c1c8e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";

  it("читает свои нажатия", () => {
    expect(parsePairingCallbackData(`pair:approve:${attemptId}`)).toEqual({ action: "approve", attemptId });
    expect(parsePairingCallbackData(`pair:deny:${attemptId}`)).toEqual({ action: "deny", attemptId });
  });

  it("игнорирует чужое и подделанное", () => {
    expect(parsePairingCallbackData("pair:approve:not-a-uuid")).toBeNull();
    expect(parsePairingCallbackData(`pair:drop:${attemptId}`)).toBeNull();
    expect(parsePairingCallbackData(`other:approve:${attemptId}`)).toBeNull();
    expect(parsePairingCallbackData(undefined)).toBeNull();
  });

  it("клавиатура строится под этот же разбор", () => {
    const keyboard = buildPairingConfirmationKeyboard(attemptId) as any;
    const [approve, deny] = keyboard.inline_keyboard[0];
    expect(parsePairingCallbackData(approve.callback_data)).toEqual({ action: "approve", attemptId });
    expect(parsePairingCallbackData(deny.callback_data)).toEqual({ action: "deny", attemptId });
    // URL-кнопок здесь быть не должно: любая ссылка уводит из PWA.
    expect(approve.url).toBeUndefined();
    expect(deny.url).toBeUndefined();
  });
});

describe("classifyPairingStatus", () => {
  const now = new Date("2026-08-06T18:00:00Z");
  const future = new Date("2026-08-06T18:04:00Z");
  const past = new Date("2026-08-06T17:58:00Z");

  it("ведёт попытку по шагам", () => {
    expect(classifyPairingStatus({ status: "PENDING", expiresAt: future, now })).toBe("pending");
    expect(classifyPairingStatus({ status: "CLAIMED", expiresAt: future, now })).toBe("claimed");
    expect(classifyPairingStatus({ status: "APPROVED", expiresAt: future, now })).toBe("approved");
  });

  it("хоронит попытку по часам, а не по колонке", () => {
    expect(classifyPairingStatus({ status: "PENDING", expiresAt: past, now })).toBe("expired");
    expect(classifyPairingStatus({ status: "CLAIMED", expiresAt: past, now })).toBe("expired");
  });

  it("не даёт войти второй раз по отработавшему коду", () => {
    expect(classifyPairingStatus({ status: "CONSUMED", expiresAt: future, now })).toBe("expired");
  });

  it("отказ остаётся отказом даже после истечения срока", () => {
    expect(classifyPairingStatus({ status: "DENIED", expiresAt: past, now })).toBe("denied");
  });

  it("подтверждённую попытку не отбирают часы — сессию заберёт опрос", () => {
    // Между нажатием «Это я» и следующим опросом проходит до пары секунд.
    // Ронять approved по TTL значит терять уже подтверждённый вход.
    expect(classifyPairingStatus({ status: "APPROVED", expiresAt: past, now })).toBe("approved");
  });

  it("понимает срок в виде строки из базы", () => {
    expect(
      classifyPairingStatus({ status: "PENDING", expiresAt: "2026-08-06T18:04:00Z", now: now.getTime() })
    ).toBe("pending");
  });
});

describe("resolvePairingRedirect", () => {
  it("возвращает туда, откуда пришли", () => {
    expect(resolvePairingRedirect({ scope: "USER", redirectTo: "/app/games/12" })).toBe("/app/games/12");
    expect(resolvePairingRedirect({ scope: "ADMIN", redirectTo: "/admin/users" })).toBe("/admin/users");
  });

  it("не пускает вход за пределы приложения", () => {
    expect(resolvePairingRedirect({ scope: "USER", redirectTo: "https://evil.example" })).toBe("/app");
    expect(resolvePairingRedirect({ scope: "USER", redirectTo: "//evil.example" })).toBe("/app");
    expect(resolvePairingRedirect({ scope: "USER", redirectTo: "/admin/users" })).toBe("/app");
    expect(resolvePairingRedirect({ scope: "ADMIN", redirectTo: "/app" })).toBe("/admin");
    expect(resolvePairingRedirect({ scope: "USER" })).toBe("/app");
  });
});

describe("buildPairingDeepLink", () => {
  it("ведёт к боту с кодом в стартовом параметре", () => {
    expect(buildPairingDeepLink("pbth_bot", "K7M4QX9P")).toBe("https://t.me/pbth_bot?start=pair_K7M4QX9P");
  });
});
