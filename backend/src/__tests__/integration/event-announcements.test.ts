// Сообщения игрокам о новом, перенесённом и отменённом событии (спека
// event_announcements, решения Василия 11.11.2026) и дополнение того же дня:
// запасным не слать и авто-напоминания.
//
// Bot API подменён локальным сервером: тест видит каждый запрос бота.
// Время отправки задаёт сама очередь (`due_at`), а проверка запускается
// с подставленным «сейчас», поэтому тест не зависит от времени суток.

import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";

const stamp = Date.now() % 1_000_000;
const TG = {
  captain: String(971_000_000 + stamp),
  yes: String(972_000_000 + stamp),
  maybe: String(973_000_000 + stamp),
  silent: String(974_000_000 + stamp),
  no: String(975_000_000 + stamp),
  injured: String(976_000_000 + stamp),
  vacation: String(977_000_000 + stamp),
  reserveYes: String(978_000_000 + stamp),
  reserveSilent: String(979_000_000 + stamp),
  mutedSilent: String(969_000_000 + stamp),
  mutedYes: String(968_000_000 + stamp),
};
type Who = keyof typeof TG;
const ALL = Object.keys(TG) as Who[];

type BotCall = { method: string; payload: Record<string, any> };
const botCalls: BotCall[] = [];
let botServer: http.Server;

process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
process.env.TELEGRAM_CALLBACK_URL =
  process.env.TELEGRAM_CALLBACK_URL || "http://127.0.0.1:8000/api/v1/auth/telegram/callback";
process.env.TELEGRAM_WEBHOOK_SECRET = "announce-test-secret";
process.env.FRONTEND_URL = "https://pbthub.test";
process.env.DEV_AUTH_ENABLED = "1";
process.env.DEV_AUTH_SECRET = "";
process.env.NOTIFICATIONS_QUEUE_ENABLED = "0";
process.env.EVENT_ANNOUNCEMENTS_ENABLED = "1";
process.env.ADMIN_ROLE_ALLOWLIST_IDS = "";

let app: typeof import("../../app.js").app;
let pool: typeof import("../../db/pool.js").pool;
let runEventAnnouncementTick: typeof import("../../modules/announcements/send.js").runEventAnnouncementTick;
let runAutoReminderTick: typeof import("../../modules/reminders/auto.js").runAutoReminderTick;
let enqueue: typeof import("../../modules/announcements/enqueue.js");
let zonedTimeToUtc: typeof import("../../lib/notification-schedule.js").zonedTimeToUtc;
let localParts: typeof import("../../lib/notification-schedule.js").localParts;
let formatEventWhen: typeof import("../../lib/notification-messages.js").formatEventWhen;

const f = {
  teamId: "",
  code: `an${stamp}`,
  users: {} as Record<Who, string>,
  mainEventId: "",
};

const agents = new Map<Who, ReturnType<typeof request.agent>>();
async function login(who: Who) {
  const cached = agents.get(who);
  if (cached) return cached;
  const agent = request.agent(app);
  const res = await agent
    .post("/api/v1/auth/dev/login")
    .send({ telegramId: TG[who], username: `an_${who}_${stamp}`, ensureTeam: false });
  expect(res.status).toBe(200);
  agents.set(who, agent);
  return agent;
}

/** Начало события: через `days` дней от сегодня, в `hour:minute` по Москве. */
function mskAt(days: number, hour: number, minute = 0): Date {
  const today = localParts(new Date(Date.now() + days * 86_400_000), "Europe/Moscow");
  return zonedTimeToUtc(today.year, today.month, today.day, hour, minute, "Europe/Moscow");
}

async function createEvent(title: string, startAt: Date, extra: Record<string, unknown> = {}) {
  const captain = await login("captain");
  const res = await captain
    .post("/api/v1/events")
    .set("X-PBTH-Team", f.teamId)
    .send({ type: "TRAINING", title, startAt: startAt.toISOString(), location: "Точка", ...extra });
  expect(res.status).toBe(201);
  return res.body as { event?: { id: string }; seriesId?: string };
}

type Row = {
  id: string;
  event_id: string;
  series_id: string | null;
  scope: string;
  kind: string;
  status: string;
  due_at: Date;
  payload: Record<string, any>;
  batch_id: string | null;
  skip_reason: string | null;
};

