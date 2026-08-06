// Человеческие подписи для значений разбора (#89).
//
// В базе фазы и комбинации лежат кодами (BREAK, SNAKE_ATTACK, NARROW), а
// инициатива — числом −1/0/+1. Приложение их переводит, а выгрузка отдавала
// как есть — и в таблице у аналитика появлялись «ROTATION» и «1», которые он
// расшифровать не может. Выгрузку читает человек, а не парсер, поэтому в CSV
// уезжают подписи, а не коды.

export const PHASE_LABEL: Record<string, string> = {
  BREAK: "на разбежке",
  COVER: "за укрытием",
  ROTATION: "на перемещении",
};

export const EXIT_REASON_LABEL: Record<string, string> = {
  SURVIVED: "дожил",
  HIT: "выбили",
  PENALTY: "вывели за штраф",
};

export const PENALTY_KIND_LABEL: Record<string, string> = {
  OWN: "свой штраф",
  TEAMMATE: "штраф партнёра",
};

export const COMBINATION_LABEL: Record<string, string> = {
  ENVELOPE_ATTACK: "атака по конвертам",
  SNAKE_ATTACK: "атака по змеям",
  ACTIVE_SNAKE: "активная змея",
  ACTIVE_ENVELOPE: "активные конверты",
};

export const BREAK_WIDTH_LABEL: Record<string, string> = {
  NARROW: "узкая",
  WIDE: "широкая",
};

export const POINT_RESULT_LABEL: Record<string, string> = {
  WIN: "выиграли",
  LOSS: "проиграли",
};

// Инициатива на линии: +1 забрали мы, −1 забрал соперник, 0 — поровну.
export function initiativeLabel(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (value > 0) return "мы";
  if (value < 0) return "они";
  return "поровну";
}

// Неизвестный код лучше показать как есть, чем потерять: справочники растут
// миграциями, и пустая ячейка спрячет от аналитика новое значение.
export function labelOf(dictionary: Record<string, string>, value: string | null | undefined): string {
  if (!value) return "";
  return dictionary[value] ?? value;
}
