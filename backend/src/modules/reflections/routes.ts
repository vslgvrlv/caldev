import { Router } from "express";
import { z } from "zod";
import { pool, query } from "../../db/pool.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import { writeAudit } from "../../lib/audit.js";
import { sendError } from "../../lib/http-error.js";
import { compareDeltaOtb, computeDeltaOtb, type ReflectionPhase } from "../../lib/reflection-analytics.js";
import { checkPointResults, parseScore } from "../../lib/game-points.js";
import { renderSummaryCsv, renderTableCsv } from "../../lib/reflection-csv.js";
import { buildEventSummary } from "../../lib/reflection-summary.js";
import { sendTelegramBotDocument } from "../../lib/telegram-bot.js";

// Рефлексия (#89). Единица — ПОЙНТ, а не гейм: гейм со счётом 4:3 состоит из
// семи пойнтов, и форма заполняется за каждый (исправление модели 2026-07-31,
// см. миграцию 031).
// Спека: vault 02_PROJECTS/Paintball TeamHub/06_specs/
//        player_reflection_analytics_v1_2026_07_12_telegram.md

export const reflectionsRouter = Router();

const phaseSchema = z.enum(["BREAK", "COVER", "ROTATION"]);

const killSchema = z.object({
  // Фаза килла обязательна (§1.2): без неё не считается delta_otb.
  phase: phaseSchema,
  positionId: z.string().max(64).nullable().optional(),
});

// Три исхода пойнта вместо булева «выбили/дожил» (#104): штрафной вывод — не
// смерть, и подмешивать его в статистику отстрела нельзя. penalty_kind —
// независимая ось: чей штраф на игроке.
const exitReasonSchema = z.enum(["SURVIVED", "HIT", "PENALTY"]);
const penaltyKindSchema = z.enum(["OWN", "TEAMMATE"]);

const reflectionSchema = z
  .object({
    exitReason: exitReasonSchema,
    penaltyKind: penaltyKindSchema.nullable().optional(),
    exitPhase: phaseSchema.nullable().optional(),
    exitPositionId: z.string().max(64).nullable().optional(),
    kills: z.array(killSchema).max(20).default([]),
    // Самооценка 1–5 (§8.3). Необязательна: экран пропускаемый, NULL = «не оценил».
    selfRating: z.number().int().min(1).max(5).nullable().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.exitReason !== "SURVIVED" && !value.exitPhase) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["exitPhase"], message: "exitPhase is required when player left the field" });
    }
    if (value.exitReason === "SURVIVED" && (value.exitPhase || value.exitPositionId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["exitPhase"], message: "exitPhase must be empty when survived" });
    }
    // «Сняли по штрафу, а чей штраф — не знаю» не принимаем: без этого нельзя
    // отличить нарушителя от снятого в довесок по 2-за-1.
    if (value.exitReason === "PENALTY" && !value.penaltyKind) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["penaltyKind"], message: "penaltyKind is required for penalty exit" });
    }
  });

// Результата пойнта здесь нет: он объективен и живёт в game_points.
const captainReportSchema = z.object({
  combination: z.enum(["ENVELOPE_ATTACK", "SNAKE_ATTACK", "ACTIVE_SNAKE", "ACTIVE_ENVELOPE"]).nullable().optional(),
  breakWidth: z.enum(["NARROW", "WIDE"]).nullable().optional(),
  opponentBreakWidth: z.enum(["NARROW", "WIDE"]).nullable().optional(),
  initiativeSnake: z.number().int().min(-1).max(1).nullable().optional(),
  initiativeCenter: z.number().int().min(-1).max(1).nullable().optional(),
  initiativeEnvelope: z.number().int().min(-1).max(1).nullable().optional(),
  deltaOtb: z.number().int().min(-10).max(10).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});

const pointResultsSchema = z.object({
  points: z
    .array(
      z.object({
        ordinal: z.number().int().min(1).max(30),
        result: z.enum(["WIN", "LOSS"]).nullable(),
      })
    )
    .max(30),
});

type Role = "CAPTAIN" | "TRAINER" | "PLAYER";
type GameAccess = { gameId: string; eventId: string; teamId: string; role: Role; score: string | null };
type PointAccess = GameAccess & { pointId: string; ordinal: number; result: "WIN" | "LOSS" | null };

const canEditTeamData = (role: Role) => role === "CAPTAIN" || role === "TRAINER";