async function rowsOf(eventId: string): Promise<Row[]> {
  const r = await pool.query<Row>(
    `SELECT id, event_id, series_id::text, scope, kind, status, due_at, payload, batch_id::text, skip_reason
       FROM event_announcements WHERE event_id = $1 ORDER BY created_at`,
    [eventId]
  );
  return r.rows;
}

function sent() {
  return botCalls.filter((c) => c.method === "sendMessage");
}
function chatsOf(calls: BotCall[]) {
  return calls.map((c) => String(c.payload.chat_id));
}
function whoGot(calls: BotCall[]): Who[] {
  const chats = new Set(chatsOf(calls));
  return ALL.filter((who) => chats.has(TG[who])).sort();
}
function sorted(list: Who[]) {
  return [...list].sort();
}

async function setRsvp(who: Who, eventId: string, status: "CONFIRMED" | "PENDING" | "DECLINED") {
  await pool.query(
    `INSERT INTO rsvps (event_id, user_id, status) VALUES ($1, $2, $3::rsvp_status)
     ON CONFLICT (event_id, user_id) DO UPDATE SET status = EXCLUDED.status`,
    [eventId, f.users[who], status]
  );
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
      res.end(JSON.stringify({ ok: true, result: { message_id: 500 + botCalls.length } }));
    });
  });
  await new Promise<void>((resolve) => botServer.listen(0, "127.0.0.1", resolve));
  process.env.TELEGRAM_BOT_API_BASE_URL = `http://127.0.0.1:${(botServer.address() as AddressInfo).port}`;

  ({ app } = await import("../../app.js"));
  ({ pool } = await import("../../db/pool.js"));
  ({ runEventAnnouncementTick } = await import("../../modules/announcements/send.js"));
  ({ runAutoReminderTick } = await import("../../modules/reminders/auto.js"));
  enqueue = await import("../../modules/announcements/enqueue.js");
  ({ zonedTimeToUtc, localParts } = await import("../../lib/notification-schedule.js"));
  ({ formatEventWhen } = await import("../../lib/notification-messages.js"));

  const team = await pool.query<{ id: string }>(
    `INSERT INTO teams (name, short_code, timezone) VALUES ($1, $2, 'Europe/Moscow') RETURNING id`,
    [`Holy ${stamp}`, f.code.toUpperCase()]
  );
  f.teamId = team.rows[0].id;

  for (const who of ALL) {
    const u = await pool.query<{ id: string }>(
      `INSERT INTO users (telegram_id, username, name, nickname, account_role, onboarding_completed_at, role_selected_at)
       VALUES ($1::bigint, $2, $3, $4, 'USER', NOW(), NOW()) RETURNING id`,
      [TG[who], `an_${who}_${stamp}`, `Анонс ${who}`, `an_${who}`]
    );
    f.users[who] = u.rows[0].id;
  }
  const memberStatus: Partial<Record<Who, string>> = {
    injured: "INJURED",
    vacation: "VACATION",
    reserveYes: "RESERVE",
    reserveSilent: "RESERVE",
  };
  for (const who of ALL) {
    await pool.query(
      `INSERT INTO team_memberships (user_id, team_id, role, status) VALUES ($1, $2, $3::membership_role, $4::player_status)`,
      [f.users[who], f.teamId, who === "captain" ? "CAPTAIN" : "PLAYER", memberStatus[who] ?? "ACTIVE"]
    );
  }
  for (const who of ["mutedSilent", "mutedYes"] as Who[]) {
    await pool.query(`INSERT INTO user_notification_settings (user_id, auto_event_reminders) VALUES ($1, FALSE)`, [f.users[who]]);
  }
});

afterAll(async () => {
  process.env.EVENT_ANNOUNCEMENTS_ENABLED = "0";
  await pool.query(`DELETE FROM teams WHERE id = $1`, [f.teamId]);
  await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.values(f.users)]);
  await new Promise<void>((resolve) => botServer.close(() => resolve()));
});

beforeEach(() => {
  botCalls.length = 0;
});

// Новое событие: всем в составе, кроме запасных, создателя и выключивших авто-напоминания.
const CREATED_AUDIENCE: Who[] = ["yes", "maybe", "silent", "no", "injured", "vacation"];

