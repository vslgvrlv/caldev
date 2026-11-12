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
