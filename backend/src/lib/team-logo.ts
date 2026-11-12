import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { query } from "../db/pool.js";
import { isLogoName } from "./team-look.js";

// Свой логотип команды. Капитан присылает PNG, JPEG или WebP до 2 МБ; сервер
// смотрит на содержимое (а не на имя и заголовок), перекодирует в квадрат
// 256×256 WebP без метаданных и кладёт в базу под случайным именем. Исходный
// файл не хранится и никуда не отдаётся.

/** Предел файла на входе. */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
/** Сторона сохранённого квадрата. */
export const LOGO_SIZE = 256;
/** Предел по пикселям на входе: картинка крупнее не разворачивается в память. */
export const LOGO_MAX_PIXELS = 4096 * 4096;

export type LogoErrorCode = "LOGO_EMPTY" | "LOGO_TOO_LARGE" | "LOGO_TYPE" | "LOGO_BAD_IMAGE";

export class LogoError extends Error {
  constructor(public code: LogoErrorCode, public status: number, message: string) {
    super(message);
  }
}

export type LogoType = "png" | "jpeg" | "webp";

/** Тип картинки по первым байтам. SVG, GIF, HTML и всё остальное — `null`. */
export function sniffLogoType(data: Buffer): LogoType | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpeg";
  if (data.length >= 12 && data.toString("latin1", 0, 4) === "RIFF" && data.toString("latin1", 8, 12) === "WEBP") return "webp";
  return null;
}

/** Проверить файл и перекодировать: квадрат 256×256 WebP, метаданные сняты. */
export async function encodeLogo(data: Buffer): Promise<Buffer> {
  if (!Buffer.isBuffer(data) || data.length === 0) throw new LogoError("LOGO_EMPTY", 400, "Logo file is empty");
  if (data.length > LOGO_MAX_BYTES) throw new LogoError("LOGO_TOO_LARGE", 413, "Logo file is larger than 2 MB");
  const type = sniffLogoType(data);
  if (!type) throw new LogoError("LOGO_TYPE", 415, "Logo must be a PNG, JPEG or WebP image");
  try {
    const image = sharp(data, { limitInputPixels: LOGO_MAX_PIXELS, failOn: "error", animated: false, sequentialRead: true });
    const meta = await image.metadata();
    // Разбор должен подтвердить тот же тип, что и первые байты.
    if (meta.format !== type) throw new LogoError("LOGO_TYPE", 415, "Logo must be a PNG, JPEG or WebP image");
    return await image
      .rotate() // поворот из EXIF применяется, сами метаданные в результат не попадают
      .resize(LOGO_SIZE, LOGO_SIZE, { fit: "cover", position: "centre" })
      .webp({ quality: 86 })
      .timeout({ seconds: 10 })
      .toBuffer();
  } catch (error) {
    if (error instanceof LogoError) throw error;
    throw new LogoError("LOGO_BAD_IMAGE", 400, "Logo image cannot be read");
  }
}

/** Сохранить логотип команды (прежний заменяется). Ответ — новое случайное имя файла. */
export async function saveTeamLogo(teamId: string, encoded: Buffer, userId: string | null): Promise<string> {
  const name = randomBytes(16).toString("hex");
  await query(
    `INSERT INTO team_logos (team_id, name, data, created_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (team_id) DO UPDATE
       SET name = EXCLUDED.name, data = EXCLUDED.data, created_by = EXCLUDED.created_by, created_at = now()`,
    [teamId, name, encoded, userId]
  );
  return name;
}

/** Убрать логотип команды. `true` — он был. */
export async function deleteTeamLogo(teamId: string): Promise<boolean> {
  const result = await query(`DELETE FROM team_logos WHERE team_id = $1`, [teamId]);
  return (result.rowCount ?? 0) > 0;
}

/** Картинка по имени файла (без расширения). Имя не из 32 шестнадцатеричных знаков в базу не идёт. */
export async function loadTeamLogo(name: unknown): Promise<Buffer | null> {
  if (!isLogoName(name)) return null;
  const result = await query<{ data: Buffer }>(`SELECT data FROM team_logos WHERE name = $1`, [name]);
  return result.rows[0]?.data ?? null;
}
