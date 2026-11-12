import { z } from "zod";
import { query } from "../db/pool.js";

// Оформление команды: краска, фигура знака и буквы, которые выбрал капитан, и
// свой логотип (он встаёт на место фигуры с буквами). Пока поле пусто, клиент
// считает его сам (краска и фигура — по id команды, буквы — из названия),
// поэтому в ответах пустое поле — `null`, а команда без единого выбора —
// `look: null`.

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

export type TeamLook = {
  paint: string | null;
  shape: number | null;
  letters: string | null;
  /** Адрес логотипа в приложении (`/api/v1/teams/logo/<имя>.webp`) или `null`. */
  logo: string | null;
};

/** Столбцы оформления в строке запроса; `mark_logo` — случайное имя файла логотипа. */
export type TeamLookRow = {
  mark_paint: string | null;
  mark_shape: number | null;
  mark_letters: string | null;
  mark_logo?: string | null;
};

/** Столбцы оформления для SELECT по таблице команд с псевдонимом `alias`. */
export function teamLookColumns(alias = "t"): string {
  return `${alias}.mark_paint, ${alias}.mark_shape, ${alias}.mark_letters,
         (SELECT tl.name FROM team_logos tl WHERE tl.team_id = ${alias}.id) AS mark_logo`;
}

const LOGO_NAME_RE = /^[0-9a-f]{32}$/;

export function isLogoName(value: unknown): value is string {
  return typeof value === "string" && LOGO_NAME_RE.test(value);
}

/** Адрес логотипа по имени файла. Всегда путь приложения, не внешняя ссылка. */
export function teamLogoUrl(name: string): string {
  return `/api/v1/teams/logo/${name}.webp`;
}

export function teamLookOf(row: TeamLookRow | null | undefined): TeamLook | null {
  if (!row) return null;
  const logo = isLogoName(row.mark_logo) ? teamLogoUrl(row.mark_logo) : null;
  if (row.mark_paint === null && row.mark_shape === null && row.mark_letters === null && logo === null) return null;
  return { paint: row.mark_paint, shape: row.mark_shape, letters: row.mark_letters, logo };
}

/** Оформление команд по id: в карте только те, где капитан что-то выбрал. */
export async function loadTeamLooks(teamIds: Array<string | null | undefined>): Promise<Map<string, TeamLook>> {
  const ids = [...new Set(teamIds.filter((id): id is string => Boolean(id)))];
  const looks = new Map<string, TeamLook>();
  if (ids.length === 0) return looks;
  const result = await query<TeamLookRow & { id: string }>(
    `SELECT t.id, ${teamLookColumns("t")}
     FROM teams t
     WHERE t.id = ANY($1::uuid[])
       AND (t.mark_paint IS NOT NULL OR t.mark_shape IS NOT NULL OR t.mark_letters IS NOT NULL
            OR EXISTS (SELECT 1 FROM team_logos tl WHERE tl.team_id = t.id))`,
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
  const result = await query<TeamLookRow>(
    `UPDATE teams t
     SET mark_paint = CASE WHEN $2::boolean THEN $3::text ELSE t.mark_paint END,
         mark_shape = CASE WHEN $4::boolean THEN $5::smallint ELSE t.mark_shape END,
         mark_letters = CASE WHEN $6::boolean THEN $7::text ELSE t.mark_letters END
     WHERE t.id = $1
     RETURNING ${teamLookColumns("t")}`,
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
