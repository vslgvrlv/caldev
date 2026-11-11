// Трек 1 ревизии PBTH «Вход и заявки» (11.11.2026), боль Б1: новичок с
// телефона доходит от ссылки команды до заявки у капитана, капитан или тренер
// одобряет одним тапом из сообщения бота, после одобрения человек в команде.
//
// Держит контракты:
//   - ссылка команды `/join/<код>`: одна живая, отзыв выпускает новую;
//   - заявка → карточка с кнопками `join:*` капитану и тренеру → решение;
//   - право решать: капитан и тренер, игрок — нет; тренером делает капитан;
//   - приглашение капитана именное и одноразовое;
//   - заявка на команду → карточка `team:*` владельцу → команда с кодом.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

const stamp = Date.now() % 1_000_000;
const TG = {
  captain: String(981_000_000 + stamp),
  trainer: String(982_000_000 + stamp),
  player: String(983_000_000 + stamp),
  newbie: String(984_000_000 + stamp),
  second: String(985_000_000 + stamp),
  owner: String(986_000_000 + stamp),
  founder: String(987_000_000 + stamp),
  soloCaptain: String(988_000_000 + stamp),
  invited: String(989_000_000 + stamp),
  intruder: String(990_000_000 + stamp),
};
type Who = keyof typeof TG;

process.env.AUTH_PAIRING_ENABLED = "1";
process.env.TELEGRAM_BOT_TOKEN = "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = "dummy_bot";
process.env.TELEGRAM_WEBHOOK_SECRET = "track1-webhook-secret";
process.env.TELEGRAM_CALLBACK_URL =
  process.env.TELEGRAM_CALLBACK_URL || "http://127.0.0.1:8000/api/v1/auth/telegram/callback";
process.env.FRONTEND_URL = "https://staging.pbthub.ru";
process.env.DEV_AUTH_ENABLED = "1";
process.env.DEV_AUTH_SECRET = "";
process.env.ADMIN_ROLE_ALLOWLIST_IDS = TG.owner;

let app: typeof import("../../app.js").app;
let pool: typeof import("../../db/pool.js").pool;

const f = {
  team: "",
  teamCode: `J1${stamp}`,
  soloTeam: "",
  users: {} as Record<Who, string>,
  createdTeams: [] as string[],
};

type BotCall = { method: string; payload: any };
let botCalls: BotCall[] = [];

function stubTelegram() {
  botCalls = [];
  let messageId = 5000;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, init: any) => {
      const method = String(url).split("/").pop() ?? "";
      botCalls.push({ method, payload: JSON.parse(String(init?.body ?? "{}")) });
      messageId += 1;
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: messageId } }) } as any;
    })
  );
}

function webhook(update: Record<string, unknown>) {
  return request(app)
    .post("/api/v1/vendor/telegram/webhook")
    .set("x-telegram-bot-api-secret-token", "track1-webhook-secret")
    .send(update);
}

function pressButton(who: Who, data: string, messageId = 5001) {
  return webhook({
    callback_query: {
      id: `cbq-${who}-${Math.random()}`,
      data,
      from: { id: Number(TG[who]), first_name: who },
      message: { message_id: messageId, chat: { id: Number(TG[who]) }, text: "Заявка" },
    },
  });
}

const agents = new Map<Who, ReturnType<typeof request.agent>>();
async function login(who: Who) {
  const cached = agents.get(who);
  if (cached) return cached;
  const agent = request.agent(app);
  agents.set(who, agent);
  await agent
    .post("/api/v1/auth/dev/login")
    .send({ telegramId: TG[who], username: `t1_${who}_${stamp}`, ensureTeam: false })
    .expect(200);
  return agent;
}

const sentTo = (method: string, chatId: string) =>
  botCalls.filter((c) => c.method === method && String(c.payload.chat_id) === chatId);

