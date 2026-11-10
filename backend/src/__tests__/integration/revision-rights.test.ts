// Пакет прав и целостности данных ревизии 11.11.2026 (PR 1 основы бэкенда).
//
// Решения Василия 10.11.2026: деньги (п. 9) — игрок видит свой долг и общий
// список должников, баланс команды и история — только капитану; рефлексии
// (п. 10) — свои видит игрок, чужие — капитан и тренер, команде обезличенная
// сводка. Остальное — находки ревью безопасности и ревью событий и денег.
//
// Ответы проверяются и на форму: старый фронтенд на проде читает
// `team.budget` числом, `members[].balance` и `transactions[]`.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

const stamp = Date.now() % 1_000_000;
const TG = {
  captain: String(971_000_000 + stamp),
  trainer: String(972_000_000 + stamp),
  player: String(973_000_000 + stamp),
  rich: String(974_000_000 + stamp),
  owner: String(975_000_000 + stamp),
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

const f = {
  teamId: "",
  users: {} as Record<keyof typeof TG, string>,
  memberships: {} as Record<string, string>,
  tournamentId: "",
  scheduleEventId: "",
  keptGameId: "",
  reflectedGameId: "",
  seriesId: "",
  seriesEventTitles: [] as string[],
};

// Вход один раз на роль: у входа общий лимит по IP (20 в минуту).
const agents = new Map<string, ReturnType<typeof request.agent>>();

async function login(who: keyof typeof TG) {
  const cached = agents.get(who);
  if (cached) return cached;
  const agent = request.agent(app);
  agents.set(who, agent);
  const res = await agent
    .post("/api/v1/auth/dev/login")
    .send({ telegramId: TG[who], username: `rr_${who}_${stamp}`, ensureTeam: false });
  expect(res.status).toBe(200);
  // /init выбирает активную команду в сессии — без неё ручки денег отвечают 403.
  if (who !== "owner") await agent.get("/api/v1/init").expect(200);
  return agent;
}

beforeAll(async () => {
  ({ app } = await import("../../app.js"));
  ({ pool } = await import("../../db/pool.js"));

  const team = await pool.query<{ id: string }>(
    `INSERT INTO teams (name, short_code, budget) VALUES ($1, $2, 5000) RETURNING id`,
    [`Rights ${stamp}`, `RR${stamp}`]
  );
  f.teamId = team.rows[0].id;

  for (const who of Object.keys(TG) as Array<keyof typeof TG>) {
    const u = await pool.query<{ id: string }>(
      `INSERT INTO users (telegram_id, username, name, nickname, account_role, onboarding_completed_at, role_selected_at)
       VALUES ($1::bigint, $2, $3, $4, 'USER', NOW(), NOW())
       RETURNING id`,
      [TG[who], `rr_${who}_${stamp}`, `Rights ${who}`, `rr_${who}`]
    );
    f.users[who] = u.rows[0].id;
  }

  const roles: Array<[keyof typeof TG, string, number]> = [
    ["captain", "CAPTAIN", 0],
    ["trainer", "TRAINER", 0],
    ["player", "PLAYER", -200],
    ["rich", "PLAYER", 1000],
  ];
  for (const [who, role, balance] of roles) {
    const m = await pool.query<{ id: string }>(
      `INSERT INTO team_memberships (user_id, team_id, role, balance) VALUES ($1, $2, $3::membership_role, $4) RETURNING id`,
      [f.users[who], f.teamId, role, balance]
    );
    f.memberships[who] = m.rows[0].id;
  }

  await pool.query(
    `INSERT INTO transactions (team_id, type, amount, title, date, user_id, user_name_snapshot, created_by)
     VALUES ($1, 'DEPOSIT', 1000, 'Взнос', NOW(), $2, 'Rights rich', $3)`,
    [f.teamId, f.users.rich, f.users.captain]
  );

  // Турнир со сбором: игроку начислено 500.
  const tournament = await pool.query<{ id: string }>(
    `INSERT INTO events (team_id, type, title, start_at, finance_state)
     VALUES ($1, 'TOURNAMENT', 'Турнир со сбором', NOW() + INTERVAL '3 days', 'COLLECTING') RETURNING id`,
    [f.teamId]
  );
  f.tournamentId = tournament.rows[0].id;
  await pool.query(
    `INSERT INTO event_member_charges (event_id, user_id, team_id, amount_due, created_by) VALUES ($1, $2, $3, 500, $4)`,
    [f.tournamentId, f.users.player, f.teamId, f.users.captain]
  );

  // Игра с пойнтом и двумя рефлексиями (игрока и «богатого» игрока).
  const game = await pool.query<{ id: string }>(
    `INSERT INTO event_games (event_id, time_label, opponent) VALUES ($1, '10:00', 'Соперник') RETURNING id`,
    [f.tournamentId]
  );
  const point = await pool.query<{ id: string }>(
    `INSERT INTO game_points (game_id, ordinal, result) VALUES ($1, 1, 'LOSS') RETURNING id`,
    [game.rows[0].id]
  );
  for (const who of ["player", "rich"] as const) {
    await pool.query(
      `INSERT INTO game_reflections (point_id, user_id, exit_reason, exit_phase, self_rating, note)
       VALUES ($1, $2, 'HIT', 'BREAK', 2, $3)`,
      [point.rows[0].id, f.users[who], `заметка ${who}`]
    );
  }

  // Событие для правки расписания: игра с рефлексией и пустая игра.
  const scheduleEvent = await pool.query<{ id: string }>(
    `INSERT INTO events (team_id, type, title, start_at) VALUES ($1, 'TOURNAMENT', 'Расписание', NOW() + INTERVAL '5 days') RETURNING id`,
    [f.teamId]
  );
  f.scheduleEventId = scheduleEvent.rows[0].id;
  const reflected = await pool.query<{ id: string }>(
    `INSERT INTO event_games (event_id, time_label, opponent) VALUES ($1, '11:00', 'С рефлексией') RETURNING id`,
    [f.scheduleEventId]
  );
  f.reflectedGameId = reflected.rows[0].id;
  const reflectedPoint = await pool.query<{ id: string }>(
    `INSERT INTO game_points (game_id, ordinal) VALUES ($1, 1) RETURNING id`,
    [f.reflectedGameId]
  );
  await pool.query(
    `INSERT INTO game_reflections (point_id, user_id, exit_reason) VALUES ($1, $2, 'SURVIVED')`,
    [reflectedPoint.rows[0].id, f.users.player]
  );
  const kept = await pool.query<{ id: string }>(
    `INSERT INTO event_games (event_id, time_label, opponent) VALUES ($1, '12:00', 'Пустая') RETURNING id`,
    [f.scheduleEventId]
  );
  f.keptGameId = kept.rows[0].id;

  // Серия тренировок, на которую игрок записан целиком, без явных ответов.
  const series = await pool.query<{ id: string }>(
    `INSERT INTO event_series (team_id, type, title, start_time_utc, end_time_utc, weekdays, until_date, created_by)
     VALUES ($1, 'TRAINING', 'Серия', '17:00', '19:00', ARRAY[1,3]::smallint[], (NOW() + INTERVAL '20 days')::date, $2)
     RETURNING id`,
    [f.teamId, f.users.captain]
  );
  f.seriesId = series.rows[0].id;
  f.seriesEventTitles = [`Серия занятие 1 ${stamp}`, `Серия занятие 2 ${stamp}`];
  for (const [i, title] of f.seriesEventTitles.entries()) {
    await pool.query(
      `INSERT INTO events (team_id, series_id, type, title, start_at) VALUES ($1, $2, 'TRAINING', $3, NOW() + make_interval(days => $4::int))`,
      [f.teamId, f.seriesId, title, 2 + i * 2]
    );
  }
  await pool.query(
    `INSERT INTO event_series_commitment (series_id, user_id, status) VALUES ($1, $2, 'COMMITTED')`,
    [f.seriesId, f.users.player]
  );
});

afterAll(async () => {
  await pool.query(`DELETE FROM teams WHERE id = $1`, [f.teamId]);
  await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.values(f.users)]);
});