// Доступ = членство в команде, которой принадлежит событие. Роль возвращаем
// здесь же: от неё зависит право размечать пойнты и вести капитанский разбор.
async function loadGameAccess(gameId: string, userId: string): Promise<GameAccess | null> {
  const result = await query<{ event_id: string; team_id: string; role: Role; score: string | null }>(
    `SELECT e.id AS event_id, e.team_id, tm.role, g.score
     FROM event_games g
     JOIN events e ON e.id = g.event_id
     JOIN team_memberships tm ON tm.team_id = e.team_id AND tm.user_id = $2
     WHERE g.id = $1 AND e.is_cancelled = FALSE`,
    [gameId, userId]
  );
  const row = result.rows[0];
  return row ? { gameId, eventId: row.event_id, teamId: row.team_id, role: row.role, score: row.score } : null;
}

async function loadPointAccess(pointId: string, userId: string): Promise<PointAccess | null> {
  const result = await query<{
    game_id: string;
    ordinal: number;
    result: "WIN" | "LOSS" | null;
    event_id: string;
    team_id: string;
    role: Role;
    score: string | null;
  }>(
    `SELECT p.game_id, p.ordinal, p.result, e.id AS event_id, e.team_id, tm.role, g.score
     FROM game_points p
     JOIN event_games g ON g.id = p.game_id
     JOIN events e ON e.id = g.event_id
     JOIN team_memberships tm ON tm.team_id = e.team_id AND tm.user_id = $2
     WHERE p.id = $1 AND e.is_cancelled = FALSE`,
    [pointId, userId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    pointId,
    ordinal: row.ordinal,
    result: row.result,
    gameId: row.game_id,
    eventId: row.event_id,
    teamId: row.team_id,
    role: row.role,
    score: row.score,
  };
}

type PointRow = {
  id: string;
  ordinal: number;
  result: "WIN" | "LOSS" | null;
  opponent_roster_size: number | null;
};

const POINT_COLUMNS = `id, ordinal, result, opponent_roster_size`;

// Кто выходил на пойнт (#102). Пустой массив = состав не записан; это не
// «никто не выходил», а «не знаем», и вся логика выше обязана деградировать
// в старое поведение «пойнт доступен всем».
async function loadRosters(pointIds: string[]): Promise<Map<string, string[]>> {
  const byPoint = new Map<string, string[]>();
  if (!pointIds.length) return byPoint;
  const rows = await query<{ point_id: string; user_id: string }>(
    `SELECT point_id, user_id FROM game_point_roster WHERE point_id = ANY($1::uuid[])`,
    [pointIds]
  );
  for (const row of rows.rows) {
    const list = byPoint.get(row.point_id);
    if (list) list.push(row.user_id);
    else byPoint.set(row.point_id, [row.user_id]);
  }
  return byPoint;
}

// Пойнты — производная от счёта, поэтому материализуются лениво: как только у
// гейма появился разборчивый счёт, строки создаются под него. Отдельной кнопки
// «создать пойнты» нет — она была бы ручной синхронизацией того, что и так
// однозначно следует из счёта.
async function ensurePoints(gameId: string, score: string | null): Promise<PointRow[]> {
  const parsed = parseScore(score);
  const existing = await query<PointRow>(
    `SELECT ${POINT_COLUMNS} FROM game_points WHERE game_id = $1 ORDER BY ordinal`,
    [gameId]
  );
  if (!parsed) return existing.rows;
  if (existing.rows.length >= parsed.total) return existing.rows;

  // Счёт исправили в большую сторону — дописываем недостающие пойнты.
  // Лишние не удаляем: за ними могут стоять заполненные формы, и молча
  // потерять их хуже, чем показать лишнюю строку.
  const missing: number[] = [];
  for (let ordinal = existing.rows.length + 1; ordinal <= parsed.total; ordinal += 1) missing.push(ordinal);

  await query(
    `INSERT INTO game_points (game_id, ordinal)
     SELECT $1, ordinal FROM unnest($2::smallint[]) AS ordinal
     ON CONFLICT (game_id, ordinal) DO NOTHING`,
    [gameId, missing]
  );

  const refreshed = await query<PointRow>(
    `SELECT ${POINT_COLUMNS} FROM game_points WHERE game_id = $1 ORDER BY ordinal`,
    [gameId]
  );
  return refreshed.rows;
}

// Список пойнтов гейма с прогрессом заполнения — экран выбора «за какой пойнт
// заполняю». Без него игрок отвечал бы за весь матч сразу.
reflectionsRouter.get(
  "/games/:gameId/points",
  requireAuth,
  asyncHandler(async (req, res) => {
    const gameId = z.string().uuid().parse(req.params.gameId);
    const userId = req.authUser!.id;

    const access = await loadGameAccess(gameId, userId);
    if (!access) {
      return sendError(req, res, 404, "GAME_NOT_FOUND", "Game not found or not available for this user");
    }

    const points = await ensurePoints(gameId, access.score);
    const parsed = parseScore(access.score);

    const stats = await query<{ point_id: string; filled: string; mine: string }>(
      `SELECT point_id, COUNT(*)::text AS filled, COUNT(*) FILTER (WHERE user_id = $2)::text AS mine
       FROM game_reflections
       WHERE point_id = ANY($1::uuid[])
       GROUP BY point_id`,
      [points.map((p) => p.id), userId]
    );
    const captains = await query<{ point_id: string }>(
      `SELECT point_id FROM game_captain_reports WHERE point_id = ANY($1::uuid[])`,
      [points.map((p) => p.id)]
    );
    const statsByPoint = new Map(stats.rows.map((r) => [r.point_id, r]));
    const captainByPoint = new Set(captains.rows.map((r) => r.point_id));
    const rosterByPoint = await loadRosters(points.map((p) => p.id));

    return res.json({
      gameId,
      score: access.score,
      canMarkResults: canEditTeamData(access.role),
      canEditRoster: canEditTeamData(access.role),
      candidates: await loadRosterCandidates(access.eventId, access.teamId),
      expected: parsed ? { wins: parsed.our, losses: parsed.opponent, total: parsed.total } : null,
      resultsMatchScore: parsed ? checkPointResults(parsed, points.map((p) => p.result)).matchesScore : null,
      points: points.map((point) => {
        const roster = rosterByPoint.get(point.id) ?? [];
        return {
          id: point.id,
          ordinal: point.ordinal,
          result: point.result,
          filledCount: Number(statsByPoint.get(point.id)?.filled ?? 0),
          mineFilled: Number(statsByPoint.get(point.id)?.mine ?? 0) > 0,
          captainFilled: captainByPoint.has(point.id),
          roster,
          opponentRosterSize: point.opponent_roster_size,
          // Состав не записан → игрок считается вышедшим. Иначе старые события,
          // где ростера нет и не будет, схлопнулись бы в «никто не играл».
          mineInRoster: roster.length === 0 || roster.includes(userId),
        };
      }),
    });
  })
);

// Кандидаты в состав пойнта — состав команды с отметкой явки на событие.
// Явка нужна, чтобы предзаполнить первый пойнт: те, кто не приехал, в него
// попасть не могут.
async function loadRosterCandidates(eventId: string, teamId: string) {
  const rows = await query<{ user_id: string; name: string; nickname: string; present: boolean | null }>(
    `SELECT u.id AS user_id, u.name, u.nickname, a.present
     FROM team_memberships tm
     JOIN users u ON u.id = tm.user_id
     LEFT JOIN event_attendance a ON a.event_id = $1 AND a.user_id = u.id
     WHERE tm.team_id = $2
     ORDER BY u.nickname`,
    [eventId, teamId]
  );
  return rows.rows.map((r) => ({
    userId: r.user_id,
    name: r.name,
    nickname: r.nickname,
    present: r.present ?? null,
  }));
}

const rosterSchema = z.object({
  userIds: z.array(z.string().uuid()).max(20),
  opponentRosterSize: z.number().int().min(0).max(10).nullable().optional(),
});

// Состав пойнта пишется целиком: капитан видит пятерых на экране и сохраняет
// то, что видит. Дифф «добавили/убрали» с этим жестом не совпал бы.
reflectionsRouter.put(
  "/points/:pointId/roster",
  requireAuth,
  asyncHandler(async (req, res) => {
    const pointId = z.string().uuid().parse(req.params.pointId);
    const payload = rosterSchema.parse(req.body);
    const userId = req.authUser!.id;

    const access = await loadPointAccess(pointId, userId);
    if (!access) {
      return sendError(req, res, 404, "GAME_NOT_FOUND", "Point not found or not available for this user");
    }
    if (!canEditTeamData(access.role)) {
      return sendError(req, res, 403, "ROLE_REQUIRED", "Point roster is editable by captain or trainer only");
    }

    // Чужие в состав не попадают: ростер — это наши пятеро, а не произвольные
    // user_id из тела запроса.
    const unique = [...new Set(payload.userIds)];
    if (unique.length) {
      const members = await query<{ user_id: string }>(
        `SELECT user_id FROM team_memberships WHERE team_id = $1 AND user_id = ANY($2::uuid[])`,
        [access.teamId, unique]
      );
      if (members.rows.length !== unique.length) {
        return sendError(req, res, 400, "NOT_TEAM_MEMBER", "Roster contains users outside the team");
      }
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM game_point_roster WHERE point_id = $1`, [pointId]);
      if (unique.length) {
        await client.query(
          `INSERT INTO game_point_roster (point_id, user_id)
           SELECT $1, user_id FROM unnest($2::uuid[]) AS user_id`,
          [pointId, unique]
        );
      }
      if (payload.opponentRosterSize !== undefined) {
        await client.query(
          `UPDATE game_points SET opponent_roster_size = $2, updated_at = NOW() WHERE id = $1`,
          [pointId, payload.opponentRosterSize]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    await writeAudit(userId, "reflection.point_roster", { pointId, gameId: access.gameId, size: unique.length });

    return res.json({ success: true, pointId, roster: unique, opponentRosterSize: payload.opponentRosterSize ?? null });
  })
);

// Разметка «какие пойнты выиграли». Из счёта известно только количество побед,
// а не их порядок, поэтому это ручной шаг капитана.
reflectionsRouter.put(
  "/games/:gameId/points",
  requireAuth,
  asyncHandler(async (req, res) => {
    const gameId = z.string().uuid().parse(req.params.gameId);
    const payload = pointResultsSchema.parse(req.body);
    const userId = req.authUser!.id;

    const access = await loadGameAccess(gameId, userId);
    if (!access) {
      return sendError(req, res, 404, "GAME_NOT_FOUND", "Game not found or not available for this user");
    }
    if (!canEditTeamData(access.role)) {
      return sendError(req, res, 403, "ROLE_REQUIRED", "Point results are editable by captain or trainer only");
    }

    await ensurePoints(gameId, access.score);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const point of payload.points) {
        await client.query(
          `UPDATE game_points SET result = $3, updated_at = NOW() WHERE game_id = $1 AND ordinal = $2`,
          [gameId, point.ordinal, point.result]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    await writeAudit(userId, "reflection.point_results", { gameId, points: payload.points.length });

    const points = await query<PointRow>(
      `SELECT ${POINT_COLUMNS} FROM game_points WHERE game_id = $1 ORDER BY ordinal`,
      [gameId]
    );
    return res.json({ success: true, points: points.rows });
  })
);

type ReflectionRow = {
  id: string;
  user_id: string;
  exit_reason: "SURVIVED" | "HIT" | "PENALTY";
  penalty_kind: "OWN" | "TEAMMATE" | null;
  exit_phase: string | null;
  exit_position_id: string | null;
  self_rating: number | null;
  note: string | null;
  updated_at: string;
};

type KillRow = { reflection_id: string; ordinal: number; phase: string; position_id: string | null };

function serializeReflection(row: ReflectionRow, kills: KillRow[]) {
  return {
    id: row.id,
    userId: row.user_id,
    exitReason: row.exit_reason,
    penaltyKind: row.penalty_kind,
    exitPhase: row.exit_phase,
    exitPositionId: row.exit_position_id,
    selfRating: row.self_rating,
    note: row.note,
    updatedAt: row.updated_at,
    kills: kills
      .filter((k) => k.reflection_id === row.id)
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((k) => ({ phase: k.phase, positionId: k.position_id })),
  };
}

async function loadKills(reflectionIds: string[]): Promise<KillRow[]> {
  if (!reflectionIds.length) return [];
  const result = await query<KillRow>(
    `SELECT reflection_id, ordinal, phase, position_id
     FROM game_reflection_kills
     WHERE reflection_id = ANY($1::uuid[])`,
    [reflectionIds]
  );
  return result.rows;
}

const REFLECTION_COLUMNS = `id, user_id, exit_reason, penalty_kind, exit_phase, exit_position_id, self_rating, note, updated_at`;

// Своя форма за пойнт. Пусто — игрок ещё не заполнял.
reflectionsRouter.get(
  "/points/:pointId/mine",
  requireAuth,
  asyncHandler(async (req, res) => {
    const pointId = z.string().uuid().parse(req.params.pointId);
    const userId = req.authUser!.id;

    const access = await loadPointAccess(pointId, userId);
    if (!access) {
      return sendError(req, res, 404, "GAME_NOT_FOUND", "Point not found or not available for this user");
    }

    const result = await query<ReflectionRow>(
      `SELECT ${REFLECTION_COLUMNS} FROM game_reflections WHERE point_id = $1 AND user_id = $2`,
      [pointId, userId]
    );
    const row = result.rows[0];
    if (!row) {
      return res.json({ reflection: null, point: { id: pointId, ordinal: access.ordinal, result: access.result } });
    }

    return res.json({
      reflection: serializeReflection(row, await loadKills([row.id])),
      point: { id: pointId, ordinal: access.ordinal, result: access.result },
    });
  })
);

// Сохранение формы игрока. Идемпотентно: переоткрыл форму — перезаписал ответ,
// киллы заменяются целиком (их порядок в форме и есть ordinal).
reflectionsRouter.put(
  "/points/:pointId/mine",
  requireAuth,
  asyncHandler(async (req, res) => {
    const pointId = z.string().uuid().parse(req.params.pointId);
    const payload = reflectionSchema.parse(req.body);
    const userId = req.authUser!.id;

    const access = await loadPointAccess(pointId, userId);
    if (!access) {
      return sendError(req, res, 404, "GAME_NOT_FOUND", "Point not found or not available for this user");
    }

    // Записанный состав закрывает форму тем, кто на пойнт не выходил (#102).
    // Пустой состав ничего не запрещает — старые события им не сломать.
    // Уже заполненную форму не блокируем: она могла появиться до ростера, и
    // отобрать право её исправить — потерять данные из-за опечатки капитана.
    const roster = (await loadRosters([pointId])).get(pointId) ?? [];
    if (roster.length && !roster.includes(userId)) {
      const existing = await query<{ id: string }>(
        `SELECT id FROM game_reflections WHERE point_id = $1 AND user_id = $2`,
        [pointId, userId]
      );
      if (!existing.rows.length) {
        return sendError(req, res, 409, "NOT_IN_POINT_ROSTER", "You are not in the roster of this point");
      }
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const leftField = payload.exitReason !== "SURVIVED";
      const saved = await client.query<{ id: string }>(
        `INSERT INTO game_reflections (point_id, user_id, exit_reason, penalty_kind, exit_phase, exit_position_id, self_rating, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (point_id, user_id) DO UPDATE
           SET exit_reason      = EXCLUDED.exit_reason,
               penalty_kind     = EXCLUDED.penalty_kind,
               exit_phase       = EXCLUDED.exit_phase,
               exit_position_id = EXCLUDED.exit_position_id,
               self_rating      = EXCLUDED.self_rating,
               note             = EXCLUDED.note,
               updated_at       = NOW()
         RETURNING id`,
        [
          pointId,
          userId,
          payload.exitReason,
          payload.penaltyKind ?? null,
          leftField ? payload.exitPhase! : null,
          leftField ? payload.exitPositionId ?? null : null,
          payload.selfRating ?? null,
          payload.note?.length ? payload.note : null,
        ]
      );
      const reflectionId = saved.rows[0].id;

      await client.query(`DELETE FROM game_reflection_kills WHERE reflection_id = $1`, [reflectionId]);
      for (const [index, kill] of payload.kills.entries()) {
        await client.query(
          `INSERT INTO game_reflection_kills (reflection_id, ordinal, phase, position_id)
           VALUES ($1, $2, $3, $4)`,
          [reflectionId, index + 1, kill.phase, kill.positionId ?? null]
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    await writeAudit(userId, "reflection.submit", {
      pointId,
      gameId: access.gameId,
      exitReason: payload.exitReason,
      kills: payload.kills.length,
    });

    return res.json({ success: true, pointId });
  })
);

// Капитанский разбор пойнта. Читать может вся команда — на нём строится
// сравнение «капитан сказал X, игроки показали Y».
reflectionsRouter.get(
  "/points/:pointId/captain",
  requireAuth,
  asyncHandler(async (req, res) => {
    const pointId = z.string().uuid().parse(req.params.pointId);
    const access = await loadPointAccess(pointId, req.authUser!.id);
    if (!access) {
      return sendError(req, res, 404, "GAME_NOT_FOUND", "Point not found or not available for this user");
    }

    const report = await loadCaptainReport(pointId);
    return res.json({
      report,
      canEdit: canEditTeamData(access.role),
      point: { id: pointId, ordinal: access.ordinal, result: access.result },
    });
  })
);

reflectionsRouter.put(
  "/points/:pointId/captain",
  requireAuth,
  asyncHandler(async (req, res) => {
    const pointId = z.string().uuid().parse(req.params.pointId);
    const payload = captainReportSchema.parse(req.body);
    const userId = req.authUser!.id;

    const access = await loadPointAccess(pointId, userId);
    if (!access) {
      return sendError(req, res, 404, "GAME_NOT_FOUND", "Point not found or not available for this user");
    }
    if (!canEditTeamData(access.role)) {
      return sendError(req, res, 403, "ROLE_REQUIRED", "Captain report is editable by captain or trainer only");
    }

    await query(
      `INSERT INTO game_captain_reports (
         point_id, author_user_id, combination, break_width, opponent_break_width,
         initiative_snake, initiative_center, initiative_envelope, delta_otb, note
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (point_id) DO UPDATE
         SET author_user_id       = EXCLUDED.author_user_id,
             combination          = EXCLUDED.combination,
             break_width          = EXCLUDED.break_width,
             opponent_break_width = EXCLUDED.opponent_break_width,
             initiative_snake     = EXCLUDED.initiative_snake,
             initiative_center    = EXCLUDED.initiative_center,
             initiative_envelope  = EXCLUDED.initiative_envelope,
             delta_otb            = EXCLUDED.delta_otb,
             note                 = EXCLUDED.note,
             updated_at           = NOW()`,
      [
        pointId,
        userId,
        payload.combination ?? null,
        payload.breakWidth ?? null,
        payload.opponentBreakWidth ?? null,
        payload.initiativeSnake ?? null,
        payload.initiativeCenter ?? null,
        payload.initiativeEnvelope ?? null,
        payload.deltaOtb ?? null,
        payload.note?.length ? payload.note : null,
      ]
    );

    await writeAudit(userId, "reflection.captain_report", { pointId, gameId: access.gameId });

    return res.json({ success: true, pointId });
  })
);

type CaptainReportRow = {
  point_id: string;
  author_user_id: string;
  combination: string | null;
  break_width: string | null;
  opponent_break_width: string | null;
  initiative_snake: number | null;
  initiative_center: number | null;
  initiative_envelope: number | null;
  delta_otb: number | null;
  note: string | null;
  updated_at: string;
};

const CAPTAIN_COLUMNS = `point_id, author_user_id, combination, break_width, opponent_break_width,
                         initiative_snake, initiative_center, initiative_envelope, delta_otb, note, updated_at`;

function serializeCaptainReport(row: CaptainReportRow) {
  return {
    authorUserId: row.author_user_id,
    combination: row.combination,
    breakWidth: row.break_width,
    opponentBreakWidth: row.opponent_break_width,
    initiative: {
      snake: row.initiative_snake,
      center: row.initiative_center,
      envelope: row.initiative_envelope,
    },
    deltaOtb: row.delta_otb,
    note: row.note,
    updatedAt: row.updated_at,
  };
}

async function loadCaptainReport(pointId: string) {
  const result = await query<CaptainReportRow>(
    `SELECT ${CAPTAIN_COLUMNS} FROM game_captain_reports WHERE point_id = $1`,
    [pointId]
  );
  const row = result.rows[0];
  return row ? serializeCaptainReport(row) : null;
}

// Сводка по пойнту: расчётная дельта разбежки + расхождение с капитаном (§2.1, §6).
reflectionsRouter.get(
  "/points/:pointId/summary",
  requireAuth,
  asyncHandler(async (req, res) => {
    const pointId = z.string().uuid().parse(req.params.pointId);
    const access = await loadPointAccess(pointId, req.authUser!.id);
    if (!access) {
      return sendError(req, res, 404, "GAME_NOT_FOUND", "Point not found or not available for this user");
    }

    const reflections = await query<ReflectionRow>(
      `SELECT ${REFLECTION_COLUMNS} FROM game_reflections WHERE point_id = $1`,
      [pointId]
    );
    const kills = await loadKills(reflections.rows.map((r) => r.id));

    const { ourOtbLosses, opponentOtbLosses, deltaOtb } = computeDeltaOtb({
      reflections: reflections.rows.map((r) => ({
        exitReason: r.exit_reason,
        exitPhase: r.exit_phase as ReflectionPhase | null,
      })),
      kills: kills.map((k) => ({ phase: k.phase as ReflectionPhase })),
    });

    const report = await loadCaptainReport(pointId);

    return res.json({
      pointId,
      ordinal: access.ordinal,
      result: access.result,
      submitted: reflections.rows.length,
      ourOtbLosses,
      opponentOtbLosses,
      deltaOtb,
      totalKills: kills.length,
      captainReport: report,
      deltaOtbMismatch: compareDeltaOtb(deltaOtb, report?.deltaOtb),
      reflections: reflections.rows.map((row) => serializeReflection(row, kills)),
    });
  })
);

// Таблица по всему событию — рабочая поверхность тренера. Отдаётся одним
// запросом: разбор идёт по турниру целиком, а не по одному пойнту, и дёргать
// эндпоинт на каждый пойнт значит собирать таблицу из десятков ответов.
reflectionsRouter.get(
  "/events/:eventId/table",
  requireAuth,
  asyncHandler(async (req, res) => {
    const eventId = z.string().uuid().parse(req.params.eventId);
    const userId = req.authUser!.id;

    const membership = await query<{ role: Role; title: string }>(
      `SELECT tm.role, e.title
       FROM events e
       JOIN team_memberships tm ON tm.team_id = e.team_id AND tm.user_id = $2
       WHERE e.id = $1`,
      [eventId, userId]
    );
    if (!membership.rows.length) {
      return sendError(req, res, 404, "EVENT_NOT_FOUND", "Event not found or not available for this user");
    }

    // Сводка едет вместе с таблицей, а не отдельным запросом: экран разбора
    // открывается сразу с ответами, а данные для них те же самые.
    const table = await buildEventTable(eventId, membership.rows[0].title);
    return res.json({ ...table, summary: buildEventSummary(table) });
  })
);

async function buildEventTable(eventId: string, eventTitle: string) {
  const games = await query<{ id: string; time_label: string; opponent: string; score: string | null }>(
    `SELECT id, time_label, opponent, score FROM event_games WHERE event_id = $1 ORDER BY time_label`,
    [eventId]
  );

  const points = await query<{ id: string; game_id: string; ordinal: number; result: "WIN" | "LOSS" | null }>(
    `SELECT p.id, p.game_id, p.ordinal, p.result
     FROM game_points p
     JOIN event_games g ON g.id = p.game_id
     WHERE g.event_id = $1
     ORDER BY p.ordinal`,
    [eventId]
  );
  const pointIds = points.rows.map((p) => p.id);

  const reflections = await query<ReflectionRow & { point_id: string; name: string; nickname: string }>(
    `SELECT r.point_id, ${REFLECTION_COLUMNS.split(", ").map((c) => `r.${c}`).join(", ")}, u.name, u.nickname
     FROM game_reflections r
     JOIN users u ON u.id = r.user_id
     WHERE r.point_id = ANY($1::uuid[])
     ORDER BY u.nickname`,
    [pointIds]
  );
  const kills = await loadKills(reflections.rows.map((r) => r.id));

  const reports = await query<CaptainReportRow>(
    `SELECT ${CAPTAIN_COLUMNS} FROM game_captain_reports WHERE point_id = ANY($1::uuid[])`,
    [pointIds]
  );
  const reportByPoint = new Map(reports.rows.map((r) => [r.point_id, r]));

  // Подписи укрытий тянем один раз: в таблице «grid.300.far» нечитаемо.
  // Заодно зону: figure_group это и есть snake / grid (центр) / envelope, и по
  // ней сводка собирает матрицу «зона × фаза» вместо 51 отдельной фигуры.
  const positions = await query<{ id: string; code: string; figure_group: string }>(
    `SELECT id, code, figure_group FROM field_positions`
  );
  const codeById = new Map(positions.rows.map((p) => [p.id, p.code]));
  const zoneById = Object.fromEntries(
    positions.rows.map((p) => [p.id, p.figure_group === "grid" ? "center" : p.figure_group])
  );

  return {
    eventId,
    eventTitle,
    positions: Object.fromEntries(codeById),
    positionZones: zoneById,
    games: games.rows.map((game) => {
      const gamePoints = points.rows.filter((p) => p.game_id === game.id);
      return {
        gameId: game.id,
        time: game.time_label,
        opponent: game.opponent,
        score: game.score,
        points: gamePoints.map((point) => {
          const pointReflections = reflections.rows.filter((r) => r.point_id === point.id);
          const { ourOtbLosses, opponentOtbLosses, deltaOtb } = computeDeltaOtb({
            reflections: pointReflections.map((r) => ({
              exitReason: r.exit_reason,
              exitPhase: r.exit_phase as ReflectionPhase | null,
            })),
            kills: kills
              .filter((k) => pointReflections.some((r) => r.id === k.reflection_id))
              .map((k) => ({ phase: k.phase as ReflectionPhase })),
          });
          const report = reportByPoint.get(point.id);
          return {
            pointId: point.id,
            ordinal: point.ordinal,
            result: point.result,
            submitted: pointReflections.length,
            ourOtbLosses,
            opponentOtbLosses,
            deltaOtb,
            captainReport: report ? serializeCaptainReport(report) : null,
            deltaOtbMismatch: compareDeltaOtb(deltaOtb, report?.delta_otb),
            reflections: pointReflections.map((row) => ({
              ...serializeReflection(row, kills),
              name: row.name,
              nickname: row.nickname,
            })),
          };
        }),
      };
    }),
  };
}

// Имя файла для человека: он ищет выгрузку среди других файлов в телефоне,
// и «reflections-8f3a-...csv» там не находится.
function csvFileName(prefix: string, eventTitle: string): string {
  const safe = eventTitle.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return `${prefix} — ${safe || "событие"}.csv`;
}

async function loadTableForUser(eventId: string, userId: string) {
  const membership = await query<{ title: string; telegram_id: string | null }>(
    `SELECT e.title, u.telegram_id
     FROM events e
     JOIN team_memberships tm ON tm.team_id = e.team_id AND tm.user_id = $2
     JOIN users u ON u.id = $2
     WHERE e.id = $1`,
    [eventId, userId]
  );
  if (!membership.rows.length) return null;

  const title = membership.rows[0].title;
  const table = await buildEventTable(eventId, title);
  // BOM: без него Excel открывает кириллицу в CP1251 и получается каша.
  return {
    title,
    telegramId: membership.rows[0].telegram_id,
    csv: `\uFEFF${renderTableCsv(table)}`,
    summaryCsv: `\uFEFF${renderSummaryCsv(buildEventSummary(table), title)}`,
  };
}

// Выгрузка той же таблицы в CSV: разбор продолжается в таблице, а не в
// приложении — «дальше с этим как-то работать» (Василий, 2026-07-31).
reflectionsRouter.get(
  "/events/:eventId/table.csv",
  requireAuth,
  asyncHandler(async (req, res) => {
    const eventId = z.string().uuid().parse(req.params.eventId);
    const loaded = await loadTableForUser(eventId, req.authUser!.id);
    if (!loaded) {
      return sendError(req, res, 404, "EVENT_NOT_FOUND", "Event not found or not available for this user");
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="reflections-${eventId}.csv"; filename*=UTF-8''${encodeURIComponent(csvFileName("Разбор", loaded.title))}`
    );
    return res.send(loaded.csv);
  })
);

// Тот же CSV, но файлом в чат. Внутри Telegram WebView скачивание открывает
// файл отдельным окном без кнопки «назад», из которого некуда вернуться
// (Василий, 2026-07-31); файл в чате такой проблемы не создаёт и остаётся
// под рукой — его можно переслать тренеру.
reflectionsRouter.post(
  "/events/:eventId/table.csv/send",
  requireAuth,
  asyncHandler(async (req, res) => {
    const eventId = z.string().uuid().parse(req.params.eventId);
    const userId = req.authUser!.id;

    const loaded = await loadTableForUser(eventId, userId);
    if (!loaded) {
      return sendError(req, res, 404, "EVENT_NOT_FOUND", "Event not found or not available for this user");
    }
    if (!loaded.telegramId) {
      return sendError(req, res, 409, "TELEGRAM_NOT_LINKED", "Telegram account is not linked");
    }

    try {
      // Сводка идёт первой и отдельным файлом: с неё начинают разбор, а
      // детальная простыня нужна только чтобы проверить конкретный пойнт.
      await sendTelegramBotDocument(loaded.telegramId, csvFileName("Сводка", loaded.title), loaded.summaryCsv, {
        caption: `Сводка разбора: ${loaded.title}`,
        mimeType: "text/csv; charset=utf-8",
      });
      await sendTelegramBotDocument(loaded.telegramId, csvFileName("Разбор", loaded.title), loaded.csv, {
        caption: "Детально по пойнтам",
        mimeType: "text/csv; charset=utf-8",
      });
    } catch (error) {
      return sendError(req, res, 502, "TELEGRAM_SEND_FAILED", (error as Error).message);
    }

    await writeAudit(userId, "reflection.table.sent", { eventId });

    return res.json({ sent: true });
  })
);
