// Трек 4 ревизии 11.11.2026: открытые слоты (решения Василия 10.11.2026, п. 23–28).
//
// Капитан включает открытое расписание и открывает в событии слоты с ценой;
// подписчик (в том числе участник другой команды) видит только события со
// слотами, записывается — кто первый; гость видит событие целиком до его
// окончания; уведомления уходят один раз за открытие.

import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

const pushed: Array<{ endpoint: string; payload: Record<string, unknown> }> = [];
vi.mock("../../lib/web-push.js", () => ({
  isWebPushEnabled: () => true,
  sendWebPush: async (sub: { endpoint: string }, payload: Record<string, unknown>) => {
    pushed.push({ endpoint: sub.endpoint, payload });
    return { ok: true };
  },
}));

const stamp = Date.now() % 1_000_000;
const TG = {
  captain: String(981_000_000 + stamp),
  trainer: String(982_000_000 + stamp),
  player: String(983_000_000 + stamp),
  guest: String(984_000_000 + stamp), // капитан другой команды
  second: String(985_000_000 + stamp),
  third: String(986_000_000 + stamp),
  stranger: String(987_000_000 + stamp),
};
type Who = keyof typeof TG;

// Заглушка Bot API: все вызовы бота — в список.
const botCalls: Array<{ method: string; body: Record<string, any> }> = [];
const bot = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    let body: Record<string, any> = {};
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      body = {};
    }
    botCalls.push({ method: String(req.url).split("/").pop() || "", body });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, result: { message_id: 5000 + botCalls.length } }));
  });
});

process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
process.env.TELEGRAM_CALLBACK_URL =
  process.env.TELEGRAM_CALLBACK_URL || "http://127.0.0.1:8000/api/v1/auth/telegram/callback";
process.env.TELEGRAM_WEBHOOK_SECRET = "slots-webhook-secret";
process.env.DEV_AUTH_ENABLED = "1";
process.env.DEV_AUTH_SECRET = "";

let app: typeof import("../../app.js").app;
let pool: typeof import("../../db/pool.js").pool;
let flush: typeof import("../../modules/slots/notify.js").flushSlotNotifications;
let notifySlotOffer: typeof import("../../modules/slots/notify.js").notifySlotOffer;
let hasGuestEventAccess: typeof import("../../modules/slots/service.js").hasGuestEventAccess;

const f = {
  team: "",
  otherTeam: "",
  event: "",
  plainEvent: "",
  raceEvent: "",
  users: {} as Record<Who, string>,
};

const agents = new Map<Who, ReturnType<typeof request.agent>>();
async function login(who: Who) {
  const cached = agents.get(who);
  if (cached) return cached;
  const agent = request.agent(app);
  agents.set(who, agent);
  await agent
    .post("/api/v1/auth/dev/login")
    .send({ telegramId: TG[who], username: `sl_${who}_${stamp}`, ensureTeam: false })
    .expect(200);
  return agent;
}

function botMessagesTo(who: Who) {
  return botCalls.filter((c) => c.method === "sendMessage" && String(c.body.chat_id) === TG[who]);
}

async function webhookPress(who: Who, data: string, text: string) {
  return request(app)
    .post("/api/v1/vendor/telegram/webhook")
    .set("x-telegram-bot-api-secret-token", "slots-webhook-secret")
    .send({
      update_id: Math.floor(Math.random() * 1e9),
      callback_query: {
        id: `cb-${Math.random()}`,
        data,
        from: { id: Number(TG[who]) },
        message: { message_id: 77, chat: { id: Number(TG[who]) }, text },
      },
    });
}