describe("деньги: игрок видит свой долг и должников, книгу — только капитан", () => {
  it("/init игроку: бюджет 0, истории нет, у чужих — только долг", async () => {
    const player = await login("player");
    const res = await player.get("/api/v1/init");
    expect(res.status).toBe(200);
    expect(res.body.team.budget).toBe(0);
    expect(typeof res.body.team.budget).toBe("number");
    expect(res.body.team.financeScope).toBe("DEBTS_ONLY");
    expect(res.body.transactions).toEqual([]);
    const byId = new Map<string, any>(res.body.members.map((m: any) => [m.id, m]));
    expect(byId.get(f.users.player).balance).toBe(-500);
    // Взнос «богатого» игрока (+1000 в книге) игроку не виден.
    expect(byId.get(f.users.rich).balance).toBe(0);
    expect(byId.get(f.users.captain).balance).toBe(0);
  });

  it("/init тренеру — тоже без книги", async () => {
    const trainer = await login("trainer");
    const res = await trainer.get("/api/v1/init");
    expect(res.body.team.budget).toBe(0);
    expect(res.body.transactions).toEqual([]);
  });

  it("/init капитану — как раньше: бюджет, история, балансы", async () => {
    const captain = await login("captain");
    const res = await captain.get("/api/v1/init");
    expect(res.body.team.budget).toBe(5000);
    expect(res.body.team.financeScope).toBe("FULL");
    expect(res.body.transactions).toHaveLength(1);
    const rich = res.body.members.find((m: any) => m.id === f.users.rich);
    expect(rich.balance).toBe(1000);
  });

  it("/finance/overview — только капитану", async () => {
    expect((await (await login("player")).get("/api/v1/finance/overview")).status).toBe(403);
    expect((await (await login("trainer")).get("/api/v1/finance/overview")).status).toBe(403);
    const ok = await (await login("captain")).get("/api/v1/finance/overview");
    expect(ok.status).toBe(200);
    expect(ok.body.summary.balance).toBe(5000);
  });

  it("/finance/members игроку: долги всех, свои суммы целиком, чужие оплаты скрыты", async () => {
    const res = await (await login("player")).get("/api/v1/finance/members");
    expect(res.status).toBe(200);
    const me = res.body.items.find((i: any) => i.userId === f.users.player);
    expect(me).toMatchObject({ totalDue: 500, outstanding: 500 });
    const rich = res.body.items.find((i: any) => i.userId === f.users.rich);
    expect(rich).toMatchObject({ totalDue: 0, totalPaid: 0, overpaid: 0, outstanding: 0 });
  });
});

