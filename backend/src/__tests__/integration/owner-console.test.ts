// Трек 3 ревизии 11.11.2026, PR 2: режима «админ или игрок» больше нет,
// консоль владельца — ручки `/platform`, журнал команды по-русски.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

const stamp = Date.now() % 1_000_000;
const TG = {
  owner: String(956_000_000 + stamp),
  captain: String(957_000_000 + stamp),
  player: String(958_000_000 + stamp),
  stranger: String(959_000_000 + stamp),
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

const CODE_OWN = `OwN${stamp}`;
const CODE_OTHER = `OtH${stamp}`;
const f = {
  ownTeam: "",
  otherTeam: "",
  createdTeam: "",
  users: {} as Record<keyof typeof TG, string>,
  ownerMembership: "",
};

const agents = new Map<string, ReturnType<typeof request.agent>>();
async function login(who: keyof typeof TG) {
  const cached = agents.get(who);
  if (cached) return cached;
  const agent = request.agent(app);
  agents.set(who, agent);
  await agent
    .post("/api/v1/auth/dev/login")
    .send({ telegramId: TG[who], username: `oc_${who}_${stamp}`, ensureTeam: false })
    .expect(200);
  return agent;
}

beforeAll(async () => {
  ({ app } = await import("../../app.js"));
  ({ pool } = await import("../../db/pool.js"));
  const own = await pool.query<{ id: string }>(
    `INSERT INTO teams (name, short_code) VALUES ($1, $2) RETURNING id`,
    [`ЯЯ Своя ${stamp}`, CODE_OWN]
  );
  const other = await pool.query<{ id: string }>(
    `INSERT INTO teams (name, short_code) VALUES ($1, $2) RETURNING id`,
    [`ЯЯ Чужая ${stamp}`, CODE_OTHER]
  );
  f.ownTeam = own.rows[0].id;
  f.otherTeam = other.rows[0].id;
  for (const who of Object.keys(TG) as Array<keyof typeof TG>) {
    const u = await pool.query<{ id: string }>(
      `INSERT INTO users (telegram_id, username, name, nickname, account_role, onboarding_completed_at, role_selected_at)
       VALUES ($1::bigint, $2, $3, $4, 'USER', NOW(), NOW()) RETURNING id`,
      [TG[who], `oc_${who}_${stamp}`, `Консоль ${who}`, `oc_${who}`]
    );
    f.users[who] = u.rows[0].id;
  }
  const m = await pool.query<{ id: string }>(
    `INSERT INTO team_memberships (user_id, team_id, role) VALUES ($1, $2, 'CAPTAIN') RETURNING id`,
    [f.users.owner, f.ownTeam]
  );
  f.ownerMembership = m.rows[0].id;
  await pool.query(
    `INSERT INTO team_memberships (user_id, team_id, role) VALUES ($1, $3, 'CAPTAIN'), ($2, $3, 'PLAYER')`,
    [f.users.captain, f.users.player, f.otherTeam]
  );
  await pool.query(
    `INSERT INTO events (team_id, type, title, start_at) VALUES ($1, 'TRAINING', $2, NOW() + INTERVAL '2 days')`,
    [f.otherTeam, `Ближайшая ${stamp}`]
  );
});

afterAll(async () => {
  await pool.query(`DELETE FROM teams WHERE id = ANY($1::uuid[])`, [[f.ownTeam, f.otherTeam, f.createdTeam].filter(Boolean)]);
  await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.values(f.users)]);
});

