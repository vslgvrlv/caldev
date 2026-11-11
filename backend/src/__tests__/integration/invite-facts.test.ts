// Экраны приглашения (`/invite/:token`, `/join/:code`) открыты тому, у кого есть
// ссылка, а заявку на вступление видит человек, который ещё не в команде.
// Тест держит, что наружу уходит только это:
//   - открытые ручки: два новых поля — membersCount и nextEvent; имени того,
//     кто зовёт, нет (решение 11.11.2026: в `users.name` бывает ник, `tg-<id>`,
//     телефон — имя от ника не отличить);
//   - nextEvent везде (открытые ручки и заявка, пока ждёт решения) — только
//     `{ startsAt, type, timezone }` игрового события; сборы, ТО и «другое»
//     пропускаются, название и место не уходят;
//   - ни в одном ответе нет значений из users.name, users.username,
//     users.nickname людей команды.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
process.env.TELEGRAM_CALLBACK_URL =
  process.env.TELEGRAM_CALLBACK_URL || "http://127.0.0.1:8000/api/v1/auth/telegram/callback";
process.env.DEV_AUTH_ENABLED = "1";
process.env.DEV_AUTH_SECRET = "";

let app: typeof import("../../app.js").app;
let pool: typeof import("../../db/pool.js").pool;

const stamp = Date.now() % 1_000_000;
const TG = {
  captain: 960_000_000 + stamp,
  trainer: 961_000_000 + stamp,
  player: 962_000_000 + stamp,
  inactive: 963_000_000 + stamp,
  badCaptain: 940_000_000 + stamp,
  badTrainer: 941_000_000 + stamp,
  joiner: 942_000_000 + stamp,
  badJoiner: 943_000_000 + stamp,
};
const f = {
  team: "",
  emptyTeam: "",
  badTeam: "",
  users: {} as Record<string, string>,
  tokens: {} as Record<string, string>,
  code: `IF${stamp}`.slice(0, 8),
  emptyCode: `IE${stamp}`.slice(0, 8),
  badCode: `IB${stamp}`.slice(0, 8),
};

// Узнаваемые имя, логин и ник каждого человека команды: ни одно не должно
// встретиться в теле ответа. Ник из одних букв (`ivanpetrov`) — то, что
// лежит в `users.name` при пустом имени в Telegram.
const PEOPLE = {
  captain: { name: "Артём Громов", username: `gromovart_${stamp}`, nickname: "Громовник" },
  trainer: { name: "Тренер Тренеров", username: `trenerov_${stamp}`, nickname: "Тренерник" },
  player: { name: "Игрок Игроков", username: `igrokov_${stamp}`, nickname: "Игрокник" },
  inactive: { name: "Ушедший Ушедшев", username: `ushedshev_${stamp}`, nickname: "Ушедник" },
  badCaptain: { name: "ivanpetrov", username: `ivanpetrov_${stamp}`, nickname: "ivanpetrovnick" },
  badTrainer: { name: "+7 999 123-45-67", username: `phoneman_${stamp}`, nickname: "phonenick" },
} as const;
type Person = keyof typeof PEOPLE;
// Отдельные слова имени короче пяти знаков («999», «+7») не ищем: такие подстроки
// случайно встречаются в id и датах ответа, и тест мерцал. Полное имя, ник и username ищутся целиком.
const PERSON_STRINGS = Object.values(PEOPLE).flatMap((p) => [
  p.name,
  p.username,
  p.nickname,
  ...p.name.split(/\s+/).filter((word) => word.length >= 5),
]);

// Свободный текст событий: ни одно из этого не уходит наружу.
const EVENT_TEXT = ["Ближайшая тренировка", "Турнир позже", "Закрытое собрание", "Ремонт маркеров", "Личное", "Арена", "maps.example", "secret?x=1", "Гараж", "Дом капитана", "секретное описание"];

