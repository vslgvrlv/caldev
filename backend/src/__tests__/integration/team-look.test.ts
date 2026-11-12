// Оформление команды (решение Василия 12.11.2026): капитан меняет краску,
// фигуру и буквы знака; тренер и игрок только видят; чужая команда закрыта.
// Команда без выбора отдаёт `look: null` — клиент считает знак по id, как раньше.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

const stamp = Date.now() % 1_000_000;
const TG = {
  captain: String(961_000_000 + stamp),
  trainer: String(962_000_000 + stamp),
  player: String(963_000_000 + stamp),
  stranger: String(964_000_000 + stamp), // капитан другой команды
  owner: String(965_000_000 + stamp),
};
type Who = keyof typeof TG;

process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
process.env.TELEGRAM_CALLBACK_URL =
  process.env.TELEGRAM_CALLBACK_URL || "http://127.0.0.1:8000/api/v1/auth/telegram/callback";
process.env.DEV_AUTH_ENABLED = "1";
process.env.DEV_AUTH_SECRET = "";
process.env.ADMIN_ROLE_ALLOWLIST_IDS = TG.owner;
// Тесты меняют оформление чаще, чем разрешает предел частоты; сам предел — в team-logo-rate-limit.test.ts.
process.env.RATE_TEAM_LOOK_MAX = "1000";

let app: typeof import("../../app.js").app;
let pool: typeof import("../../db/pool.js").pool;

const f = { team: "", otherTeam: "", event: "", invite: "", joinCode: "", users: {} as Record<Who, string> };

const agents = new Map<Who, ReturnType<typeof request.agent>>();
async function login(who: Who) {
  const cached = agents.get(who);
  if (cached) return cached;
  const agent = request.agent(app);
  agents.set(who, agent);
  await agent
    .post("/api/v1/auth/dev/login")
    .send({ telegramId: TG[who], username: `tl_${who}_${stamp}`, ensureTeam: false })
    .expect(200);
  return agent;
}

const lookUrl = (teamId: string) => `/api/v1/teams/${teamId}/look`;

beforeAll(async () => {
  ({ app } = await import("../../app.js"));
  ({ pool } = await import("../../db/pool.js"));

  const a = await pool.query<{ id: string }>(
    `INSERT INTO teams (name, short_code) VALUES ($1, $2) RETURNING id`,
    [`Гроза ${stamp}`, `TlA${stamp}`]
  );
  const b = await pool.query<{ id: string }>(
    `INSERT INTO teams (name, short_code) VALUES ($1, $2) RETURNING id`,
    [`Дозор ${stamp}`, `TlB${stamp}`]
  );
  f.team = a.rows[0].id;
  f.otherTeam = b.rows[0].id;

  for (const who of Object.keys(TG) as Who[]) {
    const u = await pool.query<{ id: string }>(
      `INSERT INTO users (telegram_id, username, name, nickname, account_role, onboarding_completed_at, role_selected_at)
       VALUES ($1::bigint, $2, $3, $4, 'USER', NOW(), NOW()) RETURNING id`,
      [TG[who], `tl_${who}_${stamp}`, `Look ${who}`, `tl_${who}`]
    );
    f.users[who] = u.rows[0].id;
  }
  const roles: Array<[Who, string, string]> = [
    ["captain", f.team, "CAPTAIN"],
    ["trainer", f.team, "TRAINER"],
    ["player", f.team, "PLAYER"],
    ["stranger", f.otherTeam, "CAPTAIN"],
  ];
  for (const [who, team, role] of roles) {
    await pool.query(
      `INSERT INTO team_memberships (user_id, team_id, role) VALUES ($1, $2, $3::membership_role)`,
      [f.users[who], team, role]
    );
  }
  const event = await pool.query<{ id: string }>(
    `INSERT INTO events (team_id, type, title, start_at) VALUES ($1, 'TRAINING', 'Тренировка', NOW() + INTERVAL '2 days') RETURNING id`,
    [f.team]
  );
  f.event = event.rows[0].id;
});

afterAll(async () => {
  await pool.query(`DELETE FROM teams WHERE id = ANY($1::uuid[])`, [[f.team, f.otherTeam]]);
  await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.values(f.users)]);
});

