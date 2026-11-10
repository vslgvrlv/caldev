// Трек 2 ревизии «Явка» (решение Василия 10.11.2026, п. 8): кнопки
// «Иду / Не иду» в сообщении бота и в пуше, авто-напоминания неответившим,
// отключение самим человеком, экран «кому дошло».
//
// Bot API подменён локальным сервером: тест видит каждый запрос бота.

import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";

const stamp = Date.now() % 1_000_000;
const TG = {
  captain: String(981_000_000 + stamp),
  answered: String(982_000_000 + stamp),
  silent: String(983_000_000 + stamp),
  muted: String(984_000_000 + stamp),
  outsider: String(985_000_000 + stamp),
  far: String(986_000_000 + stamp),
  owner: String(987_000_000 + stamp),
};
type Who = keyof typeof TG;

type BotCall = { method: string; payload: Record<string, any> };
const botCalls: BotCall[] = [];
let botServer: http.Server;

process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
process.env.TELEGRAM_CALLBACK_URL =
  process.env.TELEGRAM_CALLBACK_URL || "http://127.0.0.1:8000/api/v1/auth/telegram/callback";
process.env.TELEGRAM_WEBHOOK_SECRET = "rsvp-test-secret";
process.env.FRONTEND_URL = "https://pbthub.test";
process.env.DEV_AUTH_ENABLED = "1";
process.env.DEV_AUTH_SECRET = "";
process.env.NOTIFICATIONS_QUEUE_ENABLED = "0";
process.env.ADMIN_ROLE_ALLOWLIST_IDS = TG.owner;

let app: typeof import("../../app.js").app;
let pool: typeof import("../../db/pool.js").pool;
let runAutoReminderTick: typeof import("../../modules/reminders/auto.js").runAutoReminderTick;
let signRsvpToken: typeof import("../../lib/notification-rsvp-token.js").signRsvpToken;
let sessionSecret = "";

const f = {
  teamId: "",
  farTeamId: "",
  code: `rv${stamp}`,
  users: {} as Record<Who, string>,
  eventId: "",
  startedEventId: "",
  farEventId: "",
};

const agents = new Map<Who, ReturnType<typeof request.agent>>();
async function login(who: Who) {
  const cached = agents.get(who);
  if (cached) return cached;
  const agent = request.agent(app);
  const res = await agent
    .post("/api/v1/auth/dev/login")
    .send({ telegramId: TG[who], username: `rv_${who}_${stamp}`, ensureTeam: false });
  expect(res.status).toBe(200);
  agents.set(who, agent);
  return agent;
}

function webhook(update: Record<string, unknown>) {
  return request(app)
    .post("/api/v1/vendor/telegram/webhook")
    .set("x-telegram-bot-api-secret-token", "rsvp-test-secret")
    .send(update);
}

let callbackSeq = 0;
function press(who: Who, data: string, message?: Record<string, unknown>) {
  callbackSeq += 1;
  return webhook({
    update_id: callbackSeq,
    callback_query: {
      id: `cb-${stamp}-${callbackSeq}`,
      data,
      from: { id: Number(TG[who]) },
      message: message ?? {
        message_id: 777,
        chat: { id: Number(TG[who]) },
        text: "Команда · напоминание о событии\nТренировка\nвоскресенье, 22 ноября, 20:30\n\nОтвета от тебя пока нет. Идёшь?",
        entities: [{ type: "bold", offset: 0, length: 7 }],
      },
    },
  });
}

async function rsvpOf(who: Who, eventId = f.eventId) {
  const r = await pool.query<{ status: string }>(`SELECT status::text FROM rsvps WHERE event_id = $1 AND user_id = $2`, [
    eventId,
    f.users[who],
  ]);
  return r.rows[0]?.status ?? null;
}