describe("режима учётной записи нет", () => {
  it("владелец узнаётся по тому, кто он: /auth/me без режима", async () => {
    const owner = await login("owner");
    const me = await owner.get("/api/v1/auth/me");
    expect(me.body).toMatchObject({ accountRole: "USER", roleSelectionRequired: false, platformOwner: true, adminScope: "PLATFORM" });
    const player = await login("player");
    expect((await player.get("/api/v1/auth/me")).body).toMatchObject({ platformOwner: false });
  });

  it("/auth/select-role — пустышка: команда в сессии не сбрасывается, /init не уходит в консоль", async () => {
    const owner = await login("owner");
    await owner.post("/api/v1/auth/context").send({ membershipId: f.ownerMembership }).expect(200);
    const selected = await owner.post("/api/v1/auth/select-role").send({ accountRole: "ADMIN" });
    expect(selected.status).toBe(200);
    expect(selected.body).toMatchObject({ ok: true });
    const init = await owner.get("/api/v1/init");
    expect(init.status).toBe(200);
    expect(init.body.admin).toBeUndefined();
    expect(init.body.team.id).toBe(f.ownTeam);

    const player = await login("player");
    expect((await player.post("/api/v1/auth/select-role").send({ accountRole: "ADMIN" })).status).toBe(403);
    expect((await player.post("/api/v1/auth/select-role").send({ accountRole: "USER" })).status).toBe(200);
  });

  it("старая консоль владельца работает без переключения режима", async () => {
    const owner = await login("owner");
    const overview = await owner.get(`/api/v1/admin/v1/overview?teamId=${f.otherTeam}`);
    expect(overview.status).toBe(200);
  });

  it("в переключателе — все команды: сначала свои, потом остальные с пометкой владельца", async () => {
    const owner = await login("owner");
    const init = await owner.get(`/api/v1/init?team=${CODE_OTHER.toLowerCase()}`);
    expect(init.status).toBe(200);
    expect(init.body.team).toMatchObject({ id: f.otherTeam, via: "owner", role: "CAPTAIN" });
    const teams = init.body.teams as Array<{ teamId: string; via: string }>;
    expect(teams[0]).toMatchObject({ teamId: f.ownTeam, via: "membership" });
    expect(teams.find((t) => t.teamId === f.otherTeam)).toMatchObject({ via: "owner" });
  });

  it("события чужой команды помечены: владелец не в составе, свой ответ на явку ему не предлагают", async () => {
    const owner = await login("owner");
    const init = await owner.get(`/api/v1/init?team=${CODE_OTHER.toLowerCase()}`);
    const foreign = (init.body.events as Array<{ title: string; viewerInRoster: boolean }>).find(
      (e) => e.title === `Ближайшая ${stamp}`
    );
    expect(foreign).toMatchObject({ viewerInRoster: false });

    const player = await login("player");
    const own = await player.get(`/api/v1/init?team=${CODE_OTHER.toLowerCase()}`);
    const all = [...own.body.events, ...own.body.actionRequiredEvents] as Array<{ title: string; viewerInRoster: boolean }>;
    expect(all.find((e) => e.title === `Ближайшая ${stamp}`)).toMatchObject({ viewerInRoster: true });
  });
});

describe("консоль /platform — только владельцу", () => {
  it("список команд с состоянием и поиском", async () => {
    const owner = await login("owner");
    const list = await owner.get("/api/v1/platform/teams");
    expect(list.status).toBe(200);
    const other = list.body.items.find((t: any) => t.id === f.otherTeam);
    expect(other).toMatchObject({ shortCode: CODE_OTHER, membersCount: 2, captains: ["Консоль captain"], isMine: false });
    expect(other.nextEvent.title).toBe(`Ближайшая ${stamp}`);
    expect(other.lastActivityAt).toBeTruthy();
    expect(list.body.items.find((t: any) => t.id === f.ownTeam)).toMatchObject({ isMine: true });

    const found = await owner.get(`/api/v1/platform/teams?q=${encodeURIComponent(`Чужая ${stamp}`)}`);
    expect(found.body.items.map((t: any) => t.id)).toEqual([f.otherTeam]);
  });

  it("карточка команды по коду", async () => {
    const owner = await login("owner");
    const card = await owner.get(`/api/v1/platform/teams/${CODE_OTHER.toLowerCase()}`);
    expect(card.status).toBe(200);
    expect(card.body.team.id).toBe(f.otherTeam);
    expect(card.body.members.map((m: any) => m.role)).toEqual(["CAPTAIN", "PLAYER"]);
    expect(card.body.upcomingEvents).toHaveLength(1);
    expect((await owner.get("/api/v1/platform/teams/nosuchteam")).status).toBe(404);
  });

  it("создать команду: код подставляется, владелец в состав не попадает", async () => {
    const owner = await login("owner");
    const suggestion = await owner.get(`/api/v1/platform/teams/code-suggestion?name=${encodeURIComponent("Дневной Дозор")}`);
    expect(suggestion.status).toBe(200);
    expect(suggestion.body.shortCode).toMatch(/^DNEDOZ/);

    const created = await owner.post("/api/v1/platform/teams").send({ name: `Новая ${stamp}` });
    expect(created.status).toBe(201);
    f.createdTeam = created.body.team.id;
    expect(created.body.team.shortCode).toMatch(/^NOV/);
    const membership = await pool.query(`SELECT 1 FROM team_memberships WHERE team_id = $1`, [f.createdTeam]);
    expect(membership.rowCount).toBe(0);

    const taken = await owner.post("/api/v1/platform/teams").send({ name: "Дубль", shortCode: CODE_OTHER.toLowerCase() });
    expect(taken.status).toBe(409);
  });

  it("остальным — отказ", async () => {
    const captain = await login("captain");
    expect((await captain.get("/api/v1/platform/teams")).status).toBe(403);
    expect((await captain.get(`/api/v1/platform/teams/${CODE_OTHER}`)).status).toBe(403);
    expect((await captain.post("/api/v1/platform/teams").send({ name: "Самовольная" })).status).toBe(403);
  });
});