describe("права на оформление", () => {
  it("без входа — 401", async () => {
    const res = await request(app).patch(lookUrl(f.team)).send({ shape: 1 });
    expect(res.status).toBe(401);
  });

  it("игрок и тренер получают отказ, в базе ничего не меняется", async () => {
    for (const who of ["player", "trainer"] as Who[]) {
      const agent = await login(who);
      const res = await agent.patch(lookUrl(f.team)).send({ paint: "#4FC3F7", shape: 2, letters: "ZZ" });
      expect(res.status).toBe(403);
    }
    const row = await pool.query(`SELECT mark_paint, mark_shape, mark_letters FROM teams WHERE id = $1`, [f.team]);
    expect(row.rows[0]).toEqual({ mark_paint: null, mark_shape: null, mark_letters: null });
  });

  it("капитан чужой команды — отказ", async () => {
    const stranger = await login("stranger");
    const res = await stranger.patch(lookUrl(f.team)).send({ shape: 3 });
    expect(res.status).toBe(403);
  });

  it("нет такой команды — 404, кривой id — 400", async () => {
    const captain = await login("captain");
    const missing = await captain.patch(lookUrl("00000000-0000-4000-8000-000000000000")).send({ shape: 3 });
    expect(missing.status).toBe(404);
    const bad = await captain.patch(lookUrl("not-a-uuid")).send({ shape: 3 });
    expect(bad.status).toBe(400);
  });

  it("владелец платформы меняет оформление как капитан", async () => {
    const owner = await login("owner");
    const res = await owner.patch(lookUrl(f.otherTeam)).send({ shape: 5 });
    expect(res.status).toBe(200);
    expect(res.body.look).toEqual({ paint: null, shape: 5, letters: null, logo: null });
  });
});