describe("рефлексии: свои — игроку, чужие — капитану и тренеру", () => {
  it("таблица события игроку — только свои строки и обезличенная сводка", async () => {
    const res = await (await login("player")).get(`/api/v1/reflections/events/${f.tournamentId}/table`);
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe("OWN");
    const rows = res.body.games.flatMap((g: any) => g.points.flatMap((p: any) => p.reflections));
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(f.users.player);
    // Командные цифры считаются по всем формам, а не по своим.
    expect(res.body.games[0].points[0].submitted).toBe(2);
    expect(res.body.summary.players.map((p: any) => p.userId)).toEqual([f.users.player]);
  });

  it("тренеру — все строки с именами", async () => {
    const res = await (await login("trainer")).get(`/api/v1/reflections/events/${f.tournamentId}/table`);
    expect(res.body.scope).toBe("TEAM");
    const rows = res.body.games.flatMap((g: any) => g.points.flatMap((p: any) => p.reflections));
    expect(rows.map((r: any) => r.note).sort()).toEqual(["заметка player", "заметка rich"]);
  });

  it("сводка по пойнту игроку — только своя форма", async () => {
    const pointId = (
      await pool.query<{ id: string }>(
        `SELECT p.id FROM game_points p JOIN event_games g ON g.id = p.game_id WHERE g.event_id = $1`,
        [f.tournamentId]
      )
    ).rows[0].id;
    const res = await (await login("player")).get(`/api/v1/reflections/points/${pointId}/summary`);
    expect(res.status).toBe(200);
    expect(res.body.submitted).toBe(2);
    expect(res.body.reflections.map((r: any) => r.userId)).toEqual([f.users.player]);
  });

  it("выгрузка CSV — 403 игроку, 200 тренеру", async () => {
    const denied = await (await login("player")).get(`/api/v1/reflections/events/${f.tournamentId}/table.csv`);
    expect(denied.status).toBe(403);
    const sendDenied = await (await login("player")).post(`/api/v1/reflections/events/${f.tournamentId}/table.csv/send`);
    expect(sendDenied.status).toBe(403);
    const ok = await (await login("trainer")).get(`/api/v1/reflections/events/${f.tournamentId}/table.csv`);
    expect(ok.status).toBe(200);
  });
});