const INVITE_KEYS = ["expiresAt", "isExpired", "isRevoked", "isUsed", "isValid", "membersCount", "nextEvent", "note", "role", "singleUse", "teamId", "teamName"];
const LINK_KEYS = ["authenticated", "member", "membersCount", "nextEvent", "request", "team"];
const NEXT_EVENT_KEYS = ["startsAt", "timezone", "type"];
const REQUEST_KEYS = ["createdAt", "decidedAt", "id", "nextEvent", "status", "team"];

function expectNoLeaks(body: unknown) {
  const text = JSON.stringify(body);
  for (const leak of [...PERSON_STRINGS, ...EVENT_TEXT, "secret-avatar", "inviter"]) {
    expect(text, `в ответе «${leak}»`).not.toContain(leak);
  }
}

function expectPublicEvent(event: unknown, type = "TRAINING") {
  expect(event).not.toBeNull();
  expect(Object.keys(event as object).sort()).toEqual(NEXT_EVENT_KEYS);
  expect((event as { type: string }).type).toBe(type);
}

async function user(who: Person, active = true) {
  const p = PEOPLE[who];
  const r = await pool.query<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name, nickname, avatar, is_active)
     VALUES ($1, $2, $3, $4, 'secret-avatar.png', $5) RETURNING id`,
    [TG[who], p.username, p.name, p.nickname, active]
  );
  f.users[who] = r.rows[0].id;
  return r.rows[0].id;
}

async function invite(opts: { createdBy: string; role?: string; expiresInHours?: number; revoked?: boolean; used?: boolean; singleUse?: boolean; team?: string }) {
  const r = await pool.query<{ token: string }>(
    `INSERT INTO team_invites (team_id, role, created_by, expires_at, is_revoked, used_at, single_use)
     VALUES ($1, $2::membership_role, $3, NOW() + ($4 || ' hours')::interval, $5, $6, $7) RETURNING token::text`,
    [opts.team ?? f.team, opts.role ?? "PLAYER", opts.createdBy, String(opts.expiresInHours ?? 24), opts.revoked ?? false, opts.used ? new Date() : null, opts.singleUse ?? false]
  );
  return r.rows[0].token;
}

const agents = new Map<string, ReturnType<typeof request.agent>>();
async function login(tg: number) {
  const key = String(tg);
  const cached = agents.get(key);
  if (cached) return cached;
  const agent = request.agent(app);
  await agent.post("/api/v1/auth/dev/login").send({ telegramId: key, ensureTeam: false }).expect(200);
  agents.set(key, agent);
  return agent;
}

beforeAll(async () => {
  ({ app } = await import("../../app.js"));
  ({ pool } = await import("../../db/pool.js"));
  const team = await pool.query<{ id: string }>(`INSERT INTO teams (name, short_code, timezone) VALUES ($1, $2, 'Europe/Moscow') RETURNING id`, [`Facts ${stamp}`, f.code]);
  f.team = team.rows[0].id;
  const empty = await pool.query<{ id: string }>(`INSERT INTO teams (name, short_code) VALUES ($1, $2) RETURNING id`, [`Empty ${stamp}`, f.emptyCode]);
  f.emptyTeam = empty.rows[0].id;
  const bad = await pool.query<{ id: string }>(`INSERT INTO teams (name, short_code, timezone) VALUES ($1, $2, 'Asia/Vladivostok') RETURNING id`, [`Bad ${stamp}`, f.badCode]);
  f.badTeam = bad.rows[0].id;

  const membership = (uid: string, team: string, role: string) =>
    pool.query(`INSERT INTO team_memberships (user_id, team_id, role) VALUES ($1, $2, $3::membership_role)`, [uid, team, role]);
  await membership(await user("captain"), f.team, "CAPTAIN");
  await membership(await user("trainer"), f.team, "TRAINER");
  await membership(await user("player"), f.team, "PLAYER");
  await membership(await user("inactive", false), f.team, "PLAYER");
  await membership(await user("badCaptain"), f.badTeam, "CAPTAIN");
  await membership(await user("badTrainer"), f.badTeam, "TRAINER");

  // Прошедшее, отменённое, внутренние (сбор со ссылкой в месте, ТО, другое) и
  // два игровых будущих события: берётся ближайшее живое будущее игровое.
  const ev = (type: string, title: string, hours: number, cancelled = false, location: string | null = "Арена", team = f.team) =>
    pool.query(
      `INSERT INTO events (team_id, type, title, description, start_at, location, cost, is_cancelled)
       VALUES ($1, $2::event_type, $3, 'секретное описание', NOW() + ($4 || ' hours')::interval, $5, 5000, $6)`,
      [team, type, title, String(hours), location, cancelled]
    );
  await ev("TRAINING", "Было вчера", -24);
  await ev("TRAINING", "Отменённая", 2, true);
  await ev("MEETING", "Закрытое собрание", 3, false, "https://maps.example/secret?x=1");
  await ev("MAINTENANCE", "Ремонт маркеров", 4, false, "Гараж, кв. 5");
  await ev("OTHER", "Личное", 5, false, "Дом капитана");
  await ev("TRAINING", "Ближайшая тренировка", 20);
  await ev("TOURNAMENT", "Турнир позже", 200);
  // У «плохой» команды впереди только внутренние события.
  await ev("MEETING", "Закрытое собрание", 3, false, "https://maps.example/secret?x=1", f.badTeam);
  await ev("OTHER", "Личное", 30, false, "Дом капитана", f.badTeam);

  await pool.query(`INSERT INTO team_join_links (team_id, code, created_by) VALUES ($1, $2, $3)`, [f.team, f.code, f.users.captain]);
  await pool.query(`INSERT INTO team_join_links (team_id, code, created_by) VALUES ($1, $2, NULL)`, [f.emptyTeam, f.emptyCode]);
  await pool.query(`INSERT INTO team_join_links (team_id, code, created_by) VALUES ($1, $2, $3)`, [f.badTeam, f.badCode, f.users.badCaptain]);

  f.tokens.ok = await invite({ createdBy: f.users.trainer, role: "PLAYER" });
  f.tokens.expired = await invite({ createdBy: f.users.trainer, expiresInHours: -1 });
  f.tokens.revoked = await invite({ createdBy: f.users.trainer, revoked: true });
  f.tokens.used = await invite({ createdBy: f.users.trainer, used: true, singleUse: true });
  f.tokens.byNick = await invite({ createdBy: f.users.badCaptain, team: f.badTeam });
  f.tokens.byPhone = await invite({ createdBy: f.users.badTrainer, team: f.badTeam });

  // Заявка шлёт карточки в бота — сеть не трогаем.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) }) as any)
  );
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await pool.query(`DELETE FROM teams WHERE id = ANY($1::uuid[])`, [[f.team, f.emptyTeam, f.badTeam]]);
  await pool.query(`DELETE FROM users WHERE telegram_id = ANY($1::bigint[])`, [Object.values(TG)]);
});

describe("GET /teams/invites/:token", () => {
  it("действующее приглашение: сколько людей и ближайшее игровое событие, без имени", async () => {
    const res = await request(app).get(`/api/v1/teams/invites/${f.tokens.ok}`).expect(200);
    expect(Object.keys(res.body).sort()).toEqual(INVITE_KEYS);
    // капитан, тренер, игрок; ушедший (is_active = false) не считается
    expect(res.body.membersCount).toBe(3);
    // сбор через 3 ч, ТО через 4 ч, «другое» через 5 ч пропущены — тренировка через 20 ч
    expectPublicEvent(res.body.nextEvent);
    expect(res.body.nextEvent.timezone).toBe("Europe/Moscow");
    const hoursAhead = (new Date(res.body.nextEvent.startsAt).getTime() - Date.now()) / 3_600_000;
    expect(hoursAhead).toBeGreaterThan(19);
    expect(hoursAhead).toBeLessThan(21);
    expectNoLeaks(res.body);
    expect(res.body).not.toHaveProperty("inviter");
  });

  it("зовёт ник `ivanpetrov` или телефон: ни имени, ни ника, ни логина; впереди только сбор — nextEvent null", async () => {
    for (const token of [f.tokens.byNick, f.tokens.byPhone]) {
      const res = await request(app).get(`/api/v1/teams/invites/${token}`).expect(200);
      expect(Object.keys(res.body).sort()).toEqual(INVITE_KEYS);
      expect(res.body.nextEvent).toBeNull();
      expect(res.body.membersCount).toBe(2);
      expectNoLeaks(res.body);
    }
  });

  it("истёкшее, отозванное и использованное: прежние код и тело ошибки", async () => {
    for (const [key, status, code] of [["expired", 409, "INVITE_EXPIRED"], ["revoked", 409, "INVITE_REVOKED"], ["used", 409, "INVITE_USED"]] as const) {
      const res = await request(app).get(`/api/v1/teams/invites/${f.tokens[key]}`).expect(status);
      expect(res.body.code).toBe(code);
      expect(Object.keys(res.body).sort()).toEqual(["code", "correlationId", "detail"]);
    }
  });

  it("запросы за событиями — один, без N+1; users не читается", async () => {
    const spy = vi.spyOn(pool, "query");
    await request(app).get(`/api/v1/teams/invites/${f.tokens.ok}`).expect(200);
    const sqls = spy.mock.calls.map((c) => String(typeof c[0] === "string" ? c[0] : (c[0] as { text: string }).text));
    spy.mockRestore();
    expect(sqls.filter((s) => /FROM\s+events/i.test(s))).toHaveLength(1);
    expect(sqls.filter((s) => /team_invites/i.test(s))).toHaveLength(1);
    expect(sqls.some((s) => /u\.name|users\.name|\bname\s+FROM\s+users/i.test(s))).toBe(false);
    expect(sqls.length).toBeLessThanOrEqual(3);
  });
});

describe("GET /join-requests/link/:code без входа", () => {
  it("живая ссылка: число людей и ближайшее игровое событие, без имени капитана", async () => {
    const res = await request(app).get(`/api/v1/join-requests/link/${f.code}`).expect(200);
    expect(Object.keys(res.body).sort()).toEqual(LINK_KEYS);
    expect(res.body.authenticated).toBe(false);
    expect(res.body.request).toBeNull();
    expect(res.body.membersCount).toBe(3);
    expectPublicEvent(res.body.nextEvent);
    expect(Object.keys(res.body.team).sort()).toEqual(["id", "name", "shortCode"]);
    expectNoLeaks(res.body);
  });

  it("капитан с ником `ivanpetrov`, впереди только сбор: ник не уходит, nextEvent — null", async () => {
    const res = await request(app).get(`/api/v1/join-requests/link/${f.badCode}`).expect(200);
    expect(Object.keys(res.body).sort()).toEqual(LINK_KEYS);
    expect(res.body.nextEvent).toBeNull();
    expect(res.body.membersCount).toBe(2);
    expectNoLeaks(res.body);
  });

  it("команда без людей и событий: nextEvent — null, людей ноль", async () => {
    const res = await request(app).get(`/api/v1/join-requests/link/${f.emptyCode}`).expect(200);
    expect(Object.keys(res.body).sort()).toEqual(LINK_KEYS);
    expect(res.body.nextEvent).toBeNull();
    expect(res.body.membersCount).toBe(0);
  });

  it("запросы — один на факты, без N+1", async () => {
    const spy = vi.spyOn(pool, "query");
    await request(app).get(`/api/v1/join-requests/link/${f.code}`).expect(200);
    const sqls = spy.mock.calls.map((c) => String(typeof c[0] === "string" ? c[0] : (c[0] as { text: string }).text));
    spy.mockRestore();
    expect(sqls.filter((s) => /FROM\s+events/i.test(s))).toHaveLength(1);
    expect(sqls.length).toBeLessThanOrEqual(3);
  });
});

describe("заявка, пока ждёт решения: ближайшее событие без названия и места", () => {
  it("POST /join-requests, GET /join-requests/mine, GET /join-requests/:id, GET /join-requests/link/:code при входе", async () => {
    const joiner = await login(TG.joiner);

    const created = await joiner.post("/api/v1/join-requests").send({ code: f.code }).expect(201);
    expect(created.body.request.status).toBe("PENDING");
    // POST отдаёт ещё userId — это id самого подавшего, как было до PR.
    expect(Object.keys(created.body.request).sort()).toEqual([...REQUEST_KEYS, "userId"].sort());
    expectPublicEvent(created.body.request.nextEvent);
    expectNoLeaks(created.body);
    const requestId = created.body.request.id as string;

    const mine = await joiner.get("/api/v1/join-requests/mine").expect(200);
    const mineRequest = mine.body.requests.find((r: { id: string }) => r.id === requestId);
    expect(Object.keys(mineRequest).sort()).toEqual(REQUEST_KEYS);
    expectPublicEvent(mineRequest.nextEvent);
    expectNoLeaks(mine.body);

    const one = await joiner.get(`/api/v1/join-requests/${requestId}`).expect(200);
    expect(Object.keys(one.body.request).sort()).toEqual(REQUEST_KEYS);
    expectPublicEvent(one.body.request.nextEvent);
    expectNoLeaks(one.body);

    const link = await joiner.get(`/api/v1/join-requests/link/${f.code}`).expect(200);
    expect(Object.keys(link.body).sort()).toEqual(LINK_KEYS);
    expect(link.body.authenticated).toBe(true);
    expect(link.body.member).toBe(false);
    expectPublicEvent(link.body.nextEvent);
    expect(Object.keys(link.body.request).sort()).toEqual(REQUEST_KEYS);
    expectPublicEvent(link.body.request.nextEvent);
    expectNoLeaks(link.body);
  });

  it("у команды впереди только закрытое собрание со ссылкой: в заявке nextEvent — null", async () => {
    const joiner = await login(TG.badJoiner);
    const created = await joiner.post("/api/v1/join-requests").send({ code: f.badCode }).expect(201);
    expect(created.body.request.nextEvent).toBeNull();
    expectNoLeaks(created.body);
    const one = await joiner.get(`/api/v1/join-requests/${created.body.request.id}`).expect(200);
    expect(one.body.request.nextEvent).toBeNull();
    const mine = await joiner.get("/api/v1/join-requests/mine").expect(200);
    expectNoLeaks(mine.body);
    const link = await joiner.get(`/api/v1/join-requests/link/${f.badCode}`).expect(200);
    expect(link.body.request.nextEvent).toBeNull();
    expectNoLeaks(link.body);
  });

  it("принятый в команду: заявка без события, ссылка — member, как раньше", async () => {
    const joiner = await login(TG.joiner);
    const mine = await joiner.get("/api/v1/join-requests/mine").expect(200);
    const requestId = mine.body.requests[0].id as string;
    const captain = await login(TG.captain);
    await captain.post(`/api/v1/join-requests/${requestId}/approve`).send({}).expect(200);

    const decided = await joiner.get(`/api/v1/join-requests/${requestId}`).expect(200);
    expect(decided.body.request.status).toBe("APPROVED");
    expect(decided.body.request.nextEvent).toBeNull();
    const link = await joiner.get(`/api/v1/join-requests/link/${f.code}`).expect(200);
    expect(link.body.member).toBe(true);
    expect(link.body.request).toBeNull();
  });
});

describe("недействующие ссылки", () => {
  it("отозванная и выдуманная: 404 с прежним телом", async () => {
    await pool.query(`UPDATE team_join_links SET revoked_at = NOW() WHERE code = $1`, [f.emptyCode]);
    for (const code of [f.emptyCode, "ZZZZZZ"]) {
      const res = await request(app).get(`/api/v1/join-requests/link/${code}`).expect(404);
      expect(res.body.code).toBe("JOIN_LINK_NOT_FOUND");
      expect(res.body.detail).toBe("Join link not found or revoked");
      expect(Object.keys(res.body).sort()).toEqual(["code", "correlationId", "detail"]);
    }
  });
});
