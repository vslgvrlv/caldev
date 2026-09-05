import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
process.env.TELEGRAM_CALLBACK_URL =
  process.env.TELEGRAM_CALLBACK_URL || "http://127.0.0.1:8000/api/v1/auth/telegram/callback";
process.env.DEV_AUTH_ENABLED = "1";
process.env.DEV_AUTH_SECRET = "";

let app: typeof import("../../app.js").app;
let pool: typeof import("../../db/pool.js").pool;

const fixture = {
  telegramId: String(980_000_000 + (Date.now() % 10_000_000)),
  userId: "",
  activeTeamId: "",
  eventTeamId: "",
  eventId: "",
};

beforeAll(async () => {
  ({ app } = await import("../../app.js"));
  ({ pool } = await import("../../db/pool.js"));

  const suffix = fixture.telegramId.slice(-8);
  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name, nickname, account_role)
     VALUES ($1::bigint, $2, 'Multi Team Schedule', 'mts', 'USER')
     RETURNING id`,
    [fixture.telegramId, `mts_${suffix}`]
  );
  fixture.userId = user.rows[0].id;

  const teams = await pool.query<{ id: string; name: string }>(
    `INSERT INTO teams (name, short_code)
     VALUES ($1, $2), ($3, $4)
     RETURNING id, name`,
    [`A Active ${suffix}`, `AA${suffix}`, `B Event ${suffix}`, `BB${suffix}`]
  );
  fixture.activeTeamId = teams.rows.find((row) => row.name.startsWith("A Active"))!.id;
  fixture.eventTeamId = teams.rows.find((row) => row.name.startsWith("B Event"))!.id;

  await pool.query(
    `INSERT INTO team_memberships (user_id, team_id, role)
     VALUES ($1, $2, 'PLAYER'), ($1, $3, 'PLAYER')`,
    [fixture.userId, fixture.activeTeamId, fixture.eventTeamId]
  );

  const event = await pool.query<{ id: string }>(
    `INSERT INTO events (team_id, type, title, start_at)
     VALUES ($1, 'TOURNAMENT', 'Multi-team schedule regression', NOW())
     RETURNING id`,
    [fixture.eventTeamId]
  );
  fixture.eventId = event.rows[0].id;

  await pool.query(
    `INSERT INTO rsvps (event_id, user_id, status) VALUES ($1, $2, 'CONFIRMED')`,
    [fixture.eventId, fixture.userId]
  );
  const registration = await pool.query<{ id: string }>(
    `INSERT INTO event_team_registrations (event_id, team_id, status)
     VALUES ($1, $2, 'CONFIRMED') RETURNING id`,
    [fixture.eventId, fixture.eventTeamId]
  );
  await pool.query(
    `INSERT INTO event_team_schedule_items
       (event_id, team_id, registration_id, time_label, opponent)
     VALUES ($1, $2, $3, '10:40', 'Зайцы')`,
    [fixture.eventId, fixture.eventTeamId, registration.rows[0].id]
  );
});

afterAll(async () => {
  if (fixture.userId) await pool.query(`DELETE FROM users WHERE id = $1`, [fixture.userId]);
  if (fixture.activeTeamId || fixture.eventTeamId) {
    await pool.query(`DELETE FROM teams WHERE id = ANY($1::uuid[])`, [
      [fixture.activeTeamId, fixture.eventTeamId].filter(Boolean),
    ]);
  }
});

describe("init multi-team schedule projection", () => {
  it("shows an event team's schedule while another membership is active", async () => {
    const agent = request.agent(app);
    const login = await agent
      .post("/api/v1/auth/dev/login")
      .set("x-dev-auth-secret", process.env.DEV_AUTH_SECRET || "")
      .send({ telegramId: fixture.telegramId, username: `mts_${fixture.telegramId.slice(-8)}`, ensureTeam: false });
    expect(login.status).toBe(200);

    const init = await agent.get("/api/v1/init");
    expect(init.status).toBe(200);
    expect(init.body.team.id).toBe(fixture.activeTeamId);

    const event = init.body.events.find((item: { id: string }) => item.id === fixture.eventId);
    expect(event).toBeTruthy();
    expect(event.teamId).toBe(fixture.eventTeamId);
    expect(event.registration?.teamId).toBe(fixture.eventTeamId);
    expect(event.schedule).toEqual([
      expect.objectContaining({ time: "10:40", opponent: "Зайцы" }),
    ]);
  });
});
