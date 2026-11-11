// Экраны приглашения (`/invite/:token`, `/join/:code`) открыты тому, у кого есть
// ссылка. Ручки отдают три дополнительных поля: inviter, membersCount,
// nextEvent. Тест держит: поля приходят для живой ссылки, не приходят для
// недействующей, и больше про людей команды наружу не уходит ничего:
//   inviter   — только первое имя и только если это имя (не `tg-…`, `@ник`,
//               телефон, почта);
//   nextEvent — только `{ startsAt, type, timezone }` игрового события;
//               сборы, ТО и «другое» пропускаются, название и место не уходят.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
process.env.TELEGRAM_CALLBACK_URL =
  process.env.TELEGRAM_CALLBACK_URL || "http://127.0.0.1:8000/api/v1/auth/telegram/callback";

let app: typeof import("../../app.js").app;
let pool: typeof import("../../db/pool.js").pool;

const stamp = Date.now() % 1_000_000;
const f = {
  team: "",
  emptyTeam: "",
  badTeam: "",
  badUsers: [] as string[],
  badCode: `IB${stamp}`.slice(0, 8),
  captain: "",
  trainer: "",
  inactive: "",
  tokens: {} as Record<string, string>,
  code: `IF${stamp}`.slice(0, 8),
  emptyCode: `IE${stamp}`.slice(0, 8),
};

