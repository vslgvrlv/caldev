// Цикл входа по коду сопряжения целиком (#109).
//
// Проверяется главное свойство схемы: сессионная кука приходит на ответ
// опроса, который сделал сам браузер. Если этот тест когда-нибудь начнёт
// проходить без Set-Cookie на /pair/status — вход в PWA снова сломан.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { hashPairingCode as hashRaw, normalizePairingCode } from "../../lib/auth-pairing.js";

const hashPairingCode = (formatted: string) => hashRaw(normalizePairingCode(formatted));

process.env.AUTH_PAIRING_ENABLED = "1";
process.env.TELEGRAM_BOT_TOKEN = "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = "dummy_bot";
process.env.TELEGRAM_WEBHOOK_SECRET = "test-webhook-secret";
process.env.FRONTEND_URL = process.env.FRONTEND_URL || "https://staging.pbthub.ru";

const TG_USER_ID = 950211;
const TG_CHAT_ID = 950211;

let app: typeof import("../../app.js").app;
let pool: typeof import("../../db/pool.js").pool;

// Все обращения к Bot API — через fetch. В тесте они замещаются: настоящий
// вызов ушёл бы в Telegram, а нам нужен только message_id карточки.
function stubTelegram() {
  const calls: Array<{ method: string; payload: any }> = [];
  const fetchMock = vi.fn(async (url: any, init: any) => {
    const method = String(url).split("/").pop() ?? "";
    calls.push({ method, payload: JSON.parse(String(init?.body ?? "{}")) });
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { message_id: 777 } }),
    } as any;
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

async function startPairing(agent: ReturnType<typeof request.agent>, scope: "USER" | "ADMIN" = "USER") {
  const res = await agent.post("/api/v1/auth/pair/start").send({ scope, redirectTo: "/app" });
  expect(res.status).toBe(200);
  return res;
}

function webhook(update: Record<string, unknown>) {
  return request(app)
    .post("/api/v1/vendor/telegram/webhook")
    .set("x-telegram-bot-api-secret-token", "test-webhook-secret")
    .send(update);
}

beforeAll(async () => {
  ({ app } = await import("../../app.js"));
  ({ pool } = await import("../../db/pool.js"));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await pool.query(`DELETE FROM auth_pairing_attempts WHERE redirect_to LIKE '/app%' OR redirect_to = '/admin'`);
  await pool.query(`DELETE FROM users WHERE telegram_id = $1::bigint`, [String(TG_USER_ID)]);
});