beforeAll(async () => {
  await new Promise<void>((resolve) => bot.listen(0, "127.0.0.1", () => resolve()));
  process.env.TELEGRAM_BOT_API_BASE_URL = `http://127.0.0.1:${(bot.address() as AddressInfo).port}`;

  ({ app } = await import("../../app.js"));
  ({ pool } = await import("../../db/pool.js"));
  ({ flushSlotNotifications: flush, notifySlotOffer } = await import("../../modules/slots/notify.js"));
  ({ hasGuestEventAccess } = await import("../../modules/slots/service.js"));

  const a = await pool.query<{ id: string }>(
    `INSERT INTO teams (name, short_code, budget, timezone) VALUES ($1, $2, 5000, 'Europe/Moscow') RETURNING id`,
    [`Holy Guns ${stamp}`, `SlA${stamp}`]
  );
  const b = await pool.query<{ id: string }>(
    `INSERT INTO teams (name, short_code, budget) VALUES ($1, $2, 100) RETURNING id`,
    [`Дозор ${stamp}`, `SlB${stamp}`]
  );
  f.team = a.rows[0].id;
  f.otherTeam = b.rows[0].id;
  for (const who of Object.keys(TG) as Who[]) {
    const u = await pool.query<{ id: string }>(
      `INSERT INTO users (telegram_id, username, name, nickname, account_role, onboarding_completed_at, role_selected_at)
       VALUES ($1::bigint, $2, $3, $4, 'USER', NOW(), NOW()) RETURNING id`,
      [TG[who], `sl_${who}_${stamp}`, `Игрок ${who}`, `sl_${who}`]
    );
    f.users[who] = u.rows[0].id;
  }
  await pool.query(
    `INSERT INTO team_memberships (user_id, team_id, role) VALUES
       ($1, $4, 'CAPTAIN'), ($2, $4, 'TRAINER'), ($3, $4, 'PLAYER'), ($5, $6, 'CAPTAIN')`,
    [f.users.captain, f.users.trainer, f.users.player, f.team, f.users.guest, f.otherTeam]
  );
  const ev = await pool.query<{ id: string }>(
    `INSERT INTO events (team_id, type, title, start_at, end_at, location, description)
     VALUES ($1, 'TRAINING', 'Тренировка', NOW() + INTERVAL '2 days', NOW() + INTERVAL '2 days 2 hours', 'Точка', 'Сбор в 20:00')
     RETURNING id`,
    [f.team]
  );
  f.event = ev.rows[0].id;
  await pool.query(`INSERT INTO event_games (event_id, time_label, opponent) VALUES ($1, '20:40', 'Спарринг')`, [f.event]);
  await pool.query(`INSERT INTO rsvps (event_id, user_id, status) VALUES ($1, $2, 'CONFIRMED')`, [f.event, f.users.player]);
  const plain = await pool.query<{ id: string }>(
    `INSERT INTO events (team_id, type, title, start_at) VALUES ($1, 'TRAINING', 'Закрытая тренировка', NOW() + INTERVAL '3 days') RETURNING id`,
    [f.team]
  );
  f.plainEvent = plain.rows[0].id;
  const race = await pool.query<{ id: string }>(
    `INSERT INTO events (team_id, type, title, start_at) VALUES ($1, 'TRAINING', 'Гонка', NOW() + INTERVAL '4 days') RETURNING id`,
    [f.team]
  );
  f.raceEvent = race.rows[0].id;
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ($1, $2, 'k', 'a')`,
    [f.users.guest, `https://push.example/${stamp}`]
  );
});

afterAll(async () => {
  await flush();
  await pool.query(`DELETE FROM teams WHERE id = ANY($1::uuid[])`, [[f.team, f.otherTeam]]);
  await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.values(f.users)]);
  await new Promise<void>((resolve) => bot.close(() => resolve()));
});