beforeAll(async () => {
  botServer = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const method = String(req.url || "").split("/").pop() || "";
      let payload: Record<string, any> = {};
      try {
        payload = JSON.parse(body || "{}");
      } catch {
        payload = {};
      }
      botCalls.push({ method, payload });
      res.setHeader("content-type", "application/json");
      // «Чат не найден» для одного человека — как у того, кто не запускал бота.
      if (method === "sendMessage" && String(payload.chat_id) === TG.far) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: chat not found" }));
        return;
      }
      res.end(JSON.stringify({ ok: true, result: { message_id: 900 + botCalls.length } }));
    });
  });
  await new Promise<void>((resolve) => botServer.listen(0, "127.0.0.1", resolve));
  process.env.TELEGRAM_BOT_API_BASE_URL = `http://127.0.0.1:${(botServer.address() as AddressInfo).port}`;

  ({ app } = await import("../../app.js"));
  ({ pool } = await import("../../db/pool.js"));
  ({ runAutoReminderTick } = await import("../../modules/reminders/auto.js"));
  ({ signRsvpToken } = await import("../../lib/notification-rsvp-token.js"));
  sessionSecret = (await import("../../config/env.js")).env.session.secret;

  const team = await pool.query<{ id: string }>(
    `INSERT INTO teams (name, short_code, timezone) VALUES ($1, $2, 'Europe/Moscow') RETURNING id`,
    [`Явка ${stamp}`, f.code.toUpperCase()]
  );
  f.teamId = team.rows[0].id;
  const farTeam = await pool.query<{ id: string }>(
    `INSERT INTO teams (name, short_code, timezone) VALUES ($1, $2, 'Asia/Vladivostok') RETURNING id`,
    [`Восток ${stamp}`, `RVF${stamp}`]
  );
  f.farTeamId = farTeam.rows[0].id;

  for (const who of Object.keys(TG) as Who[]) {
    const u = await pool.query<{ id: string }>(
      `INSERT INTO users (telegram_id, username, name, nickname, account_role, onboarding_completed_at, role_selected_at)
       VALUES ($1::bigint, $2, $3, $4, 'USER', NOW(), NOW()) RETURNING id`,
      [TG[who], `rv_${who}_${stamp}`, `Явка ${who}`, `rv_${who}`]
    );
    f.users[who] = u.rows[0].id;
  }
  const memberships: Array<[Who, string, string]> = [
    ["captain", "CAPTAIN", f.teamId],
    ["answered", "PLAYER", f.teamId],
    ["silent", "PLAYER", f.teamId],
    ["muted", "PLAYER", f.teamId],
    ["far", "PLAYER", f.farTeamId],
  ];
  for (const [who, role, teamId] of memberships) {
    await pool.query(`INSERT INTO team_memberships (user_id, team_id, role) VALUES ($1, $2, $3::membership_role)`, [
      f.users[who],
      teamId,
      role,
    ]);
  }

  // Событие 22.11 в 20:30 по Москве — в будущем относительно «сейчас» тестов
  // авто-напоминаний (время им подставляется), а для кнопок — сдвинуто в будущее ниже.
  const ev = await pool.query<{ id: string }>(
    `INSERT INTO events (team_id, type, title, start_at, location)
     VALUES ($1, 'TRAINING', 'Тренировка', NOW() + INTERVAL '30 hours', 'Точка') RETURNING id`,
    [f.teamId]
  );
  f.eventId = ev.rows[0].id;
  const started = await pool.query<{ id: string }>(
    `INSERT INTO events (team_id, type, title, start_at) VALUES ($1, 'TRAINING', 'Уже идёт', NOW() - INTERVAL '10 minutes') RETURNING id`,
    [f.teamId]
  );
  f.startedEventId = started.rows[0].id;
  const far = await pool.query<{ id: string }>(
    `INSERT INTO events (team_id, type, title, start_at) VALUES ($1, 'TRAINING', 'Восточная', NOW() + INTERVAL '30 hours') RETURNING id`,
    [f.farTeamId]
  );
  f.farEventId = far.rows[0].id;

  await pool.query(`INSERT INTO rsvps (event_id, user_id, status) VALUES ($1, $2, 'CONFIRMED')`, [f.eventId, f.users.answered]);
});