describe("журнал команды", () => {
  it("капитан видит действие владельца по-русски и с пометкой", async () => {
    const owner = await login("owner");
    await owner
      .post("/api/v1/events")
      .set("X-PBTH-Team", f.otherTeam)
      .send({ type: "TRAINING", title: `От владельца ${stamp}`, startAt: new Date(Date.now() + 3 * 86_400_000).toISOString() })
      .expect(201);
    const captain = await login("captain");
    await captain
      .post("/api/v1/events")
      .send({ teamId: f.otherTeam, type: "MEETING", title: `От капитана ${stamp}`, startAt: new Date(Date.now() + 4 * 86_400_000).toISOString() })
      .set("X-PBTH-Team", f.otherTeam)
      .expect(201);
    // Служебное действие капитана в журнал не попадает.
    const membership = await pool.query<{ id: string }>(
      `SELECT id FROM team_memberships WHERE user_id = $1 AND team_id = $2`,
      [f.users.captain, f.otherTeam]
    );
    await captain.post("/api/v1/auth/context").send({ membershipId: membership.rows[0].id }).expect(200);

    const journal = await captain.get(`/api/v1/platform/teams/${f.otherTeam}/journal`);
    expect(journal.status).toBe(200);
    const items = journal.body.items as Array<{ text: string; byOwner: boolean; actorName: string }>;
    expect(items.find((i) => i.text === `Создал событие «От владельца ${stamp}»`)).toMatchObject({
      byOwner: true,
      actorName: "Консоль owner",
    });
    expect(items.find((i) => i.text === `Создал событие «От капитана ${stamp}»`)).toMatchObject({ byOwner: false });
    const raw = JSON.stringify(journal.body);
    expect(raw).not.toContain("events.create");
    expect(raw).not.toContain("auth.context.switch");
    expect(raw).not.toContain("Переключ");
  });

  it("владелец тоже видит журнал чужой команды; игроку и постороннему — отказ", async () => {
    const owner = await login("owner");
    expect((await owner.get(`/api/v1/platform/teams/${f.otherTeam}/journal`)).status).toBe(200);
    const player = await login("player");
    expect((await player.get(`/api/v1/platform/teams/${f.otherTeam}/journal`)).status).toBe(403);
    const stranger = await login("stranger");
    expect((await stranger.get(`/api/v1/platform/teams/${f.otherTeam}/journal`)).status).toBe(403);
  });

  it("владелец в чужой команде не числится в составе — рассылки команды его не находят", async () => {
    const memberships = await pool.query(`SELECT 1 FROM team_memberships WHERE user_id = $1 AND team_id = $2`, [
      f.users.owner,
      f.otherTeam,
    ]);
    expect(memberships.rowCount).toBe(0);
    const player = await login("player");
    const init = await player.get(`/api/v1/init?team=${CODE_OTHER}`);
    expect(init.body.members.some((m: any) => m.id === f.users.owner)).toBe(false);
  });
});