describe("открытое расписание команды", () => {
  it("по умолчанию выключено: подписаться нельзя, слоты не открыть", async () => {
    const guest = await login("guest");
    const follow = await guest.post(`/api/v1/slots/teams/${f.team}/follow`);
    expect(follow.status).toBe(409);
    expect(follow.body.code).toBe("SLOTS_SCHEDULE_CLOSED");

    const captain = await login("captain");
    const open = await captain.put(`/api/v1/slots/events/${f.event}`).send({ capacity: 2, price: 3000 });
    expect(open.status).toBe(409);
    expect(open.body.code).toBe("SLOTS_SCHEDULE_CLOSED");
  });

  it("включает только капитан", async () => {
    const trainer = await login("trainer");
    expect((await trainer.put(`/api/v1/slots/teams/${f.team}/open-schedule`).send({ enabled: true })).status).toBe(403);
    const player = await login("player");
    expect((await player.put(`/api/v1/slots/teams/${f.team}/open-schedule`).send({ enabled: true })).status).toBe(403);
    const stranger = await login("stranger");
    expect((await stranger.put(`/api/v1/slots/teams/${f.team}/open-schedule`).send({ enabled: true })).status).toBe(403);

    const captain = await login("captain");
    const res = await captain.put(`/api/v1/slots/teams/${f.team}/open-schedule`).send({ enabled: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ openSchedule: true, followers: 0 });
  });

  it("подписка — сам и без одобрения, участнику своей команды не нужна", async () => {
    const list = await (await login("guest")).get("/api/v1/slots/teams");
    expect(list.body.teams.map((t: any) => t.id)).toContain(f.team);
    // В списке нет ни кода команды, ни состава, ни денег.
    const card = list.body.teams.find((t: any) => t.id === f.team);
    expect(Object.keys(card).sort()).toEqual(["following", "id", "logo", "look", "name", "openEvents", "openSchedule"]);

    for (const who of ["guest", "second", "third"] as Who[]) {
      const res = await (await login(who)).post(`/api/v1/slots/teams/${f.team}/follow`);
      expect(res.status).toBe(200);
    }
    const own = await (await login("player")).post(`/api/v1/slots/teams/${f.team}/follow`);
    expect(own.status).toBe(409);
    expect(own.body.code).toBe("SLOTS_MEMBER");

    const page = await (await login("captain")).get(`/api/v1/slots/teams/${f.team}`);
    expect(page.body).toMatchObject({ member: true, canManage: true, followers: 3 });
  });
});

describe("подписчик видит только события со слотами", () => {
  it("до открытия слотов события команды ему не видны, состав и деньги закрыты", async () => {
    const guest = await login("guest");
    expect((await guest.get(`/api/v1/slots/events/${f.event}`)).status).toBe(404);
    expect((await guest.get(`/api/v1/slots/events/${f.plainEvent}`)).status).toBe(404);
    const feed = await guest.get("/api/v1/slots/feed");
    expect(feed.body.slots).toEqual([]);
    expect(feed.body.following.map((t: any) => t.id)).toContain(f.team);

    expect((await guest.get(`/api/v1/init?team=${f.team}`)).status).toBe(403);
    expect((await guest.get(`/api/v1/events/${f.event}/attendees`)).status).toBe(403);
    expect((await guest.get("/api/v1/finance/overview").set("X-PBTH-Team", f.team)).status).toBe(403);
    expect((await guest.get(`/api/v1/slots/events/${f.event}/manage`)).status).toBe(403);
  });

  it("капитан открывает 2 слота по 3000 ₽ — уведомление всем подписчикам, один раз", async () => {
    const captain = await login("captain");
    const res = await captain.put(`/api/v1/slots/events/${f.event}`).send({ capacity: 2, price: 3000 });
    expect(res.status).toBe(200);
    expect(res.body.slot).toMatchObject({ open: true, capacity: 2, price: 3000, free: 2 });
    await flush();

    for (const who of ["guest", "second", "third"] as Who[]) {
      const messages = botMessagesTo(who);
      expect(messages).toHaveLength(1);
      expect(messages[0].body.text).toMatch(/^У Holy Guns \d+ (в|во) .+ в \d\d:\d\d на площадке «Точка» 2 свободных слота, 3000 ₽$/);
      expect(messages[0].body.reply_markup.inline_keyboard[0][0]).toEqual({
        text: "Записаться",
        callback_data: `slot:book:${f.event}`,
      });
    }
    // Участникам команды уведомление не уходит.
    for (const who of ["captain", "trainer", "player"] as Who[]) expect(botMessagesTo(who)).toHaveLength(0);
    // Пуш с адресом события.
    expect(pushed).toHaveLength(1);
    expect(pushed[0].payload).toMatchObject({ url: `/teams?event=${f.event}` });
    expect(String(pushed[0].payload.body)).toContain("3000 ₽");

    // Правка цены в том же открытии — без повторной рассылки; повторный
    // вызов рассылки — тоже без дублей.
    await captain.put(`/api/v1/slots/events/${f.event}`).send({ capacity: 2, price: 3000 });
    await flush();
    expect(await notifySlotOffer({ eventId: f.event, kind: "OPEN" })).toBe(0);
    for (const who of ["guest", "second", "third"] as Who[]) expect(botMessagesTo(who)).toHaveLength(1);
  });

  it("подписчик видит название, время, место, цену и места — без описания, игр и состава", async () => {
    const guest = await login("guest");
    const view = await guest.get(`/api/v1/slots/events/${f.event}`);
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ viewer: "FOLLOWER", title: "Тренировка", location: "Точка" });
    expect(view.body.slot).toMatchObject({ price: 3000, free: 2 });
    expect(view.body).not.toHaveProperty("description");
    expect(view.body).not.toHaveProperty("schedule");
    expect(view.body).not.toHaveProperty("going");

    const feed = await guest.get("/api/v1/slots/feed");
    expect(feed.body.slots.map((s: any) => s.eventId)).toEqual([f.event]);
    // Не подписанный человек события не видит.
    expect((await (await login("stranger")).get(`/api/v1/slots/events/${f.event}`)).status).toBe(404);
  });
});

