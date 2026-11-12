// Гости события (занявшие свободный слот) видны всем участникам команды и самим
// гостям: только userId, имя и аватар. Оплата, «Снять» и ник остаются у капитана
// и тренера (решение владельца 12.11.2026).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

const stamp = Date.now() % 1_000_000;
const TG = {
  captain: String(971_000_000 + stamp),
  trainer: String(972_000_000 + stamp),
  player: String(973_000_000 + stamp),
  reserve: String(974_000_000 + stamp),
  guestA: String(975_000_000 + stamp),
  guestB: String(976_000_000 + stamp),
  left: String(977_000_000 + stamp),
  removed: String(978_000_000 + stamp),
  follower: String(979_000_000 + stamp),
  stranger: String(980_000_000 + stamp),
};
type Who = keyof typeof TG;

process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
process.env.TELEGRAM_CALLBACK_URL =
  process.env.TELEGRAM_CALLBACK_URL || "http://127.0.0.1:8000/api/v1/auth/telegram/callback";
process.env.DEV_AUTH_ENABLED = "1";
process.env.DEV_AUTH_SECRET = "";

let app: typeof import("../../app.js").app;
let pool: typeof import("../../db/pool.js").pool;
let guestDisplayName: typeof import("../../modules/slots/service.js").guestDisplayName;

const f = { team: "", event: "", users: {} as Record<Who, string> };
const agents = new Map<Who, ReturnType<typeof request.agent>>();
async function login(who: Who) {
  const cached = agents.get(who);
  if (cached) return cached;
  const agent = request.agent(app);
  agents.set(who, agent);
  await agent
    .post("/api/v1/auth/dev/login")
    .send({ telegramId: TG[who], username: `sg_${who}_${stamp}`, ensureTeam: false })
    .expect(200);
  return agent;
}

beforeAll(async () => {
  ({ app } = await import("../../app.js"));
  ({ pool } = await import("../../db/pool.js"));
  ({ guestDisplayName } = await import("../../modules/slots/service.js"));

  const team = await pool.query<{ id: string }>(
    `INSERT INTO teams (name, short_code, budget, timezone) VALUES ($1, $2, 0, 'Europe/Moscow') RETURNING id`,
    [`Команда гостей ${stamp}`, `SgA${stamp}`]
  );
  f.team = team.rows[0].id;
  for (const who of Object.keys(TG) as Who[]) {
    // У гостя B в имени запасное `tg-<id>`: наружу оно не уходит.
    const name = who === "guestB" ? `tg-${TG[who]}` : `Человек ${who}`;
    const u = await pool.query<{ id: string }>(
      `INSERT INTO users (telegram_id, username, name, nickname, account_role, onboarding_completed_at, role_selected_at)
       VALUES ($1::bigint, $2, $3, $4, 'USER', NOW(), NOW()) RETURNING id`,
      [TG[who], `sg_${who}_${stamp}`, name, `nick_${who}`]
    );
    f.users[who] = u.rows[0].id;
  }
  await pool.query(
    `INSERT INTO team_memberships (user_id, team_id, role, status) VALUES
       ($1, $5, 'CAPTAIN', 'ACTIVE'), ($2, $5, 'TRAINER', 'ACTIVE'), ($3, $5, 'PLAYER', 'ACTIVE'), ($4, $5, 'PLAYER', 'RESERVE')`,
    [f.users.captain, f.users.trainer, f.users.player, f.users.reserve, f.team]
  );
  const ev = await pool.query<{ id: string }>(
    `INSERT INTO events (team_id, type, title, start_at, end_at)
     VALUES ($1, 'TRAINING', 'Тренировка', NOW() + INTERVAL '2 days', NOW() + INTERVAL '2 days 2 hours') RETURNING id`,
    [f.team]
  );
  f.event = ev.rows[0].id;
  await pool.query(`INSERT INTO team_open_schedules (team_id, enabled) VALUES ($1, TRUE)`, [f.team]);
  await pool.query(`INSERT INTO event_slots (event_id, team_id, capacity, price) VALUES ($1, $2, 6, 3000)`, [f.event, f.team]);
  await pool.query(`INSERT INTO team_followers (team_id, user_id) VALUES ($1, $2)`, [f.team, f.users.follower]);
  const guest = (who: Who, status: string, paid: boolean, offset: number) =>
    pool.query(
      `INSERT INTO event_slot_guests (event_id, user_id, status, price, paid, booked_at)
       VALUES ($1, $2, $3, 3000, $4, NOW() + ($5 || ' seconds')::interval)`,
      [f.event, f.users[who], status, paid, String(offset)]
    );
  await guest("guestA", "BOOKED", true, 1);
  await guest("guestB", "BOOKED", false, 2);
  await guest("left", "LEFT", false, 3);
  await guest("removed", "REMOVED", false, 4);
});

