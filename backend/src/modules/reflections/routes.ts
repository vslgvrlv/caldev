import { Router } from "express";
import { z } from "zod";
import { pool, query } from "../../db/pool.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import { writeAudit } from "../../lib/audit.js";
import { sendError } from "../../lib/http-error.js";
import { compareDeltaOtb, computeDeltaOtb, type ReflectionPhase } from "../../lib/reflection-analytics.js";

// Рефлексия по гейму (#89). Единица — гейм `event_games`; в спеке он же «пойнт».
// Спека: vault 02_PROJECTS/Paintball TeamHub/06_specs/
//        player_reflection_analytics_v1_2026_07_12_telegram.md

export const reflectionsRouter = Router();

const phaseSchema = z.enum(["BREAK", "COVER", "ROTATION"]);

const killSchema = z.object({
  // Фаза килла обязательна (§1.2): без неё не считается delta_otb.
  phase: phaseSchema,
  positionId: z.string().max(64).nullable().optional(),
});

const reflectionSchema = z
  .object({
    eliminated: z.boolean(),
    deathPhase: phaseSchema.nullable().optional(),
    deathPositionId: z.string().max(64).nullable().optional(),
    kills: z.array(killSchema).max(20).default([]),
    note: z.string().trim().max(2000).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.eliminated && !value.deathPhase) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["deathPhase"], message: "deathPhase is required when eliminated" });
    }
    if (!value.eliminated && (value.deathPhase || value.deathPositionId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["deathPhase"], message: "deathPhase must be empty when survived" });
    }
  });

const captainReportSchema = z.object({
  combination: z.enum(["ENVELOPE_ATTACK", "SNAKE_ATTACK", "ACTIVE_SNAKE", "ACTIVE_ENVELOPE"]).nullable().optional(),
  breakWidth: z.enum(["NARROW", "WIDE"]).nullable().optional(),
  opponentBreakWidth: z.enum(["NARROW", "WIDE"]).nullable().optional(),
  initiativeSnake: z.number().int().min(-1).max(1).nullable().optional(),
  initiativeCenter: z.number().int().min(-1).max(1).nullable().optional(),
  initiativeEnvelope: z.number().int().min(-1).max(1).nullable().optional(),
  deltaOtb: z.number().int().min(-10).max(10).nullable().optional(),
  result: z.enum(["WIN", "LOSS"]).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});

type GameAccess = { gameId: string; eventId: string; teamId: string; role: "CAPTAIN" | "TRAINER" | "PLAYER" };

// Доступ к рефлексии = членство в команде, которой принадлежит событие гейма.
// Роль возвращаем здесь же: капитанская форма её требует.
async function loadGameAccess(gameId: string, userId: string): Promise<GameAccess | null> {
  const result = await query<{ game_id: string; event_id: string; team_id: string; role: GameAccess["role"] }>(
    `SELECT g.id AS game_id, e.id AS event_id, e.team_id, tm.role
     FROM event_games g
     JOIN events e ON e.id = g.event_id
     JOIN team_memberships tm ON tm.team_id = e.team_id AND tm.user_id = $2
     WHERE g.id = $1 AND e.is_cancelled = FALSE`,
    [gameId, userId]
  );
  const row = result.rows[0];
  return row ? { gameId: row.game_id, eventId: row.event_id, teamId: row.team_id, role: row.role } : null;
}

type ReflectionRow = {
  id: string;
  user_id: string;
  eliminated: boolean;
  death_phase: string | null;
  death_position_id: string | null;
  note: string | null;
  updated_at: string;
};

type KillRow = { reflection_id: string; ordinal: number; phase: string; position_id: string | null };