beforeAll(async () => {
  ({ app } = await import("../../app.js"));
  ({ pool } = await import("../../db/pool.js"));

  for (const who of Object.keys(TG) as Who[]) {
    // Новичка создаёт вход по коду — как у настоящего человека.
    if (who === "newbie") continue;
    const u = await pool.query<{ id: string }>(
      `INSERT INTO users (telegram_id, username, name, nickname, account_role, onboarding_completed_at, role_selected_at)
       VALUES ($1::bigint, $2, $3, $4, 'USER', NOW(), NOW()) RETURNING id`,
      [TG[who], `t1_${who}_${stamp}`, `Трек1 ${who}`, `t1_${who}`]
    );
    f.users[who] = u.rows[0].id;
  }
  const team = await pool.query<{ id: string }>(
    `INSERT INTO teams (name, short_code) VALUES ($1, $2) RETURNING id`,
    [`Заявки ${stamp}`, f.teamCode]
  );
  f.team = team.rows[0].id;
  await pool.query(
    `INSERT INTO team_memberships (user_id, team_id, role) VALUES ($1, $4, 'CAPTAIN'), ($2, $4, 'TRAINER'), ($3, $4, 'PLAYER')`,
    [f.users.captain, f.users.trainer, f.users.player, f.team]
  );
  await pool.query(
    `INSERT INTO events (team_id, type, title, start_at, location) VALUES ($1, 'TRAINING', 'Тренировка', NOW() + INTERVAL '3 days', 'Точка')`,
    [f.team]
  );
  const solo = await pool.query<{ id: string }>(
    `INSERT INTO teams (name, short_code) VALUES ($1, $2) RETURNING id`,
    [`Без тренера ${stamp}`, `J2${stamp}`]
  );
  f.soloTeam = solo.rows[0].id;
  await pool.query(`INSERT INTO team_memberships (user_id, team_id, role) VALUES ($1, $2, 'CAPTAIN')`, [
    f.users.soloCaptain,
    f.soloTeam,
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await pool.query(`DELETE FROM auth_pairing_attempts WHERE redirect_to LIKE '/join/%'`);
  await pool.query(`DELETE FROM team_creation_requests WHERE user_id = ANY($1::uuid[])`, [Object.values(f.users)]);
  await pool.query(`DELETE FROM teams WHERE id = ANY($1::uuid[])`, [[f.team, f.soloTeam, ...f.createdTeams]]);
  await pool.query(`DELETE FROM users WHERE telegram_id = ANY($1::bigint[])`, [Object.values(TG)]);
});

async function teamLinkCode(teamId = f.team, who: Who = "captain"): Promise<string> {
  const captain = await login(who);
  const res = await captain.get(`/api/v1/teams/${teamId}/join-link`).expect(200);
  return String(res.body.code);
}

describe("ссылка команды", () => {
  it("одна живая ссылка: повторный запрос отдаёт ту же, отзыв выпускает новую", async () => {
    const first = await teamLinkCode();
    expect(first).toMatch(/^[A-Z0-9]{6}$/);
    expect(await teamLinkCode()).toBe(first);

    const captain = await login("captain");
    const rotated = await captain.post(`/api/v1/teams/${f.team}/join-link/rotate`).send({}).expect(200);
    expect(rotated.body.code).not.toBe(first);
    expect(rotated.body.url).toBe(`https://staging.pbthub.ru/join/${rotated.body.code}`);

    // Старая ссылка больше не открывает команду.
    await request(app).get(`/api/v1/join-requests/link/${first}`).expect(404);
    // Код без учёта регистра.
    const lower = await request(app).get(`/api/v1/join-requests/link/${String(rotated.body.code).toLowerCase()}`).expect(200);
    expect(lower.body.team.name).toBe(`Заявки ${stamp}`);
  });

  it("ссылку видят капитан и тренер, меняет только капитан", async () => {
    const player = await login("player");
    await player.get(`/api/v1/teams/${f.team}/join-link`).expect(403);
    await player.post(`/api/v1/teams/${f.team}/join-link/rotate`).send({}).expect(403);
    const captainCode = await teamLinkCode();
    const trainer = await login("trainer");
    const seen = await trainer.get(`/api/v1/teams/${f.team}/join-link`).expect(200);
    expect(seen.body.code).toBe(captainCode);
    expect(seen.body.url).toBe(`https://staging.pbthub.ru/join/${captainCode}`);
    await trainer.post(`/api/v1/teams/${f.team}/join-link/rotate`).send({}).expect(403);
    expect(await teamLinkCode()).toBe(captainCode);
  });
});

describe("новичок: ссылка → вход → заявка → «Принять» в боте → команда", () => {
  it("проходит целиком", async () => {
    const code = await teamLinkCode();
    const joinPath = `/join/${code}`;
    const browser = request.agent(app);

    // 1. Ссылка без входа: название команды, без состава и денег.
    const preview = await browser.get(`/api/v1/join-requests/link/${code}`).expect(200);
    expect(preview.body).toMatchObject({ authenticated: false, member: false, request: null });
    expect(preview.body.team.name).toBe(`Заявки ${stamp}`);
    expect(preview.body).not.toHaveProperty("members");

    // 2. Вход кодом через бота; адрес ссылки едет с кодом.
    stubTelegram();
    const started = await browser.post("/api/v1/auth/pair/start").send({ scope: "USER", redirectTo: joinPath }).expect(200);
    const pairCode = String(started.body.code);
    await webhook({
      message: {
        message_id: 71,
        text: pairCode,
        chat: { id: Number(TG.newbie) },
        from: { id: Number(TG.newbie), first_name: "Новичок", username: `t1_newbie_${stamp}` },
      },
    }).expect(200);
    const card = botCalls.find((c) => c.method === "sendMessage");
    const approveLogin = card!.payload.reply_markup.inline_keyboard[0][0].callback_data as string;
    await pressButton("newbie", approveLogin, 5001).expect(200);
    const status = await browser.get(`/api/v1/auth/pair/status?code=${encodeURIComponent(pairCode)}`).expect(200);
    expect(status.body).toEqual({ status: "approved", redirectTo: joinPath });
    const newbieId = (await pool.query<{ id: string }>(`SELECT id FROM users WHERE telegram_id = $1::bigint`, [TG.newbie]))
      .rows[0].id;
    f.users.newbie = newbieId;

    // 3. Заявка: капитану и тренеру — карточка с кнопками, игроку — ничего.
    stubTelegram();
    const created = await browser.post("/api/v1/join-requests").send({ code }).expect(201);
    const requestId = created.body.request.id as string;
    expect(created.body.request.status).toBe("PENDING");
    expect(created.body.request.team.name).toBe(`Заявки ${stamp}`);
    // Человек ещё не в команде: время, тип и пояс — без названия и места.
    expect(Object.keys(created.body.request.nextEvent).sort()).toEqual(["startsAt", "timezone", "type"]);
    expect(created.body.request.nextEvent.type).toBe("TRAINING");

    const captainCard = sentTo("sendMessage", TG.captain);
    const trainerCard = sentTo("sendMessage", TG.trainer);
    expect(captainCard).toHaveLength(1);
    expect(trainerCard).toHaveLength(1);
    expect(sentTo("sendMessage", TG.player)).toHaveLength(0);
    const buttons = captainCard[0].payload.reply_markup.inline_keyboard;
    expect(buttons[0].map((b: any) => b.text)).toEqual(["Принять", "Отклонить"]);
    expect(buttons[0][0].callback_data).toBe(`join:approve:${requestId}`);
    expect(captainCard[0].payload.text).toContain(`Заявки ${stamp}`);

    // Повторное открытие ссылки — та же заявка, новых карточек нет.
    stubTelegram();
    const again = await browser.post("/api/v1/join-requests").send({ code }).expect(200);
    expect(again.body.request.id).toBe(requestId);
    expect(botCalls.filter((c) => c.method === "sendMessage")).toHaveLength(0);

    // Пока ждёт — команды нет.
    const waiting = await browser.get("/api/v1/init").expect(200);
    expect(waiting.body.noTeamYet).toBe(true);
    const mine = await browser.get(`/api/v1/join-requests/${requestId}`).expect(200);
    expect(mine.body.request.status).toBe("PENDING");

    // Капитан видит заявку в приложении и число для значка.
    const captain = await login("captain");
    const list = await captain.get("/api/v1/join-requests").set("X-PBTH-Team", f.team).expect(200);
    expect(list.body.count).toBe(1);
    expect(list.body.requests[0].user.id).toBe(newbieId);

    // 4. «Принять» в боте.
    stubTelegram();
    await pressButton("captain", `join:approve:${requestId}`, 5001).expect(200);
    const answer = botCalls.find((c) => c.method === "answerCallbackQuery");
    expect(answer!.payload.text).toBe("Принят в команду");
    // Карточки закрылись у обоих одобряющих.
    expect(botCalls.filter((c) => c.method === "editMessageText")).toHaveLength(2);
    // Новичку — сообщение со ссылкой на команду.
    const welcome = sentTo("sendMessage", TG.newbie);
    expect(welcome).toHaveLength(1);
    expect(welcome[0].payload.text).toContain(`Заявки ${stamp}`);
    expect(welcome[0].payload.reply_markup.inline_keyboard[0][0].url).toBe(
      `https://staging.pbthub.ru/t/${f.teamCode.toLowerCase()}`
    );

    // 5. Членство игрока, главная команды открывается.
    const membership = await pool.query<{ role: string }>(
      `SELECT role::text FROM team_memberships WHERE team_id = $1 AND user_id = $2`,
      [f.team, newbieId]
    );
    expect(membership.rows[0].role).toBe("PLAYER");
    const decided = await browser.get(`/api/v1/join-requests/${requestId}`).expect(200);
    expect(decided.body.request.status).toBe("APPROVED");
    const home = await browser.get("/api/v1/init").expect(200);
    expect(home.body.team.id).toBe(f.team);

    // 6. Повторное нажатие и повторное открытие ссылки ничего не ломают.
    stubTelegram();
    await pressButton("trainer", `join:approve:${requestId}`).expect(200);
    expect(botCalls.find((c) => c.method === "answerCallbackQuery")!.payload.text).toBe("Уже принят");
    const reopened = await browser.post("/api/v1/join-requests").send({ code }).expect(200);
    expect(reopened.body).toMatchObject({ member: true, request: null });
    const linkAsMember = await browser.get(`/api/v1/join-requests/link/${code}`).expect(200);
    expect(linkAsMember.body.member).toBe(true);
  });

  it("отказ: человек видит статус, членства нет", async () => {
    const code = await teamLinkCode();
    stubTelegram();
    const second = await login("second");
    const created = await second.post("/api/v1/join-requests").send({ code }).expect(201);
    const requestId = created.body.request.id as string;

    const captain = await login("captain");
    stubTelegram();
    const declined = await captain.post(`/api/v1/join-requests/${requestId}/decline`).send({}).expect(200);
    expect(declined.body.status).toBe("DECLINED");
    // Решение в приложении тоже закрывает карточки в боте.
    expect(botCalls.filter((c) => c.method === "editMessageText")).toHaveLength(2);
    // Человеку — короткое сообщение об отказе, без имени того, кто отклонил.
    const notice = sentTo("sendMessage", TG.second);
    expect(notice).toHaveLength(1);
    expect(notice[0].payload.text).toBe(`Заявку в команду «Заявки ${stamp}» отклонили.`);
    expect(notice[0].payload.text).not.toContain("Трек1");

    const seen = await second.get(`/api/v1/join-requests/${requestId}`).expect(200);
    expect(seen.body.request.status).toBe("DECLINED");
    expect(seen.body.request.nextEvent).toBeNull();
    const membership = await pool.query(`SELECT 1 FROM team_memberships WHERE team_id = $1 AND user_id = $2`, [
      f.team,
      f.users.second,
    ]);
    expect(membership.rowCount).toBe(0);
    const preview = await second.get(`/api/v1/join-requests/link/${code}`).expect(200);
    expect(preview.body.request.status).toBe("DECLINED");
  });
});

describe("кто решает заявки", () => {
  async function freshRequest(who: Who, teamId = f.team, linkOwner: Who = "captain") {
    const code = await teamLinkCode(teamId, linkOwner);
    await pool.query(`DELETE FROM team_join_requests WHERE user_id = $1`, [f.users[who]]);
    await pool.query(`DELETE FROM team_memberships WHERE user_id = $1 AND team_id = $2`, [f.users[who], teamId]);
    stubTelegram();
    const agent = await login(who);
    const created = await agent.post("/api/v1/join-requests").send({ code }).expect(201);
    return created.body.request.id as string;
  }

  it("игрок не может: ни в приложении, ни кнопкой в боте", async () => {
    const requestId = await freshRequest("intruder");
    const player = await login("player");
    await player.post(`/api/v1/join-requests/${requestId}/approve`).send({}).expect(403);
    await player.get("/api/v1/join-requests").set("X-PBTH-Team", f.team).expect(403);
    stubTelegram();
    await pressButton("player", `join:approve:${requestId}`).expect(200);
    expect(botCalls.find((c) => c.method === "answerCallbackQuery")!.payload.text).toBe(
      "Решать заявки может капитан или тренер команды"
    );
    const still = await pool.query<{ status: string }>(`SELECT status::text FROM team_join_requests WHERE id = $1`, [requestId]);
    expect(still.rows[0].status).toBe("PENDING");
  });

  it("тренер может принять заявку", async () => {
    const requestId = await freshRequest("intruder");
    const trainer = await login("trainer");
    stubTelegram();
    const approved = await trainer.post(`/api/v1/join-requests/${requestId}/approve`).send({}).expect(200);
    expect(approved.body.status).toBe("APPROVED");
  });

  it("пока тренера нет, карточка уходит только капитану", async () => {
    await freshRequest("intruder", f.soloTeam, "soloCaptain");
    const recipients = botCalls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.chat_id));
    expect(recipients).toEqual([TG.soloCaptain]);
  });

  it("тренером делает только капитан; тренер не назначает тренеров", async () => {
    const intruderMembership = await pool.query<{ id: string }>(
      `SELECT id FROM team_memberships WHERE team_id = $1 AND user_id = $2`,
      [f.team, f.users.intruder]
    );
    const membershipId = intruderMembership.rows[0].id;
    const trainer = await login("trainer");
    await trainer.patch(`/api/v1/teams/${f.team}/memberships/${membershipId}`).send({ teamRole: "TRAINER" }).expect(403);
    const captain = await login("captain");
    await captain.patch(`/api/v1/teams/${f.team}/memberships/${membershipId}`).send({ teamRole: "TRAINER" }).expect(200);
    await captain.patch(`/api/v1/teams/${f.team}/memberships/${membershipId}`).send({ teamRole: "PLAYER" }).expect(200);
    // Капитаном капитан не назначает — только владелец платформы (caldev#131).
    await captain.patch(`/api/v1/teams/${f.team}/memberships/${membershipId}`).send({ teamRole: "CAPTAIN" }).expect(403);
  });
});