describe("новое событие", () => {
  it("1. строка PENDING; до срока — тишина; после срока — всем, кроме создателя, запасных и выключивших; журнал одним batch_id", async () => {
    const start = mskAt(3, 16);
    const created = await createEvent("Закрытие сезона", start);
    f.mainEventId = created.event!.id;

    const [row] = await rowsOf(f.mainEventId);
    expect(row).toMatchObject({ scope: "EVENT", kind: "CREATED", status: "PENDING", series_id: null });
    expect(new Date(row.due_at).getTime()).toBeGreaterThan(Date.now());

    const early = await runEventAnnouncementTick(new Date(new Date(row.due_at).getTime() - 1000));
    expect(early.claimed).toBe(0);
    expect(sent()).toHaveLength(0);

    const tick = await runEventAnnouncementTick(new Date(new Date(row.due_at).getTime() + 1000));
    expect(tick.claimed).toBe(1);
    expect(whoGot(sent())).toEqual(sorted(CREATED_AUDIENCE));
    expect(sent()).toHaveLength(CREATED_AUDIENCE.length);

    const toSilent = sent().find((c) => String(c.payload.chat_id) === TG.silent)!;
    expect(toSilent.payload.parse_mode).toBe("HTML");
    expect(toSilent.payload.text).toBe(
      [`<b>Holy ${stamp}</b> · новое событие`, "Закрытие сезона", formatEventWhen(start, "Europe/Moscow"), "Место: Точка", "", "Идёшь?"].join("\n")
    );
    expect(toSilent.payload.reply_markup.inline_keyboard).toEqual([
      [
        { text: "Иду", callback_data: `rsvp:yes:${f.mainEventId}` },
        { text: "Не иду", callback_data: `rsvp:no:${f.mainEventId}` },
      ],
      [{ text: "Открыть событие", url: `https://pbthub.test/t/${f.code}/event/${f.mainEventId}` }],
    ]);

    const [after] = await rowsOf(f.mainEventId);
    expect(after.status).toBe("SENT");
    const deliveries = await pool.query<{ user_id: string; status: string; batch_id: string }>(
      `SELECT user_id, status, batch_id::text FROM notification_deliveries WHERE event_id = $1 AND kind = 'EVENT_ANNOUNCEMENT'`,
      [f.mainEventId]
    );
    expect(deliveries.rows).toHaveLength(CREATED_AUDIENCE.length);
    expect(new Set(deliveries.rows.map((d) => d.batch_id))).toEqual(new Set([after.batch_id]));
    expect(deliveries.rows.every((d) => d.status === "SENT")).toBe(true);

    // Повторная проверка ничего не шлёт: строка уже отправлена.
    botCalls.length = 0;
    expect((await runEventAnnouncementTick(new Date(new Date(row.due_at).getTime() + 60_000))).claimed).toBe(0);
    expect(sent()).toHaveLength(0);

    // «Кому дошло» подписывает рассылку как сообщение о новом событии.
    const captain = await login("captain");
    const delivery = await captain.get(`/api/v1/reminders/events/${f.mainEventId}/delivery`).set("X-PBTH-Team", f.teamId);
    expect(delivery.status).toBe(200);
    expect(delivery.body.lastBroadcast).toMatchObject({ kind: "ANNOUNCEMENT_CREATED", total: CREATED_AUDIENCE.length, delivered: CREATED_AUDIENCE.length });
  });

  it("2. создали и удалили до срока — ничего не ушло, строка SKIPPED, отмены нет", async () => {
    const created = await createEvent("Передумали", mskAt(3, 17));
    const eventId = created.event!.id;
    const [row] = await rowsOf(eventId);
    const captain = await login("captain");
    expect((await captain.delete(`/api/v1/events/${eventId}`).set("X-PBTH-Team", f.teamId)).status).toBe(200);

    const rows = await rowsOf(eventId);
    expect(rows.map((r) => [r.kind, r.status])).toEqual([["CREATED", "SKIPPED"]]);
    await runEventAnnouncementTick(new Date(new Date(row.due_at).getTime() + 1000));
    expect(sent()).toHaveLength(0);
  });

  it("3. создали и поправили время до срока — ушло одно сообщение с новым временем", async () => {
    const created = await createEvent("Поправим", mskAt(3, 18));
    const eventId = created.event!.id;
    const newStart = mskAt(4, 19, 30);
    const captain = await login("captain");
    const res = await captain.patch(`/api/v1/events/${eventId}`).set("X-PBTH-Team", f.teamId).send({ startAt: newStart.toISOString() });
    expect(res.status).toBe(200);

    const rows = await rowsOf(eventId);
    expect(rows.map((r) => [r.kind, r.status])).toEqual([["CREATED", "PENDING"]]);
    await runEventAnnouncementTick(new Date(new Date(rows[0].due_at).getTime() + 1000));
    expect(whoGot(sent())).toEqual(sorted(CREATED_AUDIENCE));
    expect(sent()).toHaveLength(CREATED_AUDIENCE.length);
    for (const call of sent()) {
      expect(call.payload.text).toContain(formatEventWhen(newStart, "Europe/Moscow"));
      expect(call.payload.text).toContain("· новое событие");
    }
  });
});

