// Путь новичка по ссылке-приглашению — целиком, от ссылки до главной команды.
//
// 10.11.2026 этот путь на проде заканчивался тупиком: человек входил через
// Telegram, приложение грузило /init раньше, чем он принял приглашение, и
// показывало «вы пока не состоите ни в одной команде». Тест держит контракт,
// на котором стоит исправление во фронтенде:
//   - после входа по коду сервер возвращает адрес приглашения, а не /app;
//   - до принятия /init честно отвечает «нет команды» — значит, фронтенд
//     обязан вести на экран приглашения, а не грузить приложение;
//   - после принятия /init отдаёт именно ту команду, куда звали.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

process.env.AUTH_PAIRING_ENABLED = "1";
process.env.TELEGRAM_BOT_TOKEN = "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = "dummy_bot";
process.env.TELEGRAM_WEBHOOK_SECRET = "test-webhook-secret";
process.env.FRONTEND_URL = process.env.FRONTEND_URL || "https://staging.pbthub.ru";

const suffix = String(Date.now() % 10_000_000);
const NEWBIE_TG_ID = 960_000_000 + (Date.now() % 1_000_000);
const CAPTAIN_TG_ID = NEWBIE_TG_ID + 1;

let app: typeof import("../../app.js").app;
let pool: typeof import("../../db/pool.js").pool;

const fixture = { teamId: "", teamName: `Invite Flow ${suffix}`, token: "" };

function stubTelegram() {
  const calls: Array<{ method: string; payload: any }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, init: any) => {
      const method = String(url).split("/").pop() ?? "";
      calls.push({ method, payload: JSON.parse(String(init?.body ?? "{}")) });
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 778 } }) } as any;
    })
  );
  return calls;
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

  const captain = await pool.query<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name, nickname, account_role)
     VALUES ($1::bigint, $2, 'Invite Captain', 'icap', 'USER')
     RETURNING id`,
    [String(CAPTAIN_TG_ID), `icap_${suffix}`]
  );
  const team = await pool.query<{ id: string }>(
    `INSERT INTO teams (name, short_code) VALUES ($1, $2) RETURNING id`,
    [fixture.teamName, `IF${suffix}`]
  );
  fixture.teamId = team.rows[0].id;
  await pool.query(
    `INSERT INTO team_memberships (user_id, team_id, role) VALUES ($1, $2, 'CAPTAIN')`,
    [captain.rows[0].id, fixture.teamId]
  );
  const invite = await pool.query<{ token: string }>(
    `INSERT INTO team_invites (team_id, role, created_by, expires_at)
     VALUES ($1, 'PLAYER', $2, NOW() + INTERVAL '72 hours')
     RETURNING token::text`,
    [fixture.teamId, captain.rows[0].id]
  );
  fixture.token = invite.rows[0].token;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await pool.query(`DELETE FROM auth_pairing_attempts WHERE redirect_to LIKE '/invite/%'`);
  await pool.query(`DELETE FROM teams WHERE id = $1`, [fixture.teamId]);
  await pool.query(`DELETE FROM users WHERE telegram_id = ANY($1::bigint[])`, [
    [String(NEWBIE_TG_ID), String(CAPTAIN_TG_ID)],
  ]);
});

describe("новичок по ссылке-приглашению", () => {
  it("ссылка → вход по коду → экран приглашения → «Принять» → своя команда", async () => {
    const invitePath = `/invite/${fixture.token}`;
    const browser = request.agent(app);

    // 1. Ссылку открыл человек без входа: приглашение видно и без сессии.
    const info = await browser.get(`/api/v1/teams/invites/${fixture.token}`);
    expect(info.status).toBe(200);
    expect(info.body.teamName).toBe(fixture.teamName);

    // 2. «Войти и принять приглашение» → /login?next=/invite/<token> →
    // «Продолжить с Telegram»: браузер просит код, адрес приглашения едет с ним.
    const calls = stubTelegram();
    const started = await browser.post("/api/v1/auth/pair/start").send({ scope: "USER", redirectTo: invitePath });
    expect(started.status).toBe(200);
    const code = String(started.body.code);

    // 3. Код в бот и «Это я, войти».
    await webhook({
      message: {
        message_id: 61,
        text: code,
        chat: { id: NEWBIE_TG_ID },
        from: { id: NEWBIE_TG_ID, first_name: "Новичок", username: `newbie_${suffix}` },
      },
    });
    const card = calls.find((c) => c.method === "sendMessage");
    const approveData = card!.payload.reply_markup.inline_keyboard[0][0].callback_data as string;
    await webhook({
      callback_query: {
        id: "cbq-invite",
        data: approveData,
        from: { id: NEWBIE_TG_ID, first_name: "Новичок" },
        message: { message_id: 778, chat: { id: NEWBIE_TG_ID }, text: "Запрос входа" },
      },
    });

    // 4. Опрос получает сессию и адрес приглашения — не /app.
    const approved = await browser.get(`/api/v1/auth/pair/status?code=${encodeURIComponent(code)}`);
    expect(approved.status).toBe(200);
    expect(approved.body).toEqual({ status: "approved", redirectTo: invitePath });
    const me = await browser.get("/api/v1/auth/me");
    expect(me.body.authenticated).toBe(true);

    // 5. До принятия команды нет. Именно этот ответ раньше превращался во
    // фронтенде в системное окно и тупик, если приложение грузилось сразу.
    const before = await browser.get("/api/v1/init");
    expect(before.status).toBe(200);
    expect(before.body.noTeamYet).toBe(true);

    // 6. «Принять приглашение».
    const accepted = await browser.post(`/api/v1/teams/invites/${fixture.token}/accept`).send({});
    expect(accepted.status).toBe(200);
    expect(accepted.body.teamId).toBe(fixture.teamId);

    // 7. Главная — команда из приглашения, без повторного открытия ссылки.
    const after = await browser.get("/api/v1/init");
    expect(after.status).toBe(200);
    expect(after.body.noTeamYet).toBeFalsy();
    expect(after.body.team.id).toBe(fixture.teamId);
    expect(after.body.team.name).toBe(fixture.teamName);
  });

  it("адрес входа вида /\\host не принимается — после входа ведём в приложение", async () => {
    const browser = request.agent(app);
    stubTelegram();
    const started = await browser
      .post("/api/v1/auth/pair/start")
      .send({ scope: "USER", redirectTo: "/\\evil.example/invite/x" });
    expect(started.status).toBe(200);
    const row = await pool.query<{ redirect_to: string }>(
      `SELECT redirect_to FROM auth_pairing_attempts ORDER BY created_at DESC LIMIT 1`
    );
    expect(row.rows[0].redirect_to).toBe("/app");
  });
});
