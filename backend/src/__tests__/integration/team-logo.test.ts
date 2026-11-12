// Свой логотип команды (решение Василия 12.11.2026, хранение в базе).
// Капитан загружает PNG, JPEG или WebP до 2 МБ; сервер проверяет содержимое,
// перекодирует в 256×256 WebP и отдаёт под случайным именем. Тренер, игрок и
// чужой капитан загрузить и убрать логотип не могут.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

const stamp = Date.now() % 1_000_000;
const TG = {
  captain: String(951_000_000 + stamp),
  trainer: String(952_000_000 + stamp),
  player: String(953_000_000 + stamp),
  stranger: String(954_000_000 + stamp), // капитан другой команды
};
type Who = keyof typeof TG;

process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
process.env.TELEGRAM_CALLBACK_URL =
  process.env.TELEGRAM_CALLBACK_URL || "http://127.0.0.1:8000/api/v1/auth/telegram/callback";
process.env.DEV_AUTH_ENABLED = "1";
process.env.DEV_AUTH_SECRET = "";
process.env.RATE_TEAM_LOOK_MAX = "1000";

let app: typeof import("../../app.js").app;
let pool: typeof import("../../db/pool.js").pool;

const f = { team: "", otherTeam: "", users: {} as Record<Who, string> };
const img = { png: Buffer.alloc(0), jpeg: Buffer.alloc(0), webp: Buffer.alloc(0) };

const agents = new Map<Who, ReturnType<typeof request.agent>>();
async function login(who: Who) {
  const cached = agents.get(who);
  if (cached) return cached;
  const agent = request.agent(app);
  agents.set(who, agent);
  await agent
    .post("/api/v1/auth/dev/login")
    .send({ telegramId: TG[who], username: `lg_${who}_${stamp}`, ensureTeam: false })
    .expect(200);
  return agent;
}

const logoUrl = (teamId: string) => `/api/v1/teams/${teamId}/logo`;
const upload = async (who: Who, teamId: string, body: Buffer, type = "image/png") =>
  (await login(who)).put(logoUrl(teamId)).set("Content-Type", type).send(body);
const binary = (res: request.Test) =>
  res.buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = [];
    r.on("data", (c: Buffer) => chunks.push(c));
    r.on("end", () => cb(null, Buffer.concat(chunks)));
  });
const storedRows = async (teamId: string) =>
  (await pool.query<{ name: string; bytes: number }>(`SELECT name, octet_length(data) AS bytes FROM team_logos WHERE team_id = $1`, [teamId])).rows;

beforeAll(async () => {
  ({ app } = await import("../../app.js"));
  ({ pool } = await import("../../db/pool.js"));

  const solid = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 30, g: 120, b: 220 } } });
  img.png = await solid(500, 300).png().toBuffer();
  img.jpeg = await solid(300, 300).withExif({ IFD0: { Copyright: "secret-owner" } }).jpeg().toBuffer();
  img.webp = await solid(120, 120).webp().toBuffer();

  for (const key of ["team", "otherTeam"] as const) {
    const t = await pool.query<{ id: string }>(
      `INSERT INTO teams (name, short_code) VALUES ($1, $2) RETURNING id`,
      [`Лого ${key} ${stamp}`, `Lg${key === "team" ? "A" : "B"}${stamp}`]
    );
    f[key] = t.rows[0].id;
  }
  for (const who of Object.keys(TG) as Who[]) {
    const u = await pool.query<{ id: string }>(
      `INSERT INTO users (telegram_id, username, name, nickname, account_role, onboarding_completed_at, role_selected_at)
       VALUES ($1::bigint, $2, $3, $4, 'USER', NOW(), NOW()) RETURNING id`,
      [TG[who], `lg_${who}_${stamp}`, `Logo ${who}`, `lg_${who}`]
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
    await pool.query(`INSERT INTO team_memberships (user_id, team_id, role) VALUES ($1, $2, $3::membership_role)`, [
      f.users[who],
      team,
      role,
    ]);
  }
});