describe("капитаны", () => {
  it("капитан не назначает капитана через admin v1", async () => {
    const res = await (await login("captain"))
      .patch(`/api/v1/admin/v1/team/members/${f.memberships.player}?teamId=${f.teamId}`)
      .send({ teamRole: "CAPTAIN" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CAPTAIN_ASSIGN_FORBIDDEN");
  });

  it("последнего капитана не понизить и не исключить", async () => {
    const captain = await login("captain");
    const demote = await captain.patch(`/api/v1/teams/${f.teamId}/memberships/${f.memberships.captain}`).send({ teamRole: "PLAYER" });
    expect(demote.status).toBe(409);
    expect(demote.body.code).toBe("LAST_CAPTAIN");
    const viaAdmin = await captain
      .patch(`/api/v1/admin/v1/team/members/${f.memberships.captain}?teamId=${f.teamId}`)
      .send({ teamRole: "PLAYER" });
    expect(viaAdmin.status).toBe(409);
    const remove = await captain.delete(`/api/v1/teams/${f.teamId}/memberships/${f.memberships.captain}`);
    expect(remove.status).toBe(409);
  });

  it("владелец назначает второго капитана; чужого капитана капитан не трогает, себя понижает", async () => {
    const owner = request.agent(app);
    await owner.post("/api/v1/auth/dev/login").send({ telegramId: TG.owner, username: `rr_owner_${stamp}`, ensureTeam: false }).expect(200);
    await owner.post("/api/v1/auth/select-role").send({ accountRole: "ADMIN" }).expect(200);
    await owner.patch(`/api/v1/teams/${f.teamId}/memberships/${f.memberships.rich}`).send({ teamRole: "CAPTAIN" }).expect(200);

    const captain = await login("captain");
    const touchOther = await captain.patch(`/api/v1/teams/${f.teamId}/memberships/${f.memberships.rich}`).send({ teamRole: "PLAYER" });
    expect(touchOther.status).toBe(403);
    expect(touchOther.body.code).toBe("CAPTAIN_PROTECTED");
    const removeOther = await captain.delete(`/api/v1/teams/${f.teamId}/memberships/${f.memberships.rich}`);
    expect(removeOther.status).toBe(403);

    const selfDemote = await captain.patch(`/api/v1/teams/${f.teamId}/memberships/${f.memberships.captain}`).send({ teamRole: "PLAYER" });
    expect(selfDemote.status).toBe(200);

    // Вернуть как было для следующих тестов.
    await pool.query(`UPDATE team_memberships SET role = 'CAPTAIN' WHERE id = $1`, [f.memberships.captain]);
    await pool.query(`UPDATE team_memberships SET role = 'PLAYER' WHERE id = $1`, [f.memberships.rich]);
  });

  it("добавление в команду не меняет человеку режим учётной записи", async () => {
    const owner = request.agent(app);
    await owner.post("/api/v1/auth/dev/login").send({ telegramId: TG.owner, username: `rr_owner_${stamp}`, ensureTeam: false }).expect(200);
    // Режима больше нет (трек 3): ручка выбора — пустышка и базу не трогает.
    // Старые учётки с ADMIN в базе остаются как есть.
    await owner.post("/api/v1/auth/select-role").send({ accountRole: "ADMIN" }).expect(200);
    await pool.query(`UPDATE users SET account_role = 'ADMIN' WHERE id = $1`, [f.users.owner]);
    const before = await pool.query<{ account_role: string }>(`SELECT account_role FROM users WHERE id = $1`, [f.users.owner]);
    expect(before.rows[0].account_role).toBe("ADMIN");

    const add = await owner.post(`/api/v1/teams/${f.teamId}/memberships`).send({ usernameOrId: f.users.owner, teamRole: "PLAYER" });
    expect(add.status).toBe(201);
    const after = await pool.query<{ account_role: string }>(`SELECT account_role FROM users WHERE id = $1`, [f.users.owner]);
    expect(after.rows[0].account_role).toBe("ADMIN");
    await pool.query(`DELETE FROM team_memberships WHERE user_id = $1 AND team_id = $2`, [f.users.owner, f.teamId]);
  });
});

describe("события", () => {
  it("ссылка на место — только http(s)", async () => {
    const captain = await login("captain");
    const bad = await captain.post("/api/v1/events").send({
      type: "TRAINING",
      title: "Плохая ссылка",
      startAt: new Date(Date.now() + 86_400_000).toISOString(),
      location: `Поле ${stamp}`,
      locationUrl: "javascript:alert(document.cookie)",
    });
    expect(bad.status).toBe(400);
    const good = await captain.post("/api/v1/events").send({
      type: "TRAINING",
      title: "Хорошая ссылка",
      startAt: new Date(Date.now() + 86_400_000).toISOString(),
      location: `Поле ${stamp}`,
      locationUrl: "https://yandex.ru/maps/-/test",
    });
    expect(good.status).toBeLessThan(300);
  });

  it("старая сохранённая javascript:-ссылка в ленту не попадает", async () => {
    await pool.query(
      `INSERT INTO saved_places (team_id, name, yandex_url) VALUES ($1, $2, 'javascript:alert(1)')
       ON CONFLICT (team_id, lower(name)) DO UPDATE SET yandex_url = EXCLUDED.yandex_url`,
      [f.teamId, `Старое поле ${stamp}`]
    );
    await pool.query(`UPDATE events SET location = $2 WHERE id = $1`, [f.tournamentId, `Старое поле ${stamp}`]);
    await pool.query(`INSERT INTO rsvps (event_id, user_id, status) VALUES ($1, $2, 'CONFIRMED') ON CONFLICT DO NOTHING`, [
      f.tournamentId,
      f.users.captain,
    ]);
    const res = await (await login("captain")).get("/api/v1/init");
    const event = res.body.events.find((e: any) => e.id === f.tournamentId);
    expect(event).toBeTruthy();
    expect(event.locationUrl).toBeUndefined();
  });

  it("тренер не правит турнир, сменив ему тип", async () => {
    const res = await (await login("trainer")).patch(`/api/v1/events/${f.tournamentId}`).send({ type: "TRAINING", title: "Уже тренировка" });
    expect(res.status).toBe(403);
    const row = await pool.query<{ type: string }>(`SELECT type::text FROM events WHERE id = $1`, [f.tournamentId]);
    expect(row.rows[0].type).toBe("TOURNAMENT");
  });

  it("правка расписания не удаляет игру с рефлексиями без явного подтверждения", async () => {
    const captain = await login("captain");
    const schedule = [{ id: f.keptGameId, time: "12:00", opponent: "Пустая" }];
    const blocked = await captain.patch(`/api/v1/events/${f.scheduleEventId}`).send({ schedule });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("GAMES_HAVE_REFLECTIONS");
    expect(blocked.body.games.map((g: any) => g.id)).toEqual([f.reflectedGameId]);
    const still = await pool.query(`SELECT 1 FROM event_games WHERE id = $1`, [f.reflectedGameId]);
    expect(still.rowCount).toBe(1);

    const confirmed = await captain
      .patch(`/api/v1/events/${f.scheduleEventId}`)
      .send({ schedule, confirmDeleteGameIds: [f.reflectedGameId] });
    expect(confirmed.status).toBe(200);
    const gone = await pool.query(`SELECT 1 FROM event_games WHERE id = $1`, [f.reflectedGameId]);
    expect(gone.rowCount).toBe(0);
  });

  it("событие с начатым сбором не удаляется", async () => {
    const res = await (await login("captain")).delete(`/api/v1/events/${f.tournamentId}`).send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EVENT_HAS_COLLECTION");
    const row = await pool.query<{ is_cancelled: boolean }>(`SELECT is_cancelled FROM events WHERE id = $1`, [f.tournamentId]);
    expect(row.rows[0].is_cancelled).toBe(false);
  });
});

describe("календарь и служебные ручки", () => {
  it("подписка ICS включает занятия серии, на которую человек записан целиком", async () => {
    const player = await login("player");
    const ics = await player.get("/api/v1/profile/ics");
    expect(ics.status).toBe(200);
    const path = new URL(ics.body.url).pathname;
    const feed = await request(app).get(path);
    expect(feed.status).toBe(200);
    for (const title of f.seriesEventTitles) {
      expect(feed.text).toContain(title);
    }
  });

  it("/health быстрый, /health?deep=1 проверяет базу", async () => {
    const fast = await request(app).get("/api/v1/health");
    expect(fast.body).toEqual({ status: "ok" });
    const deep = await request(app).get("/api/v1/health?deep=1");
    expect(deep.status).toBe(200);
    expect(deep.body).toMatchObject({ status: "ok", db: "ok" });
  });
});