function serializeReflection(row: ReflectionRow, kills: KillRow[]) {
  return {
    id: row.id,
    userId: row.user_id,
    eliminated: row.eliminated,
    deathPhase: row.death_phase,
    deathPositionId: row.death_position_id,
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

// Своя форма за гейм. Пусто — игрок ещё не заполнял.
reflectionsRouter.get(
  "/games/:gameId/mine",
  requireAuth,
  asyncHandler(async (req, res) => {
    const gameId = z.string().uuid().parse(req.params.gameId);
    const userId = req.authUser!.id;

    const access = await loadGameAccess(gameId, userId);
    if (!access) {
      return sendError(req, res, 404, "GAME_NOT_FOUND", "Game not found or not available for this user");
    }

    const result = await query<ReflectionRow>(
      `SELECT id, user_id, eliminated, death_phase, death_position_id, note, updated_at
       FROM game_reflections
       WHERE game_id = $1 AND user_id = $2`,
      [gameId, userId]
    );
    const row = result.rows[0];
    if (!row) {
      return res.json({ reflection: null });
    }

    return res.json({ reflection: serializeReflection(row, await loadKills([row.id])) });
  })
);

// Сохранение формы игрока. Идемпотентно: переоткрыл форму — перезаписал ответ,
// киллы заменяются целиком (их порядок в форме и есть ordinal).
reflectionsRouter.put(
  "/games/:gameId/mine",
  requireAuth,
  asyncHandler(async (req, res) => {
    const gameId = z.string().uuid().parse(req.params.gameId);
    const payload = reflectionSchema.parse(req.body);
    const userId = req.authUser!.id;

    const access = await loadGameAccess(gameId, userId);
    if (!access) {
      return sendError(req, res, 404, "GAME_NOT_FOUND", "Game not found or not available for this user");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const saved = await client.query<{ id: string }>(
        `INSERT INTO game_reflections (game_id, user_id, eliminated, death_phase, death_position_id, note)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (game_id, user_id) DO UPDATE
           SET eliminated        = EXCLUDED.eliminated,
               death_phase       = EXCLUDED.death_phase,
               death_position_id = EXCLUDED.death_position_id,
               note              = EXCLUDED.note,
               updated_at        = NOW()
         RETURNING id`,
        [
          gameId,
          userId,
          payload.eliminated,
          payload.eliminated ? payload.deathPhase! : null,
          payload.eliminated ? payload.deathPositionId ?? null : null,
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
      gameId,
      eliminated: payload.eliminated,
      kills: payload.kills.length,
    });

    return res.json({ success: true, gameId });
  })
);

// Капитанский отчёт по гейму. Читать может вся команда — на нём строится
// сравнение «капитан сказал X, игроки показали Y».
reflectionsRouter.get(
  "/games/:gameId/captain",
  requireAuth,
  asyncHandler(async (req, res) => {
    const gameId = z.string().uuid().parse(req.params.gameId);
    const access = await loadGameAccess(gameId, req.authUser!.id);
    if (!access) {
      return sendError(req, res, 404, "GAME_NOT_FOUND", "Game not found or not available for this user");
    }

    const report = await loadCaptainReport(gameId);
    return res.json({ report, canEdit: access.role === "CAPTAIN" || access.role === "TRAINER" });
  })
);

reflectionsRouter.put(
  "/games/:gameId/captain",
  requireAuth,
  asyncHandler(async (req, res) => {
    const gameId = z.string().uuid().parse(req.params.gameId);
    const payload = captainReportSchema.parse(req.body);
    const userId = req.authUser!.id;

    const access = await loadGameAccess(gameId, userId);
    if (!access) {
      return sendError(req, res, 404, "GAME_NOT_FOUND", "Game not found or not available for this user");
    }
    if (access.role !== "CAPTAIN" && access.role !== "TRAINER") {
      return sendError(req, res, 403, "ROLE_REQUIRED", "Captain report is editable by captain or trainer only");
    }

    await query(
      `INSERT INTO game_captain_reports (
         game_id, author_user_id, combination, break_width, opponent_break_width,
         initiative_snake, initiative_center, initiative_envelope, delta_otb, result, note
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (game_id) DO UPDATE
         SET author_user_id       = EXCLUDED.author_user_id,
             combination          = EXCLUDED.combination,
             break_width          = EXCLUDED.break_width,
             opponent_break_width = EXCLUDED.opponent_break_width,
             initiative_snake     = EXCLUDED.initiative_snake,
             initiative_center    = EXCLUDED.initiative_center,
             initiative_envelope  = EXCLUDED.initiative_envelope,
             delta_otb            = EXCLUDED.delta_otb,
             result               = EXCLUDED.result,
             note                 = EXCLUDED.note,
             updated_at           = NOW()`,
      [
        gameId,
        userId,
        payload.combination ?? null,
        payload.breakWidth ?? null,
        payload.opponentBreakWidth ?? null,
        payload.initiativeSnake ?? null,
        payload.initiativeCenter ?? null,
        payload.initiativeEnvelope ?? null,
        payload.deltaOtb ?? null,
        payload.result ?? null,
        payload.note?.length ? payload.note : null,
      ]
    );

    await writeAudit(userId, "reflection.captain_report", { gameId, result: payload.result ?? null });

    return res.json({ success: true, gameId });
  })
);

async function loadCaptainReport(gameId: string) {
  const result = await query<{
    author_user_id: string;
    combination: string | null;
    break_width: string | null;
    opponent_break_width: string | null;
    initiative_snake: number | null;
    initiative_center: number | null;
    initiative_envelope: number | null;
    delta_otb: number | null;
    result: string | null;
    note: string | null;
    updated_at: string;
  }>(
    `SELECT author_user_id, combination, break_width, opponent_break_width,
            initiative_snake, initiative_center, initiative_envelope,
            delta_otb, result, note, updated_at
     FROM game_captain_reports
     WHERE game_id = $1`,
    [gameId]
  );
  const row = result.rows[0];
  if (!row) return null;
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
    result: row.result,
    note: row.note,
    updatedAt: row.updated_at,
  };
}

// Сводка по гейму: расчётная дельта разбежки + расхождение с капитаном (§2.1, §6).
reflectionsRouter.get(
  "/games/:gameId/summary",
  requireAuth,
  asyncHandler(async (req, res) => {
    const gameId = z.string().uuid().parse(req.params.gameId);
    const access = await loadGameAccess(gameId, req.authUser!.id);
    if (!access) {
      return sendError(req, res, 404, "GAME_NOT_FOUND", "Game not found or not available for this user");
    }

    const reflections = await query<ReflectionRow>(
      `SELECT id, user_id, eliminated, death_phase, death_position_id, note, updated_at
       FROM game_reflections
       WHERE game_id = $1`,
      [gameId]
    );
    const kills = await loadKills(reflections.rows.map((r) => r.id));

    const { ourOtbLosses, opponentOtbLosses, deltaOtb } = computeDeltaOtb({
      reflections: reflections.rows.map((r) => ({
        eliminated: r.eliminated,
        deathPhase: r.death_phase as ReflectionPhase | null,
      })),
      kills: kills.map((k) => ({ phase: k.phase as ReflectionPhase })),
    });

    const report = await loadCaptainReport(gameId);
    const deltaOtbMismatch = compareDeltaOtb(deltaOtb, report?.deltaOtb);

    return res.json({
      gameId,
      submitted: reflections.rows.length,
      ourOtbLosses,
      opponentOtbLosses,
      deltaOtb,
      totalKills: kills.length,
      captainReport: report,
      deltaOtbMismatch,
      reflections: reflections.rows.map((row) => serializeReflection(row, kills)),
    });
  })
);