afterAll(async () => {
  await pool.query(`DELETE FROM teams WHERE id = ANY($1::uuid[])`, [[f.teamId, f.farTeamId]]);
  await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.values(f.users)]);
  await new Promise<void>((resolve) => botServer.close(() => resolve()));
});

beforeEach(() => {
  botCalls.length = 0;
});

describe("кнопки «Иду / Не иду» в сообщении бота", () => {
  it("нажатие записывает ответ того, кто нажал, и правит сообщение на месте", async () => {
    const res = await press("silent", `rsvp:yes:${f.eventId}`);
    expect(res.status).toBe(200);
    expect(await rsvpOf("silent")).toBe("CONFIRMED");

    const answer = botCalls.find((c) => c.method === "answerCallbackQuery");
    expect(answer?.payload.text).toBe("Записал: ты идёшь.");
    const edit = botCalls.find((c) => c.method === "editMessageText");
    expect(edit?.payload.text.endsWith("\n\nТы идёшь. Передумаешь — нажми «Не иду».")).toBe(true);
    expect(edit?.payload.text.startsWith("Команда · напоминание о событии\nТренировка")).toBe(true);
    expect(edit?.payload.entities).toEqual([{ type: "bold", offset: 0, length: 7 }]);
    // Передумать можно тем же сообщением: кнопки остались, ссылка — на событие своей команды.
    expect(edit?.payload.reply_markup.inline_keyboard).toEqual([
      [
        { text: "Иду", callback_data: `rsvp:yes:${f.eventId}` },
        { text: "Не иду", callback_data: `rsvp:no:${f.eventId}` },
      ],
      [{ text: "Открыть событие", url: `https://pbthub.test/t/${f.code}/event/${f.eventId}` }],
    ]);
  });

  it("повторное нажатие — тот же ответ, без второй записи в журнал", async () => {
    const before = await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE user_id = $1 AND action = 'rsvp.update'`, [
      f.users.silent,
    ]);
    await press("silent", `rsvp:yes:${f.eventId}`);
    expect(await rsvpOf("silent")).toBe("CONFIRMED");
    expect(botCalls.find((c) => c.method === "answerCallbackQuery")?.payload.text).toBe("Уже записано: ты идёшь.");
    const after = await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE user_id = $1 AND action = 'rsvp.update'`, [
      f.users.silent,
    ]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("передумал — «Не иду»", async () => {
    await press("silent", `rsvp:no:${f.eventId}`);
    expect(await rsvpOf("silent")).toBe("DECLINED");
    expect(botCalls.find((c) => c.method === "editMessageText")?.payload.text).toContain("Ты не идёшь.");
  });

  it("чужой не может ответить за участника: нажатие из пересланного сообщения пишет только за нажавшего", async () => {
    // Сообщение участника «answered» переслано постороннему; тот жмёт «Не иду».
    await press("outsider", `rsvp:no:${f.eventId}`, {
      message_id: 12,
      chat: { id: Number(TG.outsider) },
      text: "Команда\n\nОтвета от тебя пока нет. Идёшь?",
    });
    expect(await rsvpOf("answered")).toBe("CONFIRMED");
    expect(await rsvpOf("outsider")).toBeNull();
    expect(botCalls.find((c) => c.method === "answerCallbackQuery")?.payload.text).toBe(
      "Ты не в составе этой команды — ответ не записан."
    );
    expect(botCalls.some((c) => c.method === "editMessageText")).toBe(false);
  });

  it("незнакомый Telegram — ответ не записан", async () => {
    await webhook({
      callback_query: { id: "cb-unknown", data: `rsvp:yes:${f.eventId}`, from: { id: 1 }, message: { message_id: 1, chat: { id: 1 } } },
    });
    expect(botCalls.find((c) => c.method === "answerCallbackQuery")?.payload.text).toContain("Не нашёл тебя в PBTH");
  });

  it("событие уже началось — молчун остаётся «молчит», кнопки снимаются", async () => {
    await press("silent", `rsvp:yes:${f.startedEventId}`);
    expect(await rsvpOf("silent", f.startedEventId)).toBeNull();
    const edit = botCalls.find((c) => c.method === "editMessageText");
    expect(edit?.payload.reply_markup.inline_keyboard).toEqual([
      [{ text: "Открыть событие", url: `https://pbthub.test/t/${f.code}/event/${f.startedEventId}` }],
    ]);
  });

  it("испорченная кнопка — вежливый отказ", async () => {
    await press("silent", "rsvp:maybe:xyz");
    expect(botCalls.find((c) => c.method === "answerCallbackQuery")?.payload.text).toContain("Кнопка устарела");
  });
});

describe("кнопки в пуше: ответ по ключу из пуша", () => {
  it("ключ своего пуша записывает ответ", async () => {
    const token = signRsvpToken({ eventId: f.eventId, userId: f.users.muted, expiresAt: Date.now() + 3600_000 }, sessionSecret);
    const res = await request(app).post("/api/v1/rsvp/push").send({ token, status: "DECLINED" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, rsvpStatus: "DECLINED", message: "Ты не идёшь." });
    expect(await rsvpOf("muted")).toBe("DECLINED");
    await pool.query(`DELETE FROM rsvps WHERE event_id = $1 AND user_id = $2`, [f.eventId, f.users.muted]);
  });

  it("подделанный ключ и ключ постороннего — отказ", async () => {
    const forged = await request(app).post("/api/v1/rsvp/push").send({ token: "v1.abc.def", status: "CONFIRMED" });
    expect(forged.status).toBe(403);
    const outsiderToken = signRsvpToken({ eventId: f.eventId, userId: f.users.outsider, expiresAt: Date.now() + 3600_000 }, sessionSecret);
    const outsider = await request(app).post("/api/v1/rsvp/push").send({ token: outsiderToken, status: "CONFIRMED" });
    expect(outsider.status).toBe(403);
    expect(await rsvpOf("outsider")).toBeNull();
  });
});

describe("ручное «Напомнить» и «кому дошло»", () => {
  it("молчунам уходит сообщение с кнопками и ссылкой; итог считает каждого", async () => {
    await pool.query(`DELETE FROM rsvps WHERE event_id = $1 AND user_id = $2`, [f.eventId, f.users.silent]);
    const captain = await login("captain");
    const res = await captain
      .post(`/api/v1/notifications/events/${f.eventId}/remind`)
      .set("X-PBTH-Team", f.teamId)
      .send({ audience: "SILENT", template: "EVENT_REMINDER" });
    expect(res.status).toBe(200);
    // Молчат: captain (сам себе тоже участник), silent, muted. answered ответил.
    const names = res.body.recipients.map((r: any) => r.name).sort();
    expect(names).toEqual([`Явка captain`, `Явка muted`, `Явка silent`]);
    expect(res.body.sent).toBe(3);
    expect(res.body.telegram).toBe(3);

    const toSilent = botCalls.find((c) => c.method === "sendMessage" && String(c.payload.chat_id) === TG.silent);
    expect(toSilent?.payload.parse_mode).toBe("HTML");
    expect(toSilent?.payload.text).toContain(`<b>Явка ${stamp}</b> · напоминание о событии`);
    expect(toSilent?.payload.text).toContain("Место: Точка");
    expect(toSilent?.payload.text).not.toMatch(/rsvp/i);
    expect(toSilent?.payload.reply_markup.inline_keyboard[0][0]).toEqual({ text: "Иду", callback_data: `rsvp:yes:${f.eventId}` });
    expect(toSilent?.payload.reply_markup.inline_keyboard[1][0].url).toBe(`https://pbthub.test/t/${f.code}/event/${f.eventId}`);
  });

  it("капитан видит последнюю рассылку с именами; игроку журнал закрыт", async () => {
    const captain = await login("captain");
    const res = await captain.get(`/api/v1/reminders/events/${f.eventId}/delivery`).set("X-PBTH-Team", f.teamId);
    expect(res.status).toBe(200);
    expect(res.body.lastBroadcast.total).toBe(3);
    expect(res.body.lastBroadcast.delivered).toBe(3);
    expect(res.body.lastBroadcast.items.map((i: any) => i.status)).toEqual(["SENT", "SENT", "SENT"]);
    expect(res.body.members.find((m: any) => m.userId === f.users.answered).rsvpStatus).toBe("CONFIRMED");

    const player = await login("silent");
    const denied = await player.get(`/api/v1/reminders/events/${f.eventId}/delivery`).set("X-PBTH-Team", f.teamId);
    expect(denied.status).toBe(403);
    const oldDenied = await player.get(`/api/v1/notifications/events/${f.eventId}/deliveries`).set("X-PBTH-Team", f.teamId);
    expect(oldDenied.status).toBe(403);
  });
});

describe("права на рассылку по событию (resolveEventAccess)", () => {
  it("владелец платформы вне состава напоминает как капитан и видит журнал, сам сообщения не получает", async () => {
    const owner = await login("owner");
    const res = await owner
      .post(`/api/v1/notifications/events/${f.eventId}/remind`)
      .send({ audience: "ALL", template: "EVENT_REMINDER" });
    expect(res.status).toBe(200);
    const chats = botCalls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.chat_id));
    expect(chats).not.toContain(TG.owner);
    expect(chats).toContain(TG.captain);
    const delivery = await owner.get(`/api/v1/reminders/events/${f.eventId}/delivery`);
    expect(delivery.status).toBe(200);
    expect((await owner.get(`/api/v1/notifications/events/${f.eventId}/deliveries`)).status).toBe(200);
  });

  it("гость события (только чтение) рассылать и читать журнал не может", async () => {
    const { registerEventAccessProvider } = await import("../../lib/event-access.js");
    const off = registerEventAccessProvider({
      name: "test-guest",
      resolve: async ({ userId }) => (userId === f.users.outsider ? { via: "guest", readOnly: true } : null),
    });
    try {
      const guest = await login("outsider");
      const res = await guest.post(`/api/v1/notifications/events/${f.eventId}/remind`).send({ audience: "ALL" });
      expect(res.status).toBe(403);
      expect(botCalls.filter((c) => c.method === "sendMessage")).toHaveLength(0);
      expect((await guest.get(`/api/v1/reminders/events/${f.eventId}/delivery`)).status).toBe(403);
    } finally {
      off();
    }
  });
});