// Перенос и отмена: «иду» и «думаю» — всегда; молчащие — если не запасные и не выключили; отказавшимся — нет.
const CHANGE_AUDIENCE: Who[] = ["yes", "maybe", "silent", "injured", "vacation", "reserveYes", "mutedYes"];

describe("перенос и отмена", () => {
  it("4. перенесли после отправки — «перенесено» получили «иду», «думаю», молчащие и запасной с «иду»", async () => {
    await setRsvp("yes", f.mainEventId, "CONFIRMED");
    await setRsvp("maybe", f.mainEventId, "PENDING");
    await setRsvp("no", f.mainEventId, "DECLINED");
    await setRsvp("reserveYes", f.mainEventId, "CONFIRMED");
    await setRsvp("mutedYes", f.mainEventId, "CONFIRMED");

    const before = (await pool.query<{ start_at: Date }>(`SELECT start_at FROM events WHERE id = $1`, [f.mainEventId])).rows[0].start_at;
    const newStart = mskAt(4, 12);
    const captain = await login("captain");
    const res = await captain
      .patch(`/api/v1/events/${f.mainEventId}`)
      .set("X-PBTH-Team", f.teamId)
      .send({ startAt: newStart.toISOString() });
    expect(res.status).toBe(200);

    // Правка названия — без сообщения.
    await captain.patch(`/api/v1/events/${f.mainEventId}`).set("X-PBTH-Team", f.teamId).send({ title: "Закрытие сезона!" });
    const pending = (await rowsOf(f.mainEventId)).filter((r) => r.status === "PENDING");
    expect(pending.map((r) => r.kind)).toEqual(["RESCHEDULED"]);
    expect(new Date(pending[0].payload.previousStartAt).getTime()).toBe(new Date(before).getTime());
    expect(pending[0].payload.previousLocation).toBe("Точка");

    await runEventAnnouncementTick(new Date(new Date(pending[0].due_at).getTime() + 1000));
    expect(whoGot(sent())).toEqual(sorted(CHANGE_AUDIENCE));
    const toYes = sent().find((c) => String(c.payload.chat_id) === TG.yes)!;
    expect(toYes.payload.text).toBe(
      [
        `<b>Holy ${stamp}</b> · событие перенесено`,
        "Закрытие сезона!",
        formatEventWhen(newStart, "Europe/Moscow"),
        "Место: Точка",
        `Было: ${formatEventWhen(before, "Europe/Moscow")}`,
        "",
        "Сейчас у тебя: иду. Передумаешь — нажми «Не иду».",
      ].join("\n")
    );
    expect(toYes.payload.reply_markup.inline_keyboard[0][0]).toEqual({ text: "Иду", callback_data: `rsvp:yes:${f.mainEventId}` });
    // Прежние ответы сохраняются.
    const kept = await pool.query(`SELECT count(*)::int AS n FROM rsvps WHERE event_id = $1`, [f.mainEventId]);
    expect(kept.rows[0].n).toBe(5);
  });

  it("5. отменили — «отменено» без кнопок ответа тем же людям", async () => {
    const captain = await login("captain");
    expect((await captain.delete(`/api/v1/events/${f.mainEventId}`).set("X-PBTH-Team", f.teamId)).status).toBe(200);
    const pending = (await rowsOf(f.mainEventId)).filter((r) => r.status === "PENDING");
    expect(pending.map((r) => [r.kind, r.payload.title])).toEqual([["CANCELLED", "Закрытие сезона!"]]);

    await runEventAnnouncementTick(new Date(new Date(pending[0].due_at).getTime() + 1000));
    expect(whoGot(sent())).toEqual(sorted(CHANGE_AUDIENCE));
    for (const call of sent()) {
      expect(call.payload.text).toContain("· событие отменено");
      expect(call.payload.reply_markup.inline_keyboard).toEqual([[{ text: "Открыть календарь", url: `https://pbthub.test/t/${f.code}/calendar` }]]);
    }
  });
});