describe("значения", () => {
  it("краска вне палитры, фигура вне ряда, длинные буквы, пустое тело, лишнее поле — 400", async () => {
    const captain = await login("captain");
    const bad: unknown[] = [
      { paint: "#000000" },
      { paint: "javascript:alert(1)" },
      { shape: 9 },
      { shape: -1 },
      { shape: "1" },
      { letters: "ABC" },
      { letters: "<b" },
      {},
      { shape: 1, logo: "https://example.com/logo.svg" },
    ];
    for (const body of bad) {
      const res = await captain.patch(lookUrl(f.team)).send(body as object);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    const row = await pool.query(`SELECT mark_paint, mark_shape, mark_letters FROM teams WHERE id = $1`, [f.team]);
    expect(row.rows[0]).toEqual({ mark_paint: null, mark_shape: null, mark_letters: null });
  });

  it("капитан сохраняет краску, фигуру и буквы; поля меняются по одному; null сбрасывает", async () => {
    const captain = await login("captain");
    const first = await captain.patch(lookUrl(f.team)).send({ paint: "#4fc3f7", shape: 2, letters: "гз" });
    expect(first.status).toBe(200);
    expect(first.body.look).toEqual({ paint: "#4FC3F7", shape: 2, letters: "ГЗ", logo: null });

    const second = await captain.patch(lookUrl(f.team)).send({ shape: 7 });
    expect(second.body.look).toEqual({ paint: "#4FC3F7", shape: 7, letters: "ГЗ", logo: null });

    const third = await captain.patch(lookUrl(f.team)).send({ letters: "" });
    expect(third.body.look).toEqual({ paint: "#4FC3F7", shape: 7, letters: null, logo: null });

    const audit = await pool.query(
      `SELECT payload FROM audit_logs WHERE action = 'teams.look.update' AND payload->>'teamId' = $1`,
      [f.team]
    );
    expect(audit.rowCount).toBe(3);
  });
});

describe("оформление в выдаче", () => {
  it("/init: команда, список команд и события несут оформление; игрок его видит", async () => {
    const player = await login("player");
    const res = await player.get("/api/v1/init").set("X-PBTH-Team", f.team);
    expect(res.status).toBe(200);
    const look = { paint: "#4FC3F7", shape: 7, letters: null, logo: null };
    expect(res.body.team.look).toEqual(look);
    expect(res.body.teams.find((t: any) => t.teamId === f.team).look).toEqual(look);
    // Событие без ответа приходит в «нужен ответ», с ответом — в общую ленту.
    const feed = [...res.body.events, ...res.body.actionRequiredEvents];
    expect(feed.find((e: any) => e.id === f.event).teamLook).toEqual(look);
  });

  it("/init без явной команды (старый клиент) — то же", async () => {
    const trainer = await login("trainer");
    const res = await trainer.get("/api/v1/init");
    expect(res.status).toBe(200);
    expect(res.body.teams[0].look).toEqual({ paint: "#4FC3F7", shape: 7, letters: null, logo: null });
  });

  it("команда без выбора отдаёт look: null", async () => {
    await pool.query(`UPDATE teams SET mark_paint = NULL, mark_shape = NULL, mark_letters = NULL WHERE id = $1`, [f.otherTeam]);
    const stranger = await login("stranger");
    const res = await stranger.get("/api/v1/init").set("X-PBTH-Team", f.otherTeam);
    expect(res.body.team.look).toBeNull();
    expect(res.body.teams[0].look).toBeNull();
  });

  it("список команд капитана", async () => {
    const captain = await login("captain");
    const res = await captain.get("/api/v1/teams");
    expect(res.body.teams.find((t: any) => t.id === f.team).look).toEqual({ paint: "#4FC3F7", shape: 7, letters: null, logo: null });
  });

  it("приглашение по ссылке: только знак, без входа", async () => {
    const captain = await login("captain");
    const created = await captain.post(`/api/v1/teams/${f.team}/invites`).send({ teamRole: "PLAYER" });
    expect(created.status).toBe(201);
    const res = await request(app).get(`/api/v1/teams/invites/${created.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.teamLook).toEqual({ paint: "#4FC3F7", shape: 7, letters: null, logo: null });
  });

  it("заявка по ссылке команды: знак виден до входа и в заявке", async () => {
    const captain = await login("captain");
    const link = await captain.get(`/api/v1/teams/${f.team}/join-link`);
    expect(link.status).toBe(200);
    const preview = await request(app).get(`/api/v1/join-requests/link/${link.body.code}`);
    expect(preview.status).toBe(200);
    expect(preview.body.team.look).toEqual({ paint: "#4FC3F7", shape: 7, letters: null, logo: null });
    expect(Object.keys(preview.body.team).sort()).toEqual(["id", "look", "name", "shortCode"]);

    const stranger = await login("stranger");
    const sent = await stranger.post("/api/v1/join-requests").send({ code: link.body.code });
    expect(sent.body.request.team.look).toEqual({ paint: "#4FC3F7", shape: 7, letters: null, logo: null });
  });

  it("открытые команды (слоты): карточка несёт оформление", async () => {
    await pool.query(
      `INSERT INTO team_open_schedules (team_id, enabled) VALUES ($1, TRUE)
       ON CONFLICT (team_id) DO UPDATE SET enabled = TRUE`,
      [f.team]
    );
    const stranger = await login("stranger");
    const res = await stranger.get(`/api/v1/slots/teams/${f.team}`);
    expect(res.status).toBe(200);
    expect(res.body.team.look).toEqual({ paint: "#4FC3F7", shape: 7, letters: null, logo: null });
  });
});

describe("миграция 065", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = path.resolve(here, "../../db/migrations/065_team_look.sql");

  it("база не пускает кривые значения мимо кода", async () => {
    await expect(pool.query(`UPDATE teams SET mark_paint = 'red' WHERE id = $1`, [f.team])).rejects.toThrow(/teams_mark_paint_hex/);
    await expect(pool.query(`UPDATE teams SET mark_shape = 9 WHERE id = $1`, [f.team])).rejects.toThrow(/teams_mark_shape_range/);
    await expect(pool.query(`UPDATE teams SET mark_letters = 'ABC' WHERE id = $1`, [f.team])).rejects.toThrow(/teams_mark_letters_len/);
  });

  it("откат из шапки миграции убирает столбцы, повтор миграции возвращает их; остальное в командах цело", async () => {
    const sql = await fs.readFile(file, "utf8");
    const rollback = sql
      .split("\n")
      .filter((line) => /^--\s{3}/.test(line))
      .map((line) => line.replace(/^--\s{3}/, ""))
      .join("\n")
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("ALTER TABLE teams"));
    expect(rollback).toContain("DROP COLUMN IF EXISTS mark_paint");

    const client = await pool.connect();
    try {
      // В одной транзакции и с откатом: соседние тесты и данные не задеты.
      await client.query("BEGIN");
      const before = await client.query(`SELECT name, short_code FROM teams WHERE id = $1`, [f.team]);
      await client.query(rollback!);
      const columns = async () =>
        (
          await client.query<{ column_name: string }>(
            `SELECT column_name FROM information_schema.columns WHERE table_name = 'teams' AND column_name LIKE 'mark\\_%'`
          )
        ).rows.map((r) => r.column_name).sort();
      expect(await columns()).toEqual([]);
      expect((await client.query(`SELECT name, short_code FROM teams WHERE id = $1`, [f.team])).rows).toEqual(before.rows);

      await client.query(sql);
      expect(await columns()).toEqual(["mark_letters", "mark_paint", "mark_shape"]);
      // Повторный прогон миграции не падает.
      await client.query(sql);
      const row = await client.query(`SELECT mark_paint, mark_shape, mark_letters FROM teams WHERE id = $1`, [f.team]);
      expect(row.rows[0]).toEqual({ mark_paint: null, mark_shape: null, mark_letters: null });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
