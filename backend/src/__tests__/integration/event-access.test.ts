// Трек 3 ревизии 11.11.2026: доступ к событию (`lib/event-access.ts`).
//
// Ручки по событию раньше смотрели только членство. Теперь: участник — как
// раньше; владелец платформы — права капитана (решение 11), в составе не
// числится, рассылки его не находят, журнал помечен; посторонний — отказ;
// поставщик доступа (трек 4, гость) — только чтение.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

const stamp = Date.now() % 1_000_000;
const TG = {
  captain: String(966_000_000 + stamp),
  player: String(967_000_000 + stamp),
  stranger: String(968_000_000 + stamp),
  owner: String(969_000_000 + stamp),
};

process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
process.env.TELEGRAM_CALLBACK_URL =
  process.env.TELEGRAM_CALLBACK_URL || "http://127.0.0.1:8000/api/v1/auth/telegram/callback";
process.env.DEV_AUTH_ENABLED = "1";
process.env.DEV_AUTH_SECRET = "";
process.env.ADMIN_ROLE_ALLOWLIST_IDS = TG.owner;

let app: typeof import("../../app.js").app;
let pool: typeof import("../../db/pool.js").pool;
let eventAccess: typeof import("../../lib/event-access.js");

const f = {
  team: "",
  users: {} as Record<keyof typeof TG, string>,
  event: "",
  spareEvent: "",
  otherEvent: "",
  game: "",
};

const agents = new Map<string, ReturnType<typeof request.agent>>();
async function login(who: keyof typeof TG) {
  const cached = agents.get(who);
  if (cached) return cached;
  const agent = request.agent(app);
  agents.set(who, agent);
  await agent
    .post("/api/v1/auth/dev/login")
    .send({ telegramId: TG[who], username: `ea_${who}_${stamp}`, ensureTeam: false })
    .expect(200);
  return agent;
}

beforeAll(async () => {
  ({ app } = await import("../../app.js"));
  ({ pool } = await import("../../db/pool.js"));
  eventAccess = await import("../../lib/event-access.js");
  const team = await pool.query<{ id: string }>(
    `INSERT INTO teams (name, short_code) VALUES ($1, $2) RETURNING id`,
    [`Event Access ${stamp}`, `EvA${stamp}`]
  );
  f.team = team.rows[0].id;
  for (const who of Object.keys(TG) as Array<keyof typeof TG>) {
    const u = await pool.query<{ id: string }>(
      `INSERT INTO users (telegram_id, username, name, nickname, account_role, onboarding_completed_at, role_selected_at)
       VALUES ($1::bigint, $2, $3, $4, 'USER', NOW(), NOW()) RETURNING id`,
      [TG[who], `ea_${who}_${stamp}`, `Access ${who}`, `ea_${who}`]
    );
    f.users[who] = u.rows[0].id;
  }
  await pool.query(
    `INSERT INTO team_memberships (user_id, team_id, role) VALUES ($1, $3, 'CAPTAIN'), ($2, $3, 'PLAYER')`,
    [f.users.captain, f.users.player, f.team]
  );
  const event = await pool.query<{ id: string }>(
    `INSERT INTO events (team_id, type, title, start_at) VALUES ($1, 'TOURNAMENT', $2, NOW() + INTERVAL '3 days') RETURNING id`,
    [f.team, `Турнир ${stamp}`]
  );
  f.event = event.rows[0].id;
  const spare = await pool.query<{ id: string }>(
    `INSERT INTO events (team_id, type, title, start_at) VALUES ($1, 'TRAINING', $2, NOW() + INTERVAL '4 days') RETURNING id`,
    [f.team, `Тренировка ${stamp}`]
  );
  f.spareEvent = spare.rows[0].id;
  const other = await pool.query<{ id: string }>(
    `INSERT INTO events (team_id, type, title, start_at) VALUES ($1, 'MEETING', $2, NOW() + INTERVAL '5 days') RETURNING id`,
    [f.team, `Собрание ${stamp}`]
  );
  f.otherEvent = other.rows[0].id;
  const game = await pool.query<{ id: string }>(
    `INSERT INTO event_games (event_id, time_label, opponent, score) VALUES ($1, '10:00', 'Соперник', '1:0') RETURNING id`,
    [f.event]
  );
  f.game = game.rows[0].id;
});

afterAll(async () => {
  await pool.query(`DELETE FROM teams WHERE id = $1`, [f.team]);
  await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.values(f.users)]);
});

async function lastAudit(userId: string, action: string) {
  const result = await pool.query<{ payload: any }>(
    `SELECT payload FROM audit_logs WHERE user_id = $1 AND action = $2 ORDER BY created_at DESC LIMIT 1`,
    [userId, action]
  );
  return result.rows[0]?.payload ?? null;
}

describe("участники — как раньше", () => {
  it("капитан правит событие, игрок — нет", async () => {
    const captain = await login("captain");
    const ok = await captain.patch(`/api/v1/events/${f.event}`).send({ title: `Турнир ${stamp} (капитан)` });
    expect(ok.status).toBe(200);
    expect(await lastAudit(f.users.captain, "events.update.single")).not.toHaveProperty("actorVia");

    const player = await login("player");
    const denied = await player.patch(`/api/v1/events/${f.event}`).send({ title: "Игрок" });
    expect(denied.status).toBe(403);
    expect((await player.get(`/api/v1/events/${f.event}/attendees`)).status).toBe(200);
    expect((await player.get(`/api/v1/finance/events/${f.event}`)).status).toBe(403);
  });
});