describe("серия", () => {
  it("6. одно сообщение с кнопкой series:yes; нажатие записывает на серию; записанный не получает", async () => {
    // Ближайший вторник не раньше чем через 3 дня, 20:30 по Москве; вт и чт на две недели.
    let days = 3;
    while (new Date(mskAt(days, 20, 30)).getUTCDay() !== 2) days += 1;
    const first = mskAt(days, 20, 30);
    const until = new Date(first.getTime() + 13 * 86_400_000).toISOString().slice(0, 10);
    const created = await createEvent("Тренировка", first, { recurrence: { enabled: true, weekdays: ["TUE", "THU"], untilDate: until } });
    const seriesId = created.seriesId!;

    const rows = await pool.query<Row>(`SELECT * FROM event_announcements WHERE series_id = $1`, [seriesId]);
    expect(rows.rows.map((r) => [r.scope, r.kind, r.status])).toEqual([["SERIES", "CREATED", "PENDING"]]);

    // «yes» записался на серию до отправки — сообщение ему не нужно.
    const yes = await login("yes");
    expect((await yes.post(`/api/v1/events/series/${seriesId}/commit`)).status).toBe(200);

    await runEventAnnouncementTick(new Date(new Date(rows.rows[0].due_at).getTime() + 1000));
    expect(whoGot(sent())).toEqual(sorted(["maybe", "silent", "no", "injured", "vacation"]));
    expect(sent()).toHaveLength(5);
    const toSilent = sent().find((c) => String(c.payload.chat_id) === TG.silent)!;
    expect(toSilent.payload.text).toContain("· новые занятия");
    expect(toSilent.payload.text).toContain("вт и чт в 20:30");
    expect(toSilent.payload.text).toContain("· 4 занятия");
    expect(toSilent.payload.reply_markup.inline_keyboard[0]).toEqual([{ text: "Иду на все", callback_data: `series:yes:${seriesId}` }]);

    botCalls.length = 0;
    const press = await request(app)
      .post("/api/v1/vendor/telegram/webhook")
      .set("x-telegram-bot-api-secret-token", "announce-test-secret")
      .send({
        update_id: 1,
        callback_query: {
          id: `cb-series-${stamp}`,
          data: `series:yes:${seriesId}`,
          from: { id: Number(TG.silent) },
          message: { message_id: 42, chat: { id: Number(TG.silent) }, text: "Holy · новые занятия\nТренировка\n\nХодишь на все?", entities: [{ type: "bold", offset: 0, length: 4 }] },
        },
      });
    expect(press.status).toBe(200);
    const commit = await pool.query(`SELECT status FROM event_series_commitment WHERE series_id = $1 AND user_id = $2`, [seriesId, f.users.silent]);
    expect(commit.rows[0]?.status).toBe("COMMITTED");
    expect(botCalls.find((c) => c.method === "answerCallbackQuery")?.payload.text).toBe("Записал на все занятия");
    const edit = botCalls.find((c) => c.method === "editMessageText")!;
    expect(edit.payload.text).toBe(
      "Holy · новые занятия\nТренировка\n\nТы ходишь на все занятия. Отказаться от отдельного можно в приложении."
    );
    expect(edit.payload.entities).toEqual([{ type: "bold", offset: 0, length: 4 }]);
    expect(edit.payload.reply_markup.inline_keyboard).toHaveLength(1);
    expect(edit.payload.reply_markup.inline_keyboard[0][0].text).toBe("Открыть");

    // Не участник команды — согласие не пишется.
    botCalls.length = 0;
    await request(app)
      .post("/api/v1/vendor/telegram/webhook")
      .set("x-telegram-bot-api-secret-token", "announce-test-secret")
      .send({ update_id: 2, callback_query: { id: "cb-x", data: `series:yes:${seriesId}`, from: { id: 1 }, message: { message_id: 1, chat: { id: 1 } } } });
    expect(botCalls.find((c) => c.method === "answerCallbackQuery")?.payload.text).toContain("Не нашёл тебя в PBTH");
    expect(botCalls.some((c) => c.method === "editMessageText")).toBe(false);
  });
});