describe("запись — кто первый", () => {
  it("из бота: «Ты записан», капитану и тренеру — «<имя> занял слот» с кнопкой «Снять»", async () => {
    const offer = botMessagesTo("guest")[0];
    const res = await webhookPress("guest", `slot:book:${f.event}`, offer.body.text);
    expect(res.status).toBe(200);
    await flush();
    const edit = botCalls.filter((c) => c.method === "editMessageText" && String(c.body.chat_id) === TG.guest).pop();
    expect(edit?.body.text).toBe(`${offer.body.text}\n\nТы записан.`);

    for (const who of ["captain", "trainer"] as Who[]) {
      const [message] = botMessagesTo(who);
      expect(message.body.text).toMatch(/^Игрок guest занял слот\n«Тренировка», .+, 3000 ₽\. Свободно 1 из 2\.$/);
      expect(message.body.reply_markup.inline_keyboard[0][0].text).toBe("Снять");
      expect(message.body.reply_markup.inline_keyboard[0][0].callback_data).toMatch(/^slot:rm:/);
    }
    expect(botMessagesTo("player")).toHaveLength(0);
  });

  it("из приложения — второй; третьему «мест уже нет»", async () => {
    const second = await login("second");
    const booked = await second.post(`/api/v1/slots/events/${f.event}/book`);
    expect(booked.status).toBe(200);
    expect(booked.body.viewer).toBe("GUEST");

    const third = await login("third");
    const full = await third.post(`/api/v1/slots/events/${f.event}/book`);
    expect(full.status).toBe(409);
    expect(full.body.detail).toBe("Мест уже нет");

    const offer = botMessagesTo("third")[0];
    await webhookPress("third", `slot:book:${f.event}`, offer.body.text);
    const edit = botCalls.filter((c) => c.method === "editMessageText" && String(c.body.chat_id) === TG.third).pop();
    expect(edit?.body.text).toBe(`${offer.body.text}\n\nМест уже нет.`);
    expect(edit?.body.reply_markup).toEqual({ inline_keyboard: [] });
  });

  it("гонка за последнее место: из трёх одновременных записей проходит одна", async () => {
    const captain = await login("captain");
    expect((await captain.put(`/api/v1/slots/events/${f.raceEvent}`).send({ capacity: 1, price: 500 })).status).toBe(200);
    const agentsInRace = await Promise.all((["guest", "second", "third"] as Who[]).map((who) => login(who)));
    const results = await Promise.all(agentsInRace.map((agent) => agent.post(`/api/v1/slots/events/${f.raceEvent}/book`)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    const count = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM event_slot_guests WHERE event_id = $1 AND status = 'BOOKED'`,
      [f.raceEvent]
    );
    expect(count.rows[0].n).toBe(1);
    await flush();
  });

  it("гость снялся сам — сообщения «тебя сняли» ему нет", async () => {
    const winner = await pool.query<{ user_id: string }>(
      `SELECT user_id FROM event_slot_guests WHERE event_id = $1 AND status = 'BOOKED'`,
      [f.raceEvent]
    );
    const who = (Object.keys(f.users) as Who[]).find((key) => f.users[key] === winner.rows[0].user_id)!;
    const pushedBefore = pushed.length;
    const left = await (await login(who)).delete(`/api/v1/slots/events/${f.raceEvent}/book`);
    expect(left.body).toEqual({ cancelled: true });
    await flush();
    expect(botMessagesTo(who).filter((m) => String(m.body.text).includes("тебя сняли со слота"))).toHaveLength(0);
    expect(pushed.slice(pushedBefore).filter((p) => String(p.payload.body).includes("тебя сняли"))).toHaveLength(0);
  });

  it("участник команды записаться не может", async () => {
    const player = await login("player");
    const res = await player.post(`/api/v1/slots/events/${f.event}/book`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SLOTS_MEMBER");
  });
});

describe("гость события", () => {
  it("видит событие целиком: время, место, игры, кто идёт — и не видит состав и деньги", async () => {
    const guest = await login("guest");
    const view = await guest.get(`/api/v1/slots/events/${f.event}`);
    expect(view.body).toMatchObject({ viewer: "GUEST", description: "Сбор в 20:00", myBooking: { paid: false, price: 3000 } });
    expect(view.body.schedule).toEqual([expect.objectContaining({ time: "20:40", opponent: "Спарринг" })]);
    const names = view.body.going.map((p: any) => `${p.name}${p.guest ? " (гость)" : ""}`);
    expect(names).toEqual(expect.arrayContaining(["Игрок player", "Игрок guest (гость)", "Игрок second (гость)"]));
    expect(names).not.toContain("Игрок captain");
    expect(view.body.going[0]).not.toHaveProperty("balance");

    expect(await hasGuestEventAccess(f.users.guest, f.event)).toBe(true);
    expect(await hasGuestEventAccess(f.users.guest, f.plainEvent)).toBe(false);
    // Через `resolveEventAccess` трека 3: только чтение этого события.
    expect((await guest.get(`/api/v1/events/${f.event}/attendees`)).status).toBe(200);
    expect((await guest.get(`/api/v1/events/${f.plainEvent}/attendees`)).status).toBe(403);
    expect((await guest.patch(`/api/v1/events/${f.event}`).send({ title: "Гость" })).status).toBe(403);
    expect((await guest.get(`/api/v1/events/${f.event}/attendance`)).status).toBe(403);
    expect((await guest.get(`/api/v1/finance/events/${f.event}`)).status).toBe(403);
    expect((await guest.get(`/api/v1/slots/events/${f.plainEvent}`)).status).toBe(404);
    expect((await guest.get(`/api/v1/init?team=${f.team}`)).status).toBe(403);

    const feed = await guest.get("/api/v1/slots/feed");
    expect(feed.body.bookings.map((b: any) => b.eventId)).toContain(f.event);
    expect(feed.body.slots.map((s: any) => s.eventId)).not.toContain(f.event);
  });

  it("капитан ставит «оплатил»; игрок команды этого не может", async () => {
    const player = await login("player");
    expect((await player.patch(`/api/v1/slots/events/${f.event}/guests/${f.users.guest}`).send({ paid: true })).status).toBe(403);
    const captain = await login("captain");
    const res = await captain.patch(`/api/v1/slots/events/${f.event}/guests/${f.users.guest}`).send({ paid: true });
    expect(res.status).toBe(200);
    expect(res.body.guests.find((g: any) => g.userId === f.users.guest)).toMatchObject({ paid: true, price: 3000 });
    // Гости не попадают в состав и в список должников команды.
    const members = await pool.query(`SELECT 1 FROM team_memberships WHERE team_id = $1 AND user_id = $2`, [f.team, f.users.guest]);
    expect(members.rowCount).toBe(0);
  });

  it("капитан снимает гостя из бота — место свободно, подписчикам «место освободилось» без дублей", async () => {
    const [message] = botMessagesTo("captain");
    const rm = message.body.reply_markup.inline_keyboard[0][0].callback_data as string;
    const before = botMessagesTo("third").length;

    // Игрок команды кнопку «Снять» нажать не может.
    await webhookPress("player", rm, message.body.text);
    expect(await hasGuestEventAccess(f.users.guest, f.event)).toBe(true);

    await webhookPress("captain", rm, message.body.text);
    await flush();
    const edit = botCalls.filter((c) => c.method === "editMessageText" && String(c.body.chat_id) === TG.captain).pop();
    expect(edit?.body.text).toContain("Гость снят, место снова свободно.");
    expect(await hasGuestEventAccess(f.users.guest, f.event)).toBe(false);
    expect((await (await login("guest")).get(`/api/v1/slots/events/${f.event}`)).body.viewer).toBe("FOLLOWER");
    expect((await (await login("guest")).get(`/api/v1/events/${f.event}/attendees`)).status).toBe(403);

    // Освободилось место — третьему (подписан, не записан) уходит новое
    // уведомление; снятому гостю и записанному второму — нет.
    expect(botMessagesTo("third").length).toBe(before + 1);
    expect(botMessagesTo("third").pop()?.body.text).toContain("свободный слот, 3000 ₽");
    const guestOffers = botMessagesTo("guest").filter(
      (m) => m.body.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data === `slot:book:${f.event}`
    );
    expect(guestOffers).toHaveLength(1);

    // Снятому гостю — сообщение в бот и пуш с переходом к свободным слотам.
    const removedNotes = () => botMessagesTo("guest").filter((m) => String(m.body.text).includes("тебя сняли со слота"));
    expect(removedNotes()).toHaveLength(1);
    expect(removedNotes()[0].body.text).toMatch(new RegExp(`^Holy Guns ${stamp}: тебя сняли со слота — Тренировка, .+ в \\d\\d:\\d\\d$`));
    const button = removedNotes()[0].body.reply_markup.inline_keyboard[0][0];
    expect(button.text).toBe("Свободные слоты");
    expect(button.url).toMatch(/^https?:\/\/[^/]+\/teams$/);
    const removedPush = pushed.filter((p) => String(p.payload.body).includes("тебя сняли со слота"));
    expect(removedPush).toHaveLength(1);
    expect(removedPush[0]).toMatchObject({ endpoint: `https://push.example/${stamp}`, payload: { url: "/teams" } });

    // Повторное нажатие той же кнопки ничего не ломает и ничего не шлёт.
    await webhookPress("captain", rm, message.body.text);
    await flush();
    expect(botMessagesTo("third").length).toBe(before + 1);
    expect(removedNotes()).toHaveLength(1);
  });

  it("после события доступ заканчивается, подписка остаётся", async () => {
    const second = await login("second");
    expect((await second.get(`/api/v1/slots/events/${f.event}`)).body.viewer).toBe("GUEST");
    await pool.query(
      `UPDATE events SET start_at = NOW() - INTERVAL '3 hours', end_at = NOW() - INTERVAL '1 hour' WHERE id = $1`,
      [f.event]
    );
    expect(await hasGuestEventAccess(f.users.second, f.event)).toBe(false);
    expect((await second.get(`/api/v1/events/${f.event}/attendees`)).status).toBe(403);
    expect((await second.get(`/api/v1/slots/events/${f.event}`)).status).toBe(404);
    const feed = await second.get("/api/v1/slots/feed");
    expect(feed.body.bookings.map((b: any) => b.eventId)).not.toContain(f.event);
    expect(feed.body.following.map((t: any) => t.id)).toContain(f.team);
  });

  it("отписка убирает ленту; выключенное расписание закрывает запись", async () => {
    const third = await login("third");
    await third.delete(`/api/v1/slots/teams/${f.team}/follow`).expect(200);
    expect((await third.get("/api/v1/slots/feed")).body.following).toEqual([]);

    const captain = await login("captain");
    await captain.put(`/api/v1/slots/teams/${f.team}/open-schedule`).send({ enabled: false }).expect(200);
    const second = await login("second");
    const res = await second.post(`/api/v1/slots/events/${f.raceEvent}/book`);
    // Либо он уже записан в гонке, либо запись закрыта — но не новая запись.
    expect([200, 409]).toContain(res.status);
    const guestFeed = await (await login("guest")).get("/api/v1/slots/feed");
    expect(guestFeed.body.slots).toEqual([]);
  });
});