describe("pairing login flow — end-to-end", () => {
  it("код → карточка в чате → подтверждение → сессия на ответе опроса", async () => {
    const calls = stubTelegram();
    const agent = request.agent(app);

    // 1. Браузер просит код.
    const started = await startPairing(agent);
    expect(started.body.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(started.body.botUsername).toBe("dummy_bot");
    const cookies = started.headers["set-cookie"] as unknown as string[];
    expect(cookies.join(",")).toMatch(/pbth\.pair=/);
    const code = String(started.body.code);

    // 2. До появления кода в боте — pending.
    const pending = await agent.get(`/api/v1/auth/pair/status?code=${encodeURIComponent(code)}`);
    expect(pending.status).toBe(200);
    expect(pending.body).toEqual({ status: "pending" });

    // 3. Человек отправил код боту. Карточка уходит прямым вызовом Bot API.
    const claimRes = await webhook({
      message: {
        message_id: 10,
        text: code,
        chat: { id: TG_CHAT_ID },
        from: { id: TG_USER_ID, first_name: "Пейнт", username: "pair_e2e" },
      },
    });
    expect(claimRes.status).toBe(200);
    const card = calls.find((c) => c.method === "sendMessage");
    expect(card).toBeTruthy();
    expect(String(card!.payload.text)).toContain(code);
    const keyboard = card!.payload.reply_markup.inline_keyboard[0];
    // Ни одной кнопки-ссылки: переход открыл бы чужой браузер — это и был баг.
    expect(keyboard.every((btn: any) => !btn.url)).toBe(true);
    const approveData = keyboard[0].callback_data as string;
    expect(approveData).toMatch(/^pair:approve:/);

    const claimed = await agent.get(`/api/v1/auth/pair/status?code=${encodeURIComponent(code)}`);
    expect(claimed.body).toEqual({ status: "claimed" });

    // 4. Тап по «Это я, войти» — внутри чата, без единой навигации.
    const approveRes = await webhook({
      callback_query: {
        id: "cbq-1",
        data: approveData,
        from: { id: TG_USER_ID, first_name: "Пейнт" },
        message: { message_id: 777, chat: { id: TG_CHAT_ID }, text: "Запрос входа" },
      },
    });
    expect(approveRes.status).toBe(200);
    expect(calls.some((c) => c.method === "answerCallbackQuery")).toBe(true);
    // Карточка правится на месте, кнопки снимаются.
    const edit = calls.find((c) => c.method === "editMessageText");
    expect(edit).toBeTruthy();
    expect(String(edit!.payload.text)).toContain("✅ Принят");
    expect(edit!.payload.reply_markup).toEqual({ inline_keyboard: [] });

    // 5. Ради этой проверки всё и затевалось: кука сессии приходит на ответ
    // опроса, сделанного самим браузером.
    const approved = await agent.get(`/api/v1/auth/pair/status?code=${encodeURIComponent(code)}`);
    expect(approved.status).toBe(200);
    expect(approved.body).toEqual({ status: "approved", redirectTo: "/app" });
    const sessionCookies = approved.headers["set-cookie"] as unknown as string[];
    expect(sessionCookies.join(",")).toMatch(/pbth\.sid=|pbth\.stg\.sid=/);

    // 6. Одноразовость: попытка погашена, а кука сопряжения снята — повторный
    // опрос тем же кодом уже ничего не находит.
    const consumedRow = await pool.query<{ status: string }>(
      `SELECT status::text FROM auth_pairing_attempts WHERE code_hash = $1`,
      [hashPairingCode(code)]
    );
    expect(consumedRow.rows[0].status).toBe("CONSUMED");
    const replay = await agent.get(`/api/v1/auth/pair/status?code=${encodeURIComponent(code)}`);
    expect(replay.status).toBe(404);
    expect(replay.body.code).toBe("PAIRING_NOT_FOUND");

    // 7. Сессия действительно установлена в этом же «браузере».
    const me = await agent.get("/api/v1/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.authenticated).toBe(true);
  });

  it("«Это не я» гасит попытку, и код после этого не работает", async () => {
    const calls = stubTelegram();
    const agent = request.agent(app);
    const started = await startPairing(agent);
    const code = String(started.body.code);

    await webhook({
      message: {
        message_id: 20,
        text: code,
        chat: { id: TG_CHAT_ID },
        from: { id: TG_USER_ID, first_name: "Пейнт" },
      },
    });
    const card = calls.find((c) => c.method === "sendMessage");
    const denyData = card!.payload.reply_markup.inline_keyboard[0][1].callback_data as string;
    expect(denyData).toMatch(/^pair:deny:/);

    await webhook({
      callback_query: {
        id: "cbq-2",
        data: denyData,
        from: { id: TG_USER_ID },
        message: { message_id: 777, chat: { id: TG_CHAT_ID }, text: "Запрос входа" },
      },
    });

    const denied = await agent.get(`/api/v1/auth/pair/status?code=${encodeURIComponent(code)}`);
    expect(denied.body).toEqual({ status: "denied" });
    expect(denied.headers["set-cookie"]).toBeUndefined();
  });

  it("чужой браузер не может забрать сессию по подсмотренному коду", async () => {
    stubTelegram();
    const owner = request.agent(app);
    const started = await startPairing(owner);
    const code = String(started.body.code);

    await webhook({
      message: {
        message_id: 30,
        text: code,
        chat: { id: TG_CHAT_ID },
        from: { id: TG_USER_ID, first_name: "Пейнт" },
      },
    });

    // Другой браузер: своя кука pbth.pair, полученная на собственной попытке.
    const stranger = request.agent(app);
    await startPairing(stranger);
    const stolen = await stranger.get(`/api/v1/auth/pair/status?code=${encodeURIComponent(code)}`);
    expect(stolen.status).toBe(404);
    expect(stolen.body.code).toBe("PAIRING_NOT_FOUND");

    // Совсем без куки — тот же ответ, что и на несуществующий код: по разнице
    // ответов нельзя перебирать чужие коды.
    const noCookie = await request(app).get(`/api/v1/auth/pair/status?code=${encodeURIComponent(code)}`);
    expect(noCookie.status).toBe(404);
    expect(noCookie.body.code).toBe("PAIRING_NOT_FOUND");

    const unknown = await stranger.get("/api/v1/auth/pair/status?code=ZZZZ-ZZZZ");
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe(noCookie.body.code);
    expect(unknown.body.detail).toBe(noCookie.body.detail);
  });

  it("просроченный код не подтверждается и не пускает", async () => {
    stubTelegram();
    const agent = request.agent(app);
    const started = await startPairing(agent);
    const code = String(started.body.code);

    await pool.query(
      `UPDATE auth_pairing_attempts SET expires_at = NOW() - INTERVAL '1 minute'
        WHERE code_hash = $1`,
      [hashPairingCode(code)]
    );

    const expired = await agent.get(`/api/v1/auth/pair/status?code=${encodeURIComponent(code)}`);
    expect(expired.body).toEqual({ status: "expired" });
    expect(expired.headers["set-cookie"]).toBeUndefined();

    // И бот на такой код отвечает отказом, а не карточкой подтверждения.
    const calls = stubTelegram();
    await webhook({
      message: {
        message_id: 40,
        text: code,
        chat: { id: TG_CHAT_ID },
        from: { id: TG_USER_ID, first_name: "Пейнт" },
      },
    });
    const reply = calls.find((c) => c.method === "sendMessage");
    expect(String(reply!.payload.text)).toContain("истёк");
    expect(reply!.payload.reply_markup).toBeUndefined();
  });

  it("подтвердить может только тот аккаунт, который прислал код", async () => {
    const calls = stubTelegram();
    const agent = request.agent(app);
    const started = await startPairing(agent);
    const code = String(started.body.code);

    await webhook({
      message: {
        message_id: 50,
        text: code,
        chat: { id: TG_CHAT_ID },
        from: { id: TG_USER_ID, first_name: "Пейнт" },
      },
    });
    const card = calls.find((c) => c.method === "sendMessage");
    const approveData = card!.payload.reply_markup.inline_keyboard[0][0].callback_data as string;

    // Карточку переслали в чат — посторонний нажимает «Это я».
    await webhook({
      callback_query: {
        id: "cbq-3",
        data: approveData,
        from: { id: 950999 },
        message: { message_id: 777, chat: { id: TG_CHAT_ID }, text: "Запрос входа" },
      },
    });

    const still = await agent.get(`/api/v1/auth/pair/status?code=${encodeURIComponent(code)}`);
    expect(still.body).toEqual({ status: "claimed" });
  });
});