describe("не два сообщения подряд", () => {
  it("7. «новое событие» ушло за час до 19:00 накануне — авто-напоминание в 19:00 этому человеку не уходит", async () => {
    const start = mskAt(9, 20, 30);
    const created = await createEvent("Матч", start);
    const eventId = created.event!.id;
    const eveDay = localParts(new Date(start.getTime() - 86_400_000), "Europe/Moscow");
    const at18 = zonedTimeToUtc(eveDay.year, eveDay.month, eveDay.day, 18, 0, "Europe/Moscow");
    const at1905 = zonedTimeToUtc(eveDay.year, eveDay.month, eveDay.day, 19, 5, "Europe/Moscow");
    await pool.query(`UPDATE event_announcements SET due_at = $2 WHERE event_id = $1`, [eventId, at18]);

    await runEventAnnouncementTick(new Date(at18.getTime() + 1000));
    expect(whoGot(sent())).toEqual(sorted(CREATED_AUDIENCE));

    botCalls.length = 0;
    await runAutoReminderTick(at1905);
    const aboutMatch = sent().filter((c) => String(c.payload.text).includes("Матч"));
    // Создатель сообщения о новом событии не получал — ему авто-напоминание уходит, остальным нет.
    expect(whoGot(aboutMatch)).toEqual(["captain"]);

    const captain = await login("captain");
    const delivery = await captain.get(`/api/v1/reminders/events/${eventId}/delivery`).set("X-PBTH-Team", f.teamId);
    expect(delivery.body.auto.map((a: any) => a.userId)).toEqual([f.users.captain]);
    expect(delivery.body.lastBroadcast.kind).toBe("ANNOUNCEMENT_CREATED");
  });
});

describe("запасным не слать и авто-напоминания (дополнение 11.11.2026)", () => {
  it("запасной без ответа не получает ни вечернее, ни утреннее; в строю, в травме и в отпуске — получают", async () => {
    // Событие заводится прямо в базе: сообщения о новом событии здесь ни при чём.
    const start = mskAt(12, 20, 30);
    const ev = await pool.query<{ id: string }>(
      `INSERT INTO events (team_id, type, title, start_at) VALUES ($1, 'TRAINING', 'Запасные', $2) RETURNING id`,
      [f.teamId, start]
    );
    const eventId = ev.rows[0].id;
    const eveDay = localParts(new Date(start.getTime() - 86_400_000), "Europe/Moscow");
    const day = localParts(start, "Europe/Moscow");
    const expected = sorted(["captain", "yes", "maybe", "silent", "no", "injured", "vacation"]);

    await runAutoReminderTick(zonedTimeToUtc(eveDay.year, eveDay.month, eveDay.day, 19, 5, "Europe/Moscow"));
    const eve = sent().filter((c) => String(c.payload.text).includes("Запасные"));
    expect(whoGot(eve)).toEqual(expected);
    expect(whoGot(eve)).not.toContain("reserveSilent");

    botCalls.length = 0;
    await runAutoReminderTick(zonedTimeToUtc(day.year, day.month, day.day, 9, 5, "Europe/Moscow"));
    const morning = sent().filter((c) => String(c.payload.text).includes("Запасные"));
    expect(whoGot(morning)).toEqual(expected);

    // «Кому дошло»: у запасных признак «в запасе».
    const captain = await login("captain");
    const delivery = await captain.get(`/api/v1/reminders/events/${eventId}/delivery`).set("X-PBTH-Team", f.teamId);
    const reserve = delivery.body.members.filter((m: any) => m.reserve).map((m: any) => m.userId).sort();
    expect(reserve).toEqual([f.users.reserveSilent, f.users.reserveYes].sort());

    // Ручное «Напомнить» запасных по-прежнему зовёт.
    botCalls.length = 0;
    const res = await captain
      .post(`/api/v1/notifications/events/${eventId}/remind`)
      .set("X-PBTH-Team", f.teamId)
      .send({ audience: "ALL", template: "EVENT_REMINDER" });
    expect(res.status).toBe(200);
    expect(chatsOf(sent())).toContain(TG.reserveSilent);
  });
});