afterAll(async () => {
  await pool.query(`DELETE FROM teams WHERE id = ANY($1::uuid[])`, [[f.team, f.otherTeam]]);
  await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.values(f.users)]);
});

describe("права на логотип", () => {
  it("без входа — 401; игрок, тренер и чужой капитан — 403; в базе пусто", async () => {
    expect((await request(app).put(logoUrl(f.team)).set("Content-Type", "image/png").send(img.png)).status).toBe(401);
    expect((await request(app).delete(logoUrl(f.team))).status).toBe(401);
    for (const who of ["player", "trainer", "stranger"] as Who[]) {
      expect((await upload(who, f.team, img.png)).status, who).toBe(403);
      expect((await (await login(who)).delete(logoUrl(f.team))).status, who).toBe(403);
    }
    expect(await storedRows(f.team)).toEqual([]);
  });

  it("нет такой команды — 404, кривой id — 400", async () => {
    expect((await upload("captain", "00000000-0000-4000-8000-000000000000", img.png)).status).toBe(404);
    expect((await upload("captain", "not-a-uuid", img.png)).status).toBe(400);
  });
});

describe("что принимает загрузка", () => {
  it("SVG, GIF и HTML под видом картинки — 415, заголовок запроса не помогает", async () => {
    const fakes = [
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'),
      Buffer.from("GIF89a\x01\x00\x01\x00\x80\x00\x00", "latin1"),
      Buffer.from("<!doctype html><script>alert(1)</script>"),
    ];
    for (const body of fakes) {
      for (const type of ["image/png", "image/svg+xml", "application/octet-stream"]) {
        const res = await upload("captain", f.team, body, type);
        expect(res.status).toBe(415);
        expect(res.body.code).toBe("LOGO_TYPE");
      }
    }
  });

  it("тело JSON и пустое тело — отказ", async () => {
    const captain = await login("captain");
    const json = await captain.put(logoUrl(f.team)).send({ logo: "https://example.com/x.png" });
    expect(json.status).toBe(415);
    const empty = await captain.put(logoUrl(f.team)).set("Content-Type", "image/png").send(Buffer.alloc(0));
    expect([400, 415]).toContain(empty.status);
  });

  it("заголовок PNG с мусором и обрезанный файл — 400", async () => {
    const fake = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("x".repeat(500))]);
    const res = await upload("captain", f.team, fake);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("LOGO_BAD_IMAGE");
    expect((await upload("captain", f.team, img.png.subarray(0, 60))).status).toBe(400);
  });

  it("файл больше 2 МБ — 413", async () => {
    const big = Buffer.concat([img.png, Buffer.alloc(2 * 1024 * 1024)]);
    const res = await upload("captain", f.team, big);
    expect(res.status).toBe(413);
    expect(res.body.code).toBe("LOGO_TOO_LARGE");
  });

  it("маленький файл с огромным числом пикселей — 400", async () => {
    const bomb = await sharp({ create: { width: 6000, height: 6000, channels: 3, background: { r: 0, g: 0, b: 0 } } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const res = await upload("captain", f.team, bomb);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("LOGO_BAD_IMAGE");
  }, 30_000);

  it("после всех отказов в базе по-прежнему пусто", async () => {
    expect(await storedRows(f.team)).toEqual([]);
  });
});