describe("владелец платформы в чужой команде — права капитана", () => {
  it("правит событие и ведёт явку, журнал помечен", async () => {
    const owner = await login("owner");
    const patched = await owner.patch(`/api/v1/events/${f.event}`).send({ title: `Турнир ${stamp} (владелец)` });
    expect(patched.status).toBe(200);
    expect(await lastAudit(f.users.owner, "events.update.single")).toMatchObject({
      actorVia: "owner",
      ownerTeamIds: [f.team],
    });

    const attendees = await owner.get(`/api/v1/events/${f.event}/attendees`);
    expect(attendees.status).toBe(200);
    expect(attendees.body.attendees.map((a: any) => a.userId).sort()).toEqual(
      [f.users.captain, f.users.player].sort()
    );

    const marked = await owner
      .post(`/api/v1/events/${f.event}/attendance`)
      .send({ entries: [{ userId: f.users.player, present: true }] });
    expect(marked.status).toBe(200);
    expect((await owner.get(`/api/v1/events/${f.event}/attendance`)).status).toBe(200);
  });

  it("деньги события: видит и начисляет", async () => {
    const owner = await login("owner");
    const finance = await owner.get(`/api/v1/finance/events/${f.event}`);
    expect(finance.status).toBe(200);
    expect(finance.body.participants.some((p: any) => p.userId === f.users.owner)).toBe(false);

    const charges = await owner
      .post(`/api/v1/finance/events/${f.event}/charges/generate`)
      .send({ mode: "CONFIRMED_AND_PENDING", amountType: "CUSTOM", custom: [{ userId: f.users.player, amount: 500 }] });
    expect(charges.status).toBe(201);
  });

  it("рефлексии: разбор и разметка пойнтов как у капитана, своей формы нет", async () => {
    const owner = await login("owner");
    const points = await owner.get(`/api/v1/reflections/games/${f.game}/points`);
    expect(points.status).toBe(200);
    expect(points.body.canMarkResults).toBe(true);

    const table = await owner.get(`/api/v1/reflections/events/${f.event}/table`);
    expect(table.status).toBe(200);
    expect(table.body.scope).toBe("TEAM");

    const pointId = points.body.points[0].id;
    const captainReport = await owner.put(`/api/v1/reflections/points/${pointId}/captain`).send({ note: "Разбор" });
    expect(captainReport.status).toBe(200);

    const mine = await owner
      .put(`/api/v1/reflections/points/${pointId}/mine`)
      .send({ exitReason: "SURVIVED", kills: [] });
    expect(mine.status).toBe(403);
  });

  it("удаляет событие", async () => {
    const owner = await login("owner");
    const deleted = await owner.delete(`/api/v1/events/${f.spareEvent}`).send({});
    expect(deleted.status).toBe(200);
  });

  it("в составе не числится, ответов и начислений на него нет — рассылки его не находят", async () => {
    const memberships = await pool.query(`SELECT 1 FROM team_memberships WHERE user_id = $1`, [f.users.owner]);
    expect(memberships.rowCount).toBe(0);
    const rsvps = await pool.query(`SELECT 1 FROM rsvps WHERE user_id = $1`, [f.users.owner]);
    expect(rsvps.rowCount).toBe(0);
    const charges = await pool.query(`SELECT 1 FROM event_member_charges WHERE user_id = $1`, [f.users.owner]);
    expect(charges.rowCount).toBe(0);
  });
});

describe("посторонний — отказ", () => {
  it("ни чтения, ни правки, ни денег, ни разбора", async () => {
    const stranger = await login("stranger");
    expect((await stranger.patch(`/api/v1/events/${f.event}`).send({ title: "Чужой" })).status).toBe(403);
    expect((await stranger.get(`/api/v1/events/${f.event}/attendees`)).status).toBe(403);
    expect((await stranger.get(`/api/v1/events/${f.event}/attendance`)).status).toBe(403);
    expect((await stranger.get(`/api/v1/finance/events/${f.event}`)).status).toBe(403);
    expect((await stranger.get(`/api/v1/reflections/events/${f.event}/table`)).status).toBe(404);
    expect((await stranger.get(`/api/v1/reflections/games/${f.game}/points`)).status).toBe(404);
  });
});

describe("поставщик доступа (гость события, трек 4)", () => {
  it("даёт только чтение события", async () => {
    const unregister = eventAccess.registerEventAccessProvider({
      name: `test-guest-${stamp}`,
      resolve: async ({ userId, eventId }) =>
        userId === f.users.stranger && eventId === f.event ? { via: "guest", readOnly: true } : null,
    });
    try {
      const stranger = await login("stranger");
      expect((await stranger.get(`/api/v1/events/${f.event}/attendees`)).status).toBe(200);
      expect((await stranger.patch(`/api/v1/events/${f.event}`).send({ title: "Гость" })).status).toBe(403);
      expect((await stranger.get(`/api/v1/events/${f.event}/attendance`)).status).toBe(403);
      expect((await stranger.get(`/api/v1/finance/events/${f.event}`)).status).toBe(403);
      expect((await stranger.get(`/api/v1/reflections/events/${f.event}/table`)).status).toBe(404);
      // Другое событие той же команды гостю закрыто.
      expect((await stranger.get(`/api/v1/events/${f.otherEvent}/attendees`)).status).toBe(403);
    } finally {
      unregister();
    }
    expect(eventAccess.listEventAccessProviders()).not.toContain(`test-guest-${stamp}`);
  });

  it("участник остаётся участником, даже если поставщик тоже его признал", async () => {
    const unregister = eventAccess.registerEventAccessProvider({
      name: `test-all-${stamp}`,
      resolve: async () => ({ via: "guest", readOnly: true }),
    });
    try {
      const captain = await login("captain");
      const ok = await captain.patch(`/api/v1/events/${f.event}`).send({ title: `Турнир ${stamp}` });
      expect(ok.status).toBe(200);
    } finally {
      unregister();
    }
  });
});
