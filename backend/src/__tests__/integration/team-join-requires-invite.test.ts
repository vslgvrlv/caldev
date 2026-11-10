// В команду — только по действующему приглашению.
//
// До 10.11.2026 POST /teams/:teamId/join пускал любого вошедшего в любую
// команду по одному её ID, а экран /invite/<ID команды> предлагал «вступить
// напрямую». ID команды не секрет: он лежал в старых ссылках. Тест держит,
// что этот путь закрыт и членства не появляется.

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

const suffix = String(Date.now() % 10_000_000);
const STRANGER_TG_ID = String(970_000_000 + (Date.now() % 1_000_000));
const fixture = { teamId: "" };

beforeAll(async () => {
  ({ app } = await import("../../app.js"));
  ({ pool } = await import("../../db/pool.js"));
  const team = await pool.query<{ id: string }>(
    `INSERT INTO teams (name, short_code) VALUES ($1, $2) RETURNING id`,
    [`Closed Team ${suffix}`, `CT${suffix}`]
  );
  fixture.teamId = team.rows[0].id;
});

afterAll(async () => {
  await pool.query(`DELETE FROM teams WHERE id = $1`, [fixture.teamId]);
  await pool.query(`DELETE FROM users WHERE telegram_id = $1::bigint`, [STRANGER_TG_ID]);
});

describe("вступление в команду без приглашения", () => {
  it("POST /teams/:teamId/join отказывает и не создаёт членства", async () => {
    const stranger = request.agent(app);
    const login = await stranger
      .post("/api/v1/auth/dev/login")
      .set("x-dev-auth-secret", process.env.DEV_AUTH_SECRET || "")
      .send({ telegramId: STRANGER_TG_ID, username: `stranger_${suffix}`, ensureTeam: false });
    expect(login.status).toBe(200);

    const join = await stranger.post(`/api/v1/teams/${fixture.teamId}/join`).send({});
    expect(join.status).toBe(410);
    expect(join.body.code).toBe("INVITE_REQUIRED");

    const memberships = await pool.query(
      `SELECT 1 FROM team_memberships tm JOIN users u ON u.id = tm.user_id
       WHERE tm.team_id = $1 AND u.telegram_id = $2::bigint`,
      [fixture.teamId, STRANGER_TG_ID]
    );
    expect(memberships.rowCount).toBe(0);
  });

  it("ID команды вместо токена приглашения — «приглашение не найдено»", async () => {
    const stranger = request.agent(app);
    await stranger
      .post("/api/v1/auth/dev/login")
      .set("x-dev-auth-secret", process.env.DEV_AUTH_SECRET || "")
      .send({ telegramId: STRANGER_TG_ID, username: `stranger_${suffix}`, ensureTeam: false });

    const info = await stranger.get(`/api/v1/teams/invites/${fixture.teamId}`);
    expect(info.status).toBe(404);
    expect(info.body.code).toBe("INVITE_NOT_FOUND");

    const accept = await stranger.post(`/api/v1/teams/invites/${fixture.teamId}/accept`).send({});
    expect(accept.status).toBe(404);
    expect(accept.body.code).toBe("INVITE_NOT_FOUND");
  });
});