describe("правка до отправки пересчитывает срок", () => {
  // Время подставляется прямо в постановку в очередь: ночь нужна независимо от часов теста.
  function mskOn(day: { year: number; month: number; day: number }, shiftDays: number, hour: number, minute = 0) {
    const d = new Date(Date.UTC(day.year, day.month - 1, day.day + shiftDays));
    return zonedTimeToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hour, minute, "Europe/Moscow");
  }
  const base = () => localParts(new Date(Date.now() + 20 * 86_400_000), "Europe/Moscow");

  async function insertEvent(title: string, startAt: Date) {
    const ev = await pool.query<{ id: string }>(
      `INSERT INTO events (team_id, type, title, start_at, location) VALUES ($1, 'TRAINING', $2, $3, 'Точка') RETURNING id`,
      [f.teamId, title, startAt]
    );
    return ev.rows[0].id;
  }

  it("создано в 23:40 на 16:00 (ждёт 09:00) → в 23:50 перенесли на 08:00 → уходит через 3 минуты без звука и не пропускается", async () => {
    const day = base();
    const createdAt = mskOn(day, 0, 23, 40);
    const editedAt = mskOn(day, 0, 23, 50);
    const at16 = mskOn(day, 1, 16);
    const at08 = mskOn(day, 1, 8);
    const eventId = await insertEvent("Ночная правка", at16);

    await enqueue.announceEventCreated({ teamId: f.teamId, eventId, startAt: at16, actorUserId: f.users.captain, now: createdAt });
    let [row] = await rowsOf(eventId);
    expect(new Date(row.due_at)).toEqual(mskOn(day, 1, 9));
    expect(row.payload.silent).toBe(false);

    await pool.query(`UPDATE events SET start_at = $2 WHERE id = $1`, [eventId, at08]);
    await enqueue.announceEventChanged({
      teamId: f.teamId,
      eventId,
      seriesId: null,
      before: { startAt: at16, location: "Точка" },
      after: { startAt: at08, location: "Точка" },
      actorUserId: f.users.captain,
      now: editedAt,
    });
    const rows = await rowsOf(eventId);
    expect(rows.map((r) => [r.kind, r.status])).toEqual([["CREATED", "PENDING"]]);
    row = rows[0];
    expect(new Date(row.due_at)).toEqual(new Date(editedAt.getTime() + 180_000));
    expect(row.payload.silent).toBe(true);

    const tick = await runEventAnnouncementTick(new Date(editedAt.getTime() + 181_000));
    expect(tick).toMatchObject({ claimed: 1, sent: 1, skipped: 0 });
    expect(whoGot(sent())).toEqual(sorted(CREATED_AUDIENCE));
    expect(sent().every((c) => c.payload.disable_notification === true)).toBe(true);
    expect(sent()[0].payload.text).toContain(formatEventWhen(at08, "Europe/Moscow"));
  });

  it("обратный: ночью перенесли с 08:00 на 16:00 — срок сдвигается на 09:00, со звуком", async () => {
    const day = base();
    const createdAt = mskOn(day, 1, 23, 40);
    const at08 = mskOn(day, 2, 8);
    const at16 = mskOn(day, 2, 16);
    const eventId = await insertEvent("Ночная правка 2", at08);

    await enqueue.announceEventCreated({ teamId: f.teamId, eventId, startAt: at08, actorUserId: f.users.captain, now: createdAt });
    let [row] = await rowsOf(eventId);
    expect(new Date(row.due_at)).toEqual(new Date(createdAt.getTime() + 180_000));
    expect(row.payload.silent).toBe(true);

    await pool.query(`UPDATE events SET start_at = $2 WHERE id = $1`, [eventId, at16]);
    await enqueue.announceEventChanged({
      teamId: f.teamId,
      eventId,
      seriesId: null,
      before: { startAt: at08, location: "Точка" },
      after: { startAt: at16, location: "Точка" },
      actorUserId: f.users.captain,
      now: new Date(createdAt.getTime() + 60_000),
    });
    [row] = await rowsOf(eventId);
    expect(new Date(row.due_at)).toEqual(mskOn(day, 2, 9));
    expect(row.payload.silent).toBe(false);
    // Строка остаётся ожидающей, с ней разбираемся здесь же.
    await pool.query(`DELETE FROM event_announcements WHERE event_id = $1`, [eventId]);
  });

  it("серия: правка занятия и «это и все следующие» пересчитывают срок ожидающего сообщения о серии от ближайшего занятия", async () => {
    let days = 4;
    while (new Date(mskAt(days, 16)).getUTCDay() !== 2) days += 1;
    const first = mskAt(days, 16);
    const until = new Date(first.getTime() + 9 * 86_400_000).toISOString().slice(0, 10);
    const created = await createEvent("Серия ночью", first, { recurrence: { enabled: true, weekdays: ["TUE", "THU"], untilDate: until } });
    const seriesId = created.seriesId!;
    const occ = await pool.query<{ id: string; start_at: Date }>(
      `SELECT id, start_at FROM events WHERE series_id = $1 ORDER BY start_at`,
      [seriesId]
    );
    const firstId = occ.rows[0].id;
    const firstDay = localParts(first, "Europe/Moscow");
    const night = mskOn(firstDay, -1, 23, 50);
    const at08 = mskOn(firstDay, 0, 8);
    const pendingSeries = async () =>
      (await pool.query<Row>(`SELECT * FROM event_announcements WHERE series_id = $1 AND status = 'PENDING'`, [seriesId])).rows;

    // Одно занятие перенесли ночью на 08:00 — сообщение о серии уходит через 3 минуты без звука.
    await pool.query(`UPDATE events SET start_at = $2 WHERE id = $1`, [firstId, at08]);
    await enqueue.announceEventChanged({
      teamId: f.teamId,
      eventId: firstId,
      seriesId,
      before: { startAt: first, location: "Точка" },
      after: { startAt: at08, location: "Точка" },
      actorUserId: f.users.captain,
      now: night,
    });
    let rows = await pendingSeries();
    expect(rows.map((r) => [r.scope, r.kind])).toEqual([["SERIES", "CREATED"]]);
    expect(new Date(rows[0].due_at)).toEqual(new Date(night.getTime() + 180_000));
    expect(rows[0].payload.silent).toBe(true);
    expect(await rowsOf(firstId)).toHaveLength(1);

    // «Это и все следующие» вернули на 16:00 — срок снова 09:00, со звуком.
    await pool.query(`UPDATE events SET start_at = $2 WHERE id = $1`, [firstId, first]);
    await enqueue.announceSeriesChanged({
      teamId: f.teamId,
      seriesId,
      anchorEventId: firstId,
      beforeStarts: [at08],
      before: { startAt: at08, location: "Точка" },
      after: { startAt: first, location: "Точка" },
      actorUserId: f.users.captain,
      now: night,
    });
    rows = await pendingSeries();
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0].due_at)).toEqual(mskOn(firstDay, 0, 9));
    expect(rows[0].payload.silent).toBe(false);
    await pool.query(`DELETE FROM event_announcements WHERE series_id = $1`, [seriesId]);
  });
});