describe("приглашение капитана — именное и одноразовое", () => {
  it("срабатывает один раз", async () => {
    const owner = await login("owner");
    const created = await owner
      .post(`/api/v1/teams/${f.soloTeam}/invites`)
      .set("X-PBTH-Team", f.soloTeam)
      .send({ teamRole: "CAPTAIN", singleUse: true, note: "Для капитана Дозора" })
      .expect(201);
    expect(created.body).toMatchObject({ role: "CAPTAIN", singleUse: true, note: "Для капитана Дозора" });
    const token = created.body.token as string;

    const info = await request(app).get(`/api/v1/teams/invites/${token}`).expect(200);
    expect(info.body.note).toBe("Для капитана Дозора");

    const invited = await login("invited");
    await invited.post(`/api/v1/teams/invites/${token}/accept`).send({}).expect(200);
    const role = await pool.query<{ role: string }>(
      `SELECT role::text FROM team_memberships WHERE team_id = $1 AND user_id = $2`,
      [f.soloTeam, f.users.invited]
    );
    expect(role.rows[0].role).toBe("CAPTAIN");

    // Второй человек по той же ссылке не проходит.
    const intruder = await login("intruder");
    const reused = await intruder.post(`/api/v1/teams/invites/${token}/accept`).send({}).expect(409);
    expect(reused.body.code).toBe("INVITE_USED");
    const used = await request(app).get(`/api/v1/teams/invites/${token}`).expect(409);
    expect(used.body.code).toBe("INVITE_USED");
  });

  it("владелец, который сам капитан команды, выдаёт приглашение второму капитану", async () => {
    // Владелец становится капитаном команды без тренера (как Василий в своей).
    await pool.query(`INSERT INTO team_memberships (user_id, team_id, role) VALUES ($1, $2, 'CAPTAIN') ON CONFLICT DO NOTHING`, [
      f.users.owner,
      f.soloTeam,
    ]);
    const owner = await login("owner");
    const created = await owner
      .post(`/api/v1/teams/${f.soloTeam}/invites`)
      .send({ teamRole: "CAPTAIN", singleUse: true, note: "Второй капитан" })
      .expect(201);
    expect(created.body).toMatchObject({ role: "CAPTAIN", singleUse: true });
    await pool.query(`DELETE FROM team_memberships WHERE user_id = $1 AND team_id = $2`, [f.users.owner, f.soloTeam]);
  });

  it("владелец создаёт команду напрямую, капитан — нет", async () => {
    const owner = await login("owner");
    const created = await owner
      .post("/api/v1/teams")
      .send({ name: `Прямая ${stamp}`, shortCode: `J3${stamp}` })
      .expect(201);
    f.createdTeams.push(created.body.team.id);
    const captain = await login("captain");
    await captain.post("/api/v1/teams").send({ name: `Чужая ${stamp}`, shortCode: `J4${stamp}` }).expect(403);
  });

  it("удаление участника пишется в журнал с командой", async () => {
    const extra = await pool.query<{ id: string }>(
      `INSERT INTO team_memberships (user_id, team_id, role) VALUES ($1, $2, 'PLAYER') RETURNING id`,
      [f.users.second, f.team]
    );
    const captain = await login("captain");
    await captain.delete(`/api/v1/teams/${f.team}/memberships/${extra.rows[0].id}`).expect(200);
    const audit = await pool.query<{ payload: any }>(
      `SELECT payload FROM audit_logs WHERE action = 'teams.membership.delete' AND payload->>'membershipId' = $1`,
      [extra.rows[0].id]
    );
    expect(audit.rows[0].payload.teamId).toBe(f.team);
  });

  it("капитан не выпускает приглашение капитана", async () => {
    const captain = await login("captain");
    await captain.post(`/api/v1/teams/${f.team}/invites`).send({ teamRole: "CAPTAIN", singleUse: true }).expect(403);
  });
});