describe("загрузка, отдача и удаление", () => {
  let firstUrl = "";

  it("капитан загружает PNG: в ответе адрес логотипа, в базе — 256×256 WebP", async () => {
    const res = await upload("captain", f.team, img.png);
    expect(res.status).toBe(200);
    expect(res.body.look.logo).toMatch(/^\/api\/v1\/teams\/logo\/[0-9a-f]{32}\.webp$/);
    firstUrl = res.body.look.logo;
    const rows = await storedRows(f.team);
    expect(rows).toHaveLength(1);
    expect(firstUrl).toContain(rows[0].name);
    const stored = await pool.query<{ data: Buffer }>(`SELECT data FROM team_logos WHERE team_id = $1`, [f.team]);
    const meta = await sharp(stored.rows[0].data).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", 256, 256]);
  });

  it("логотип отдаётся без входа: image/webp, nosniff, долгий кэш", async () => {
    const res = await binary(request(app).get(firstUrl));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/webp");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(res.headers).not.toHaveProperty("pragma");
    expect(res.headers.etag).toBe(`"${firstUrl.slice(-37, -5)}"`);
    const again = await request(app).get(firstUrl).set("If-None-Match", res.headers.etag);
    expect(again.status).toBe(304);
    expect(again.text ?? "").toBe("");
    expect((await request(app).get(firstUrl).set("If-None-Match", '"other"')).status).toBe(200);
    const meta = await sharp(res.body as Buffer).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", 256, 256]);
  });

  it("оформление с логотипом приходит в /init игроку и по ссылке команды", async () => {
    const player = await login("player");
    const init = await player.get("/api/v1/init").set("X-PBTH-Team", f.team);
    expect(init.body.team.look).toEqual({ paint: null, shape: null, letters: null, logo: firstUrl });
    expect(init.body.teams.find((t: any) => t.teamId === f.team).look.logo).toBe(firstUrl);
    const captain = await login("captain");
    const link = await captain.get(`/api/v1/teams/${f.team}/join-link`);
    const preview = await request(app).get(`/api/v1/join-requests/link/${link.body.code}`);
    expect(preview.body.team.look.logo).toBe(firstUrl);
  });

  it("JPEG с EXIF: метаданные сняты; новая загрузка меняет имя, старое больше не отдаётся", async () => {
    const res = await upload("captain", f.team, img.jpeg, "image/jpeg");
    expect(res.status).toBe(200);
    expect(res.body.look.logo).not.toBe(firstUrl);
    expect((await request(app).get(firstUrl)).status).toBe(404);
    const got = await binary(request(app).get(res.body.look.logo));
    const meta = await sharp(got.body as Buffer).metadata();
    expect(meta.exif).toBeUndefined();
    expect((got.body as Buffer).includes(Buffer.from("secret-owner"))).toBe(false);
    expect(await storedRows(f.team)).toHaveLength(1);
  });

  it("WebP принимается; тип берётся из содержимого, а не из заголовка", async () => {
    const res = await upload("captain", f.team, img.webp, "text/plain");
    expect(res.status).toBe(200);
  });

  it("смена краски не трогает логотип", async () => {
    const captain = await login("captain");
    const res = await captain.patch(`/api/v1/teams/${f.team}/look`).send({ paint: "#4F7CFF" });
    expect(res.status).toBe(200);
    expect(res.body.look.paint).toBe("#4F7CFF");
    expect(res.body.look.logo).toMatch(/\.webp$/);
    await captain.patch(`/api/v1/teams/${f.team}/look`).send({ paint: null }).expect(200);
  });

  it("чужие и выдуманные имена файлов: обход пути, чужое расширение, длина — 404", async () => {
    const name = (await storedRows(f.team))[0].name;
    const bad = [
      `/api/v1/teams/logo/${name}`,
      `/api/v1/teams/logo/${name}.png`,
      `/api/v1/teams/logo/${name}.webp.svg`,
      `/api/v1/teams/logo/${name.toUpperCase()}.webp`,
      `/api/v1/teams/logo/${"0".repeat(32)}.webp`,
      `/api/v1/teams/logo/..%2F..%2F..%2Fetc%2Fpasswd`,
      `/api/v1/teams/logo/%2e%2e%2f${name}.webp`,
      `/api/v1/teams/logo/${f.team}.webp`,
      `/api/v1/teams/logo/${name}.webp%00.html`,
    ];
    for (const url of bad) {
      const res = await request(app).get(url);
      expect(res.status, url).toBe(404);
      expect(res.headers["content-type"], url).not.toBe("image/webp");
    }
  });

  it("чужой капитан видит логотип, но не может его заменить или убрать", async () => {
    const before = await storedRows(f.team);
    expect((await upload("stranger", f.team, img.png)).status).toBe(403);
    expect((await (await login("stranger")).delete(logoUrl(f.team))).status).toBe(403);
    expect(await storedRows(f.team)).toEqual(before);
    // Свой логотип чужой капитан кладёт только в свою команду.
    const own = await upload("stranger", f.otherTeam, img.png);
    expect(own.status).toBe(200);
    expect((await storedRows(f.team))[0].name).toBe(before[0].name);
  });

  it("капитан убирает логотип: знак возвращается к фигуре, файл больше не отдаётся", async () => {
    const captain = await login("captain");
    const url = (await captain.get("/api/v1/init").set("X-PBTH-Team", f.team)).body.team.look.logo as string;
    const res = await captain.delete(logoUrl(f.team));
    expect(res.status).toBe(200);
    expect(res.body.look).toBeNull();
    expect(await storedRows(f.team)).toEqual([]);
    expect((await request(app).get(url)).status).toBe(404);
    // Повторное удаление — тот же ответ.
    expect((await captain.delete(logoUrl(f.team))).status).toBe(200);
    const audit = await pool.query(
      `SELECT action FROM audit_logs WHERE action LIKE 'teams.logo.%' AND payload->>'teamId' = $1 ORDER BY created_at`,
      [f.team]
    );
    expect(audit.rows.map((r) => r.action)).toEqual(["teams.logo.upload", "teams.logo.upload", "teams.logo.upload", "teams.logo.remove"]);
  });

  it("удаление команды уносит её логотип", async () => {
    const t = await pool.query<{ id: string }>(`INSERT INTO teams (name, short_code) VALUES ($1, $2) RETURNING id`, [
      `Лого temp ${stamp}`,
      `LgT${stamp}`,
    ]);
    await pool.query(`INSERT INTO team_logos (team_id, name, data) VALUES ($1, $2, $3)`, [t.rows[0].id, "a".repeat(32), img.webp]);
    await pool.query(`DELETE FROM teams WHERE id = $1`, [t.rows[0].id]);
    expect(await storedRows(t.rows[0].id)).toEqual([]);
  });
});