describe("авто-напоминания", () => {
  it("отключил в профиле — не получает", async () => {
    const muted = await login("muted");
    const off = await muted.put("/api/v1/reminders/settings").send({ autoEventReminders: false });
    expect(off.status).toBe(200);
    expect(off.body).toEqual({ autoEventReminders: false });
    expect((await muted.get("/api/v1/reminders/settings")).body).toEqual({ autoEventReminders: false });
  });

  it("накануне в 19:05 по Москве — только молчунам, кто не отключил; повтор не шлёт", async () => {
    // Событие — через 30 часов; ставим его на завтра 20:30 МСК от подставного «сейчас».
    await pool.query(`UPDATE events SET start_at = '2030-03-12T17:30:00Z' WHERE id = $1`, [f.eventId]);
    await pool.query(`DELETE FROM rsvps WHERE event_id = $1 AND user_id = $2`, [f.eventId, f.users.silent]);
    const now = new Date("2030-03-11T16:05:00Z"); // 19:05 МСК накануне

    const first = await runAutoReminderTick(now);
    expect(first).toMatchObject({ claimed: 2, sent: 2 });
    const sentTo = botCalls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.chat_id));
    expect(sentTo).toEqual(expect.arrayContaining([TG.captain, TG.silent]));
    expect(sentTo).not.toContain(TG.answered);
    expect(sentTo).not.toContain(TG.muted);
    const msg = botCalls.find((c) => c.method === "sendMessage" && String(c.payload.chat_id) === TG.silent);
    expect(msg?.payload.text).toContain("· завтра событие");
    expect(msg?.payload.text).toContain("вторник, 12 марта, 20:30");

    // Повторная проверка через 5 минут и «после перезапуска» (тот же журнал в базе) — ничего нового.
    botCalls.length = 0;
    const second = await runAutoReminderTick(new Date("2030-03-11T16:10:00Z"));
    expect(second.claimed).toBe(0);
    expect(botCalls.filter((c) => c.method === "sendMessage" && String(c.payload.chat_id) === TG.silent)).toHaveLength(0);

    // Утром в день события — второе напоминание тому, кто так и молчит.
    const morning = await runAutoReminderTick(new Date("2030-03-12T06:05:00Z"));
    expect(morning).toMatchObject({ claimed: 2, sent: 2 });
    const rows = await pool.query(
      `SELECT slot, status FROM event_auto_reminders WHERE event_id = $1 AND user_id = $2 ORDER BY created_at`,
      [f.eventId, f.users.silent]
    );
    expect(rows.rows).toEqual([
      { slot: "EVE", status: "SENT" },
      { slot: "MORNING", status: "SENT" },
    ]);

    const captain = await login("captain");
    const delivery = await captain.get(`/api/v1/reminders/events/${f.eventId}/delivery`).set("X-PBTH-Team", f.teamId);
    const silentAuto = delivery.body.auto.find((a: any) => a.userId === f.users.silent);
    expect(silentAuto).toMatchObject({ count: 2, lastSlot: "MORNING", lastStatus: "SENT" });
    expect(delivery.body.members.find((m: any) => m.userId === f.users.muted).autoRemindersOff).toBe(true);
  });

  it("пояс команды: Владивосток получает в свои 19:00, Москва в этот момент — нет", async () => {
    await pool.query(`UPDATE events SET start_at = '2030-03-12T10:30:00Z' WHERE id = $1`, [f.farEventId]); // 20:30 Владивосток
    const at = new Date("2030-03-11T09:05:00Z"); // 19:05 Владивосток, 12:05 Москва
    const result = await runAutoReminderTick(at);
    // Только участник восточной команды: у московской в 12:05 окна нет.
    expect(result).toMatchObject({ claimed: 1, failed: 1 });
    const row = await pool.query(`SELECT status, error_code FROM event_auto_reminders WHERE event_id = $1 AND user_id = $2`, [
      f.farEventId,
      f.users.far,
    ]);
    // У «far» бот не запущен — неудача видна капитану с причиной, повтора нет.
    expect(row.rows[0]).toEqual({ status: "FAILED", error_code: "CHAT_NOT_FOUND" });
    expect((await runAutoReminderTick(at)).claimed).toBe(0);
  });

  it("отменённое и прошедшее событие пропускаются", async () => {
    await pool.query(`UPDATE events SET start_at = '2030-04-12T17:30:00Z', is_cancelled = TRUE WHERE id = $1`, [f.eventId]);
    const result = await runAutoReminderTick(new Date("2030-04-11T16:05:00Z"));
    expect(result.claimed).toBe(0);
    await pool.query(`UPDATE events SET is_cancelled = FALSE WHERE id = $1`, [f.eventId]);
    const after = await runAutoReminderTick(new Date("2030-04-12T17:31:00Z"));
    expect(after.claimed).toBe(0);
  });
});