afterAll(async () => {
  await pool.query(`DELETE FROM teams WHERE id = $1`, [f.team]);
  await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.values(f.users)]);
});

const view = async (who: Who) => (await login(who)).get(`/api/v1/slots/events/${f.event}`);

describe("гости события на экране события", () => {
  it("участник команды видит гостей: только userId, имя и аватар, по порядку записи", async () => {
    const res = await view("player");
    expect(res.status).toBe(200);
    expect(res.body.viewer).toBe("MEMBER");
    expect(res.body.guests).toEqual([
      { userId: f.users.guestA, name: "Человек guestA", avatar: null },
      { userId: f.users.guestB, name: "Гость", avatar: null },
    ]);
    for (const g of res.body.guests) {
      expect(Object.keys(g).sort()).toEqual(["avatar", "name", "userId"]);
    }
    const text = JSON.stringify(res.body);
    for (const secret of [TG.guestA, `sg_guestA_${stamp}`, `tg-${TG.guestB}`, "paid", "bookedAt", "price\":3000,\"paid"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("запасной видит так же", async () => {
    const res = await view("reserve");
    expect(res.body.viewer).toBe("MEMBER");
    expect(res.body.guests.map((g: any) => g.userId)).toEqual([f.users.guestA, f.users.guestB]);
  });

  it("сам гость события видит гостей без полей оплаты", async () => {
    const res = await view("guestA");
    expect(res.body.viewer).toBe("GUEST");
    expect(res.body.guests).toEqual([
      { userId: f.users.guestA, name: "Человек guestA", avatar: null },
      { userId: f.users.guestB, name: "Гость", avatar: null },
    ]);
  });

  it("подписчик без брони и посторонний гостей не видят", async () => {
    const follower = await view("follower");
    expect(follower.status).toBe(200);
    expect(follower.body.viewer).toBe("FOLLOWER");
    expect(follower.body).not.toHaveProperty("guests");
    expect((await view("stranger")).status).toBe(404);
    // Снявшийся сам и снятый капитаном доступа к гостям не имеют.
    expect((await view("left")).status).toBe(404);
    expect((await view("removed")).status).toBe(404);
  });

  it("LEFT и REMOVED в список не попадают", async () => {
    const ids = (await view("player")).body.guests.map((g: any) => g.userId);
    expect(ids).not.toContain(f.users.left);
    expect(ids).not.toContain(f.users.removed);
  });

  it("капитан и тренер: manage по-прежнему с оплатой; ответ события гостей не дублирует", async () => {
    const manage = await (await login("captain")).get(`/api/v1/slots/events/${f.event}/manage`);
    expect(manage.status).toBe(200);
    expect(manage.body.guests.find((g: any) => g.userId === f.users.guestA)).toMatchObject({
      paid: true,
      price: 3000,
    });
    expect(manage.body.guests[0]).toHaveProperty("nickname");
    expect((await view("captain")).body.viewer).toBe("MANAGER");
    expect((await view("captain")).body).not.toHaveProperty("guests");
  });

  it("права ручек не изменились: manage, DELETE и PATCH только у капитана и тренера", async () => {
    for (const who of ["player", "reserve", "guestA", "follower", "stranger"] as Who[]) {
      const agent = await login(who);
      expect((await agent.get(`/api/v1/slots/events/${f.event}/manage`)).status).toBe(403);
      expect((await agent.delete(`/api/v1/slots/events/${f.event}/guests/${f.users.guestA}`)).status).toBe(403);
      expect((await agent.patch(`/api/v1/slots/events/${f.event}/guests/${f.users.guestA}`).send({ paid: true })).status).toBe(403);
    }
    const trainer = await login("trainer");
    expect((await trainer.get(`/api/v1/slots/events/${f.event}/manage`)).status).toBe(200);
    const patch = await trainer.patch(`/api/v1/slots/events/${f.event}/guests/${f.users.guestB}`).send({ paid: true });
    expect(patch.status).toBe(200);
  });
});

describe("имя гостя для показа", () => {
  it("запасные tg-<id>, телефон и почта заменяются", () => {
    expect(guestDisplayName("tg-123456")).toBe("Гость");
    expect(guestDisplayName("+7 (900) 123-45-67")).toBe("Гость");
    expect(guestDisplayName("a@b.ru")).toBe("Гость");
    expect(guestDisplayName("  ")).toBe("Гость");
    expect(guestDisplayName("Иван Петров")).toBe("Иван Петров");
  });
});
