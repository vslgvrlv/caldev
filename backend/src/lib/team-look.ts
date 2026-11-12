import { z } from "zod";
import { query } from "../db/pool.js";

// Оформление команды: краска, фигура знака и буквы, которые выбрал капитан.
// Пока поле пусто, клиент считает его сам (краска и фигура — по id команды,
// буквы — из названия), поэтому в ответах пустое поле — `null`, а команда без
// единого выбора — `look: null`.

/** Краски знака — те же девять, что в `pbth/ui/team-mark.ts` (TEAM_PAINTS). */
export const TEAM_PAINTS = [
  "#FF8A1F",
  "#4FC3F7",
  "#FF6B57",
  "#A58BFF",
  "#FFD23F",
  "#FF6FB0",
  "#F2F3F5",
  "#D9B98A",
  "#4F7CFF",
] as const;

/** Число фигур знака — как `TEAM_SHAPE_COUNT` на клиенте. */
export const TEAM_SHAPE_COUNT = 9;

export type TeamLook = { paint: string | null; shape: number | null; letters: string | null };

type LookRow = { mark_paint: string | null; mark_shape: number | null; mark_letters: string | null };

export function teamLookOf(row: LookRow | null | undefined): TeamLook | null {
  if (!row) return null;
  if (row.mark_paint === null && row.mark_shape === null && row.mark_letters === null) return null;
  return { paint: row.mark_paint, shape: row.mark_shape, letters: row.mark_letters };
}

/** Оформление команд по id: в карте только те, где капитан что-то выбрал. */
export async function loadTeamLooks(teamIds: Array<string | null | undefined>): Promise<Map<string, TeamLook>> {
  const ids = [...new Set(teamIds.filter((id): id is string => Boolean(id)))];
  const looks = new Map<string, TeamLook>();
  if (ids.length === 0) return looks;
  const result = await query<LookRow & { id: string }>(
    `SELECT id, mark_paint, mark_shape, mark_letters
     FROM teams
     WHERE id = ANY($1::uuid[])
       AND (mark_paint IS NOT NULL OR mark_shape IS NOT NULL OR mark_letters IS NOT NULL)`,
    [ids]
  );
  for (const row of result.rows) {
    const look = teamLookOf(row);
    if (look) looks.set(row.id, look);
  }
  return looks;
}

export async function loadTeamLook(teamId: string): Promise<TeamLook | null> {
  return (await loadTeamLooks([teamId])).get(teamId) ?? null;
}

/** Буквы знака: один или два знака, только буквы и цифры, заглавными. Пустая строка — сброс. */
export function normalizeLetters(raw: string): string | null | undefined {
  const value = raw.trim().toUpperCase();
  if (value === "") return null;
  const chars = Array.from(value);
  if (chars.length > 2) return undefined;
  if (!chars.every((ch) => /^[\p{L}\p{N}]$/u.test(ch))) return undefined;
  return chars.join("");
}

const paintSchema = z
  .string()
  .transform((value) => value.trim().toUpperCase())
  .refine((value) => (TEAM_PAINTS as readonly string[]).includes(value), { message: "Unknown paint" });

const lettersSchema = z
  .string()
  .max(16)
  .transform((value, ctx) => {
    const letters = normalizeLetters(value);
    if (letters === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Letters: one or two letters or digits" });
      return z.NEVER;
    }
    return letters;
  });

/** Тело `PATCH /teams/:teamId/look`: меняются только присланные поля, `null` возвращает расчёт по умолчанию. */
export const teamLookPatchSchema = z
  .object({
    paint: paintSchema.nullable().optional(),
    shape: z.number().int().min(0).max(TEAM_SHAPE_COUNT - 1).nullable().optional(),
    letters: lettersSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => value.paint !== undefined || value.shape !== undefined || value.letters !== undefined, {
    message: "At least one field (paint, shape or letters) is required",
  });

export type TeamLookPatch = z.infer<typeof teamLookPatchSchema>;

/** Записать присланные поля; ответ — оформление после записи, `undefined` — команды нет. */
export async function updateTeamLook(teamId: string, patch: TeamLookPatch): Promise<TeamLook | null | undefined> {
  const result = await query<LookRow>(
    `UPDATE teams
     SET mark_paint = CASE WHEN $2::boolean THEN $3::text ELSE mark_paint END,
         mark_shape = CASE WHEN $4::boolean THEN $5::smallint ELSE mark_shape END,
         mark_letters = CASE WHEN $6::boolean THEN $7::text ELSE mark_letters END
     WHERE id = $1
     RETURNING mark_paint, mark_shape, mark_letters`,
    [
      teamId,
      patch.paint !== undefined,
      patch.paint ?? null,
      patch.shape !== undefined,
      patch.shape ?? null,
      patch.letters !== undefined,
      patch.letters ?? null,
    ]
  );
  if (!result.rows[0]) return undefined;
  return teamLookOf(result.rows[0]);
}