describe("заявка на создание команды", () => {
  it("человек без команды → карточка владельцу → «Принять» → команда с кодом, он капитан", async () => {
    const founder = await login("founder");
    stubTelegram();
    const created = await founder.post("/api/v1/team-requests").send({ name: "Дневной Дозор" }).expect(201);
    const requestId = created.body.request.id as string;
    expect(created.body.request.status).toBe("PENDING");

    const ownerCard = sentTo("sendMessage", TG.owner);
    expect(ownerCard).toHaveLength(1);
    expect(ownerCard[0].payload.reply_markup.inline_keyboard[0][0].callback_data).toBe(`team:approve:${requestId}`);

    // Повторная заявка — та же, не новая.
    stubTelegram();
    const again = await founder.post("/api/v1/team-requests").send({ name: "Дневной Дозор" }).expect(200);
    expect(again.body.request.id).toBe(requestId);

    // Список для консоли трека 3 — только владельцу.
    await founder.get("/api/v1/team-requests?status=pending").expect(403);
    const owner = await login("owner");
    const pending = await owner.get("/api/v1/team-requests?status=pending").expect(200);
    expect(pending.body.requests.some((r: any) => r.id === requestId)).toBe(true);

    // Нажать «Принять» может только владелец.
    stubTelegram();
    await pressButton("founder", `team:approve:${requestId}`).expect(200);
    expect(botCalls.find((c) => c.method === "answerCallbackQuery")!.payload.text).toBe(
      "Решать заявки на команды может только владелец платформы"
    );

    stubTelegram();
    await pressButton("owner", `team:approve:${requestId}`).expect(200);
    const view = await founder.get("/api/v1/team-requests/mine").expect(200);
    const decided = view.body.requests.find((r: any) => r.id === requestId);
    expect(decided.status).toBe("APPROVED");
    expect(decided.team.shortCode).toMatch(/^DD\d*$/);
    f.createdTeams.push(decided.team.id);

    const captain = await pool.query<{ role: string }>(
      `SELECT role::text FROM team_memberships WHERE team_id = $1 AND user_id = $2`,
      [decided.team.id, f.users.founder]
    );
    expect(captain.rows[0].role).toBe("CAPTAIN");
    const link = await pool.query(`SELECT 1 FROM team_join_links WHERE team_id = $1 AND revoked_at IS NULL`, [decided.team.id]);
    expect(link.rowCount).toBe(1);
    const founderNote = sentTo("sendMessage", TG.founder);
    expect(founderNote).toHaveLength(1);
    expect(founderNote[0].payload.text).toContain("создана");
    expect(founderNote[0].payload.reply_markup.inline_keyboard[0][0]).toEqual({
      text: "Открыть команду",
      url: `https://staging.pbthub.ru/t/${String(decided.team.shortCode).toLowerCase()}`,
    });
    expect(botCalls.filter((c) => c.method === "editMessageText")).toHaveLength(1);

    const home = await founder.get("/api/v1/init").expect(200);
    expect(home.body.team.id).toBe(decided.team.id);
  });

  it("отклонение владельцем из консоли", async () => {
    const intruder = await login("intruder");
    stubTelegram();
    const created = await intruder.post("/api/v1/team-requests").send({ name: "Лишняя" }).expect(201);
    const owner = await login("owner");
    stubTelegram();
    const res = await owner.post(`/api/v1/team-requests/${created.body.request.id}/decline`).send({}).expect(200);
    expect(res.body.request.status).toBe("DECLINED");
    const notice = sentTo("sendMessage", TG.intruder);
    expect(notice).toHaveLength(1);
    expect(notice[0].payload.text).toBe("Заявку на команду «Лишняя» отклонили.");
    expect(notice[0].payload.text).not.toContain("Трек1");
    await owner.post(`/api/v1/team-requests/${created.body.request.id}/approve`).send({}).expect(409);
  });
});
