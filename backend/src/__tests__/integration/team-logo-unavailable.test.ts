// Библиотека перекодирования (`sharp`) не загрузилась — например, её нативная
// сборка не поднялась в образе. Сервер должен стартовать и работать; отказ
// получает только загрузка логотипа: 503 `LOGO_UNAVAILABLE`.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("sharp", () => {
  throw new Error("Could not load the sharp module using the linuxmusl-x64 runtime");
});

const stamp = Date.now() % 1_000_000;
const TG = String(931_000_000 + stamp);

process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
process.env.TELEGRAM_CALLBACK_URL =
  process.env.TELEGRAM_CALLBACK_URL || "http://127.0.0.1:8000/api/v1/auth/telegram/callback";
process.env.DEV_AUTH_ENABLED = "1";
process.env.DEV_AUTH_SECRET = "";
process.env.RATE_TEAM_LOOK_MAX = "1000";

// Настоящий PNG 1×1 — проверку типа по содержимому он проходит.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

let app: typeof import("../../app.js").app;
let pool: typeof import("../../db/pool.js").pool;
let agent: ReturnType<typeof request.agent>;
const f = { team: "", user: "" };

beforeAll(async () => {
  // Сервер поднимается, хотя `sharp` недоступен.
  ({ app } = await import("../../app.js"));
  ({ pool } = await import("../../db/pool.js"));
  const t = await pool.query<{ id: string }>(`INSERT INTO teams (name, short_code) VALUES ($1, $2) RETURNING id`, [
    `Без sharp ${stamp}`,
    `Ns${stamp}`,
  ]);
  f.team = t.rows[0].id;
  const u = await pool.query<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name, nickname, account_role, onboarding_completed_at, role_selected_at)
     VALUES ($1::bigint, $2, 'No Sharp', 'ns', 'USER', NOW(), NOW()) RETURNING id`,
    [TG, `ns_${stamp}`]
  );
  f.user = u.rows[0].id;
  await pool.query(`INSERT INTO team_memberships (user_id, team_id, role) VALUES ($1, $2, 'CAPTAIN'::membership_role)`, [f.user, f.team]);
  agent = request.agent(app);
  await agent.post("/api/v1/auth/dev/login").send({ telegramId: TG, username: `ns_${stamp}`, ensureTeam: false }).expect(200);
});

afterAll(async () => {
  await pool.query(`DELETE FROM teams WHERE id = $1`, [f.team]);
  await pool.query(`DELETE FROM users WHERE id = $1`, [f.user]);
});

describe("sharp недоступен", () => {
  it("сервер отвечает: проверка здоровья и /init", async () => {
    expect((await request(app).get("/api/v1/health")).status).toBe(200);
    expect((await agent.get("/api/v1/init").set("X-PBTH-Team", f.team)).status).toBe(200);
  });

  it("загрузка логотипа — 503 LOGO_UNAVAILABLE, в базе пусто; повтор — тот же ответ", async () => {
    for (let i = 0; i < 2; i += 1) {
      const res = await agent.put(`/api/v1/teams/${f.team}/logo`).set("Content-Type", "image/png").send(PNG);
      expect(res.status).toBe(503);
      expect(res.body.code).toBe("LOGO_UNAVAILABLE");
    }
    const rows = await pool.query(`SELECT 1 FROM team_logos WHERE team_id = $1`, [f.team]);
    expect(rows.rowCount).toBe(0);
  });

  it("не картинка отклоняется как раньше — до обращения к sharp", async () => {
    const res = await agent.put(`/api/v1/teams/${f.team}/logo`).set("Content-Type", "image/png").send(Buffer.from("<svg></svg>"));
    expect(res.status).toBe(415);
  });

  it("остальные ручки /teams живы: список, смена оформления, удаление логотипа, ссылка команды, отдача", async () => {
    const list = await agent.get("/api/v1/teams");
    expect(list.status).toBe(200);
    expect(list.body.teams.some((t: any) => t.id === f.team)).toBe(true);
    const look = await agent.patch(`/api/v1/teams/${f.team}/look`).send({ shape: 4 });
    expect(look.status).toBe(200);
    expect(look.body.look.shape).toBe(4);
    expect((await agent.delete(`/api/v1/teams/${f.team}/logo`)).status).toBe(200);
    expect((await agent.get(`/api/v1/teams/${f.team}/join-link`)).status).toBe(200);
    expect((await request(app).get(`/api/v1/teams/logo/${"0".repeat(32)}.webp`)).status).toBe(404);
  });
});