describe("выключатель и сбои", () => {
  it("8. рассылка выключена на сервере — строки не пишутся, ничего не уходит", async () => {
    process.env.EVENT_ANNOUNCEMENTS_ENABLED = "0";
    try {
      const created = await createEvent("Без рассылки", mskAt(3, 16));
      const eventId = created.event!.id;
      const captain = await login("captain");
      await captain.patch(`/api/v1/events/${eventId}`).set("X-PBTH-Team", f.teamId).send({ startAt: mskAt(4, 16).toISOString() });
      await captain.delete(`/api/v1/events/${eventId}`).set("X-PBTH-Team", f.teamId);
      expect(await rowsOf(eventId)).toEqual([]);
      await runEventAnnouncementTick(new Date(Date.now() + 30 * 86_400_000));
      expect(sent()).toHaveLength(0);
    } finally {
      process.env.EVENT_ANNOUNCEMENTS_ENABLED = "1";
    }
  });

  it("ошибка записи строки не роняет создание, правку и удаление события", async () => {
    await pool.query(`ALTER TABLE event_announcements ADD CONSTRAINT announce_test_fail CHECK (false) NOT VALID`);
    try {
      const created = await createEvent("Сбой очереди", mskAt(3, 16));
      const eventId = created.event!.id;
      const captain = await login("captain");
      const patched = await captain.patch(`/api/v1/events/${eventId}`).set("X-PBTH-Team", f.teamId).send({ location: "Арена" });
      expect(patched.status).toBe(200);
      expect((await captain.delete(`/api/v1/events/${eventId}`).set("X-PBTH-Team", f.teamId)).status).toBe(200);
      expect(await rowsOf(eventId)).toEqual([]);
    } finally {
      await pool.query(`ALTER TABLE event_announcements DROP CONSTRAINT IF EXISTS announce_test_fail`);
    }
  });
});
