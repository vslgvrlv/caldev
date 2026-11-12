// Настройка оформления команды: что выбрал капитан в шторке и что из этого уйдёт на сервер.
// Пустое поле (`null`, пустые буквы) — расчёт по умолчанию: краска и фигура по id, буквы из названия.

import {
  defaultTeamPaint,
  defaultTeamShapeIndex,
  teamLetters,
  validLetters,
  validPaint,
  validShape,
  type TeamLook,
} from '../ui/team-mark';

/** Названия красок для подписи кнопок, в порядке `TEAM_PAINTS`. */
export const PAINT_NAMES = ['Оранжевая', 'Голубая', 'Коралловая', 'Сиреневая', 'Жёлтая', 'Розовая', 'Белая', 'Песочная', 'Синяя'];

export type LookDraft = { paint: string | null; shape: number | null; letters: string };

export type LookPatch = { paint?: string | null; shape?: number | null; letters?: string | null };

export function draftFromLook(look: TeamLook | null | undefined): LookDraft {
  return { paint: validPaint(look?.paint), shape: validShape(look?.shape), letters: validLetters(look?.letters) ?? '' };
}

/** Буквы в поле, пока человек печатает: заглавные, не больше двух знаков. */
export function typedLetters(raw: string): string {
  return Array.from(raw.replace(/\s+/g, '').toUpperCase()).slice(0, 2).join('');
}

/** Буквы можно сохранить: пусто (вернутся буквы из названия) или один-два знака из букв и цифр. */
export function lettersOk(letters: string): boolean {
  return letters === '' || validLetters(letters) !== null;
}

/** Что показать в живом знаке: выбранное, а где не выбрано — расчёт по умолчанию. */
export function shownLook(teamId: string, name: string, code: string | undefined, draft: LookDraft) {
  return {
    paint: draft.paint ?? defaultTeamPaint(teamId),
    shape: draft.shape ?? defaultTeamShapeIndex(teamId),
    letters: validLetters(draft.letters) ?? teamLetters(name, code),
  };
}

/** Оформление для знака: буквы, которые ещё нельзя сохранить, в знак не идут. */
export function lookOfDraft(draft: LookDraft): TeamLook {
  return { paint: draft.paint, shape: draft.shape, letters: validLetters(draft.letters) };
}

/** Только изменённые поля; `null` — нечего сохранять. */
export function lookPatch(saved: LookDraft, draft: LookDraft): LookPatch | null {
  const patch: LookPatch = {};
  if (draft.paint !== saved.paint) patch.paint = draft.paint;
  if (draft.shape !== saved.shape) patch.shape = draft.shape;
  if (draft.letters !== saved.letters) patch.letters = draft.letters === '' ? null : draft.letters;
  return Object.keys(patch).length > 0 ? patch : null;
}

export function isDefaultDraft(draft: LookDraft): boolean {
  return draft.paint === null && draft.shape === null && draft.letters === '';
}

export const DEFAULT_DRAFT: LookDraft = { paint: null, shape: null, letters: '' };

// --- Свой логотип -----------------------------------------------------------

/** Предел файла логотипа — как на сервере. */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
/** Файл крупнее уменьшается в браузере до отправки: так он проходит и через узкий предел прокси. */
export const LOGO_SEND_AS_IS_BYTES = 900 * 1024;
export const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp';

const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** Почему файл не подходит, словами для человека; `null` — подходит. */
export function logoFileProblem(file: { type: string; size: number }): string | null {
  if (!LOGO_TYPES.includes(file.type)) return 'Нужна картинка PNG, JPEG или WebP.';
  if (file.size > LOGO_MAX_BYTES) return 'Файл больше 2 МБ. Возьми картинку поменьше.';
  if (file.size === 0) return 'Файл пустой.';
  return null;
}

/** Отказ сервера при загрузке логотипа — словами для человека. */
export function logoErrorText(error: unknown): string {
  const e = (error ?? {}) as { code?: string; status?: number };
  if (e.code === 'LOGO_TYPE' || e.status === 415) return 'Нужна картинка PNG, JPEG или WebP.';
  if (e.code === 'LOGO_TOO_LARGE' || e.status === 413) return 'Файл больше 2 МБ. Возьми картинку поменьше.';
  if (e.code === 'LOGO_BAD_IMAGE' || e.code === 'LOGO_EMPTY') return 'Картинка не открылась. Попробуй другой файл.';
  if (e.code === 'RATE_LIMITED' || e.status === 429) return 'Слишком часто. Попробуй через несколько минут.';
  if (e.status === 403) return 'Менять логотип может только капитан.';
  return 'Не получилось загрузить. Попробуй ещё раз.';
}

/** Размер картинки после уменьшения: большая сторона не больше `max`, пропорции те же. */
export function fitLogoSize(width: number, height: number, max = 512): { width: number; height: number } {
  const k = Math.min(1, max / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}