async function user(tg: number, name: string, active = true) {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name, nickname, avatar, is_active)
     VALUES ($1, $2, $3, $4, 'secret-avatar.png', $5) RETURNING id`,
    [tg, `u${tg}`, name, `nick${tg}`, active]
  );
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

beforeAll(async () => {
  ({ app } = await import("../../app.js"));
  ({ pool } = await import("../../db/pool.js"));
  const team = await pool.query<{ id: string }>(`INSERT INTO teams (name, short_code, timezone) VALUES ($1, $2, 'Europe/Moscow') RETURNING id`, [`Facts ${stamp}`, `IF${stamp}`.slice(0, 8)]);
  f.team = team.rows[0].id;
  const empty = await pool.query<{ id: string }>(`INSERT INTO teams (name, short_code) VALUES ($1, $2) RETURNING id`, [`Empty ${stamp}`, `IE${stamp}`.slice(0, 8)]);
  f.emptyTeam = empty.rows[0].id;

  f.captain = await user(960_000_000 + stamp, "Денис Голев");
  f.trainer = await user(961_000_000 + stamp, "Тренер Тренеров");
  const player = await user(962_000_000 + stamp, "Игрок Игроков");
  f.inactive = await user(963_000_000 + stamp, "Ушедший", false);
  for (const [uid, role] of [[f.captain, "CAPTAIN"], [f.trainer, "TRAINER"], [player, "PLAYER"], [f.inactive, "PLAYER"]]) {
    await pool.query(`INSERT INTO team_memberships (user_id, team_id, role) VALUES ($1, $2, $3::membership_role)`, [uid, f.team, role]);
  }

  // Прошедшее, отменённое, внутренние (сбор, ТО, другое) и два игровых будущих
  // события: берётся ближайшее живое будущее игровое.
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

  // Команда, где имена — фолбэки регистрации и контакты, а впереди только
  // внутренние события.
  const bad = await pool.query<{ id: string }>(`INSERT INTO teams (name, short_code, timezone) VALUES ($1, $2, 'Asia/Vladivostok') RETURNING id`, [`Bad ${stamp}`, f.badCode]);
  f.badTeam = bad.rows[0].id;
  const badNames = ["tg-970000001", "@nick_cap", "+7 999 123-45-67", "ivan@mail.ru", "Денис🔥", "Константинопольский-Длинный Иван"];
  for (const [i, name] of badNames.entries()) {
    const id = await user(940_000_000 + i * 1_000_000 + stamp, name);
    f.badUsers.push(id);
    await pool.query(`INSERT INTO team_memberships (user_id, team_id, role) VALUES ($1, $2, $3::membership_role)`, [id, f.badTeam, i === 0 ? "CAPTAIN" : "TRAINER"]);
    f.tokens[`bad${i}`] = await invite({ createdBy: id, team: f.badTeam });
  }
  await ev("MEETING", "Закрытое собрание", 3, false, "https://maps.example/secret?x=1", f.badTeam);
  await ev("OTHER", "Личное", 30, false, "Дом капитана", f.badTeam);
  await pool.query(`INSERT INTO team_join_links (team_id, code, created_by) VALUES ($1, $2, $3)`, [f.badTeam, f.badCode, f.badUsers[0]]);

  await pool.query(`INSERT INTO team_join_links (team_id, code, created_by) VALUES ($1, $2, $3)`, [f.team, f.code, f.captain]);
  await pool.query(`INSERT INTO team_join_links (team_id, code, created_by) VALUES ($1, $2, NULL)`, [f.emptyTeam, f.emptyCode]);

  f.tokens.ok = await invite({ createdBy: f.trainer, role: "PLAYER" });
  f.tokens.expired = await invite({ createdBy: f.trainer, expiresInHours: -1 });
  f.tokens.revoked = await invite({ createdBy: f.trainer, revoked: true });
  f.tokens.used = await invite({ createdBy: f.trainer, used: true, singleUse: true });
});

afterAll(async () => {
  await pool.query(`DELETE FROM teams WHERE id = ANY($1::uuid[])`, [[f.team, f.emptyTeam, f.badTeam]]);
  await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[f.captain, f.trainer, f.inactive, ...f.badUsers]]);
  await pool.query(`DELETE FROM users WHERE telegram_id IN ($1, $2)`, [962_000_000 + stamp, 963_000_000 + stamp]);
});

const INVITE_KEYS = ["expiresAt", "inviter", "isExpired", "isRevoked", "isUsed", "isValid", "membersCount", "nextEvent", "note", "role", "singleUse", "teamId", "teamName"];
const NEXT_EVENT_KEYS = ["startsAt", "timezone", "type"];
// Свободный текст событий и фамилии: ни одно из этого не уходит наружу.
const EVENT_TEXT = ["Ближайшая тренировка", "Турнир позже", "Закрытое собрание", "Ремонт маркеров", "Личное", "Арена", "maps.example", "Гараж", "Дом капитана", "секретное описание"];

describe("GET /teams/invites/:token", () => {
  it("действующее приглашение: кто зовёт, сколько людей, ближайшее событие", async () => {
    const res = await request(app).get(`/api/v1/teams/invites/${f.tokens.ok}`).expect(200);
    // только имя, без фамилии
    expect(res.body.inviter).toEqual({ name: "Тренер" });
    // капитан, тренер, игрок; ушедший (is_active = false) не считается
    expect(res.body.membersCount).toBe(3);
    // сбор через 3 ч, ТО через 4 ч, «другое» через 5 ч пропущены — тренировка через 20 ч
    expect(res.body.nextEvent.type).toBe("TRAINING");
    expect(res.body.nextEvent.timezone).toBe("Europe/Moscow");
    const hoursAhead = (new Date(res.body.nextEvent.startsAt).getTime() - Date.now()) / 3_600_000;
    expect(hoursAhead).toBeGreaterThan(19);
    expect(hoursAhead).toBeLessThan(21);
  });

  it("имя-фолбэк и контакты вместо имени: inviter — null", async () => {
    for (const i of [0, 1, 2, 3, 4, 5]) {
      const res = await request(app).get(`/api/v1/teams/invites/${f.tokens[`bad${i}`]}`).expect(200);
      expect(res.body.inviter).toBeNull();
      const text = JSON.stringify(res.body);
      for (const leak of ["tg-", "970000001", "@nick", "nick_cap", "+7", "123-45-67", "mail.ru", "ivan", "🔥", "Константинопольский"]) {
        expect(text).not.toContain(leak);
      }
    }
  });

  it("впереди только сбор и «другое»: nextEvent — null, текст событий не уходит", async () => {
    const res = await request(app).get(`/api/v1/teams/invites/${f.tokens.bad0}`).expect(200);
    expect(res.body.nextEvent).toBeNull();
    const text = JSON.stringify(res.body);
    for (const leak of EVENT_TEXT) expect(text).not.toContain(leak);
  });

  it("наружу — только разрешённые ключи, без людей, денег и заметок", async () => {
    const res = await request(app).get(`/api/v1/teams/invites/${f.tokens.ok}`).expect(200);
    expect(Object.keys(res.body).sort()).toEqual(INVITE_KEYS);
    expect(Object.keys(res.body.inviter)).toEqual(["name"]);
    expect(Object.keys(res.body.nextEvent).sort()).toEqual(NEXT_EVENT_KEYS);
    const text = JSON.stringify(res.body);
    for (const leak of ["nick", "secret-avatar", "5000", String(f.captain), String(f.trainer), "telegram", "Тренеров", "Голев", ...EVENT_TEXT]) {
      expect(text).not.toContain(leak);
    }
  });

  it("истёкшее, отозванное и использованное: ошибка и без новых полей", async () => {
    for (const [key, status, code] of [["expired", 409, "INVITE_EXPIRED"], ["revoked", 409, "INVITE_REVOKED"], ["used", 409, "INVITE_USED"]] as const) {
      const res = await request(app).get(`/api/v1/teams/invites/${f.tokens[key]}`).expect(status);
      expect(res.body.code).toBe(code);
      // тело ошибки прежнее: код, текст, correlationId — и ничего больше
      expect(Object.keys(res.body).sort()).toEqual(["code", "correlationId", "detail"]);
    }
  });

  it("запросы за событиями и людьми — один, без N+1", async () => {
    const spy = vi.spyOn(pool, "query");
    await request(app).get(`/api/v1/teams/invites/${f.tokens.ok}`).expect(200);
    const sqls = spy.mock.calls.map((c) => String(typeof c[0] === "string" ? c[0] : (c[0] as { text: string }).text));
    spy.mockRestore();
    expect(sqls.filter((s) => /FROM\s+events/i.test(s))).toHaveLength(1);
    expect(sqls.filter((s) => /team_invites/i.test(s))).toHaveLength(1);
    expect(sqls.length).toBeLessThanOrEqual(3);
  });
});

describe("GET /join-requests/link/:code", () => {
  it("живая ссылка без входа: капитан, число людей, ближайшее событие", async () => {
    const res = await request(app).get(`/api/v1/join-requests/link/${f.code}`).expect(200);
    expect(res.body.authenticated).toBe(false);
    expect(res.body.request).toBeNull();
    expect(res.body.inviter).toEqual({ name: "Денис" });
    expect(res.body.membersCount).toBe(3);
    expect(res.body.nextEvent.type).toBe("TRAINING");
    expect(Object.keys(res.body).sort()).toEqual(["authenticated", "inviter", "member", "membersCount", "nextEvent", "request", "team"]);
    expect(Object.keys(res.body.inviter)).toEqual(["name"]);
    expect(Object.keys(res.body.nextEvent).sort()).toEqual(NEXT_EVENT_KEYS);
    expect(Object.keys(res.body.team).sort()).toEqual(["id", "name", "shortCode"]);
    const text = JSON.stringify(res.body);
    for (const leak of ["nick", "secret-avatar", "5000", "Голев", "Тренер", "Игрок", ...EVENT_TEXT]) {
      expect(text).not.toContain(leak);
    }
  });

  it("капитан с именем «tg-…»: inviter — null; впереди только сбор — nextEvent null", async () => {
    const res = await request(app).get(`/api/v1/join-requests/link/${f.badCode}`).expect(200);
    expect(res.body.inviter).toBeNull();
    expect(res.body.nextEvent).toBeNull();
    expect(res.body.membersCount).toBe(6);
    const text = JSON.stringify(res.body);
    for (const leak of ["tg-", "970000001", "@nick", "+7", "mail.ru", ...EVENT_TEXT]) expect(text).not.toContain(leak);
  });

  it("команда без капитана и событий: inviter и nextEvent — null, людей ноль", async () => {
    const res = await request(app).get(`/api/v1/join-requests/link/${f.emptyCode}`).expect(200);
    expect(res.body.inviter).toBeNull();
    expect(res.body.nextEvent).toBeNull();
    expect(res.body.membersCount).toBe(0);
  });

  it("отозванная и выдуманная ссылки: 404 без новых полей", async () => {
    await pool.query(`UPDATE team_join_links SET revoked_at = NOW() WHERE code = $1`, [f.emptyCode]);
    for (const code of [f.emptyCode, "ZZZZZZ"]) {
      const res = await request(app).get(`/api/v1/join-requests/link/${code}`).expect(404);
      expect(res.body.code).toBe("JOIN_LINK_NOT_FOUND");
      expect(res.body.detail).toBe("Join link not found or revoked");
      expect(Object.keys(res.body).sort()).toEqual(["code", "correlationId", "detail"]);
    }
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