describe("миграция 066", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = path.resolve(here, "../../db/migrations/066_team_logos.sql");

  it("база не пускает кривое имя и пустую или слишком большую картинку", async () => {
    await expect(pool.query(`INSERT INTO team_logos (team_id, name, data) VALUES ($1, '../x', $2)`, [f.team, img.webp])).rejects.toThrow();
    await expect(pool.query(`INSERT INTO team_logos (team_id, name, data) VALUES ($1, $2, ''::bytea)`, [f.team, "b".repeat(32)])).rejects.toThrow();
    await expect(
      pool.query(`INSERT INTO team_logos (team_id, name, data) VALUES ($1, $2, $3)`, [f.team, "c".repeat(32), Buffer.alloc(262145)])
    ).rejects.toThrow();
  });

  it("откат из шапки убирает таблицу, повтор миграции возвращает; команды целы", async () => {
    const sql = await fs.readFile(file, "utf8");
    const rollback = sql
      .split("\n")
      .filter((line) => /^--\s{3}/.test(line))
      .map((line) => line.replace(/^--\s{3}/, "").trim())
      .find((line) => line.startsWith("DROP TABLE"));
    expect(rollback).toBe("DROP TABLE IF EXISTS team_logos;");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const teams = await client.query(`SELECT COUNT(*)::int AS n FROM teams`);
      await client.query(rollback!);
      expect((await client.query(`SELECT to_regclass('team_logos') AS t`)).rows[0].t).toBeNull();
      expect((await client.query(`SELECT COUNT(*)::int AS n FROM teams`)).rows).toEqual(teams.rows);
      await client.query(sql);
      await client.query(sql);
      expect((await client.query(`SELECT to_regclass('team_logos') AS t`)).rows[0].t).toBe("team_logos");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
