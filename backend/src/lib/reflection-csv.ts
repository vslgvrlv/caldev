// Выгрузка таблицы разбора в CSV. Отдельно от роутов, потому что это формат
// обмена: разбор продолжается в таблице, а не в приложении, и раскладка колонок
// должна быть покрыта тестами — сдвиг на одну колонку заметят через месяц.

import {
  BREAK_WIDTH_LABEL,
  COMBINATION_LABEL,
  PHASE_LABEL,
  POINT_RESULT_LABEL,
  initiativeLabel,
  labelOf,
} from "./reflection-labels.js";

// Структурный тип: сюда приходит ровно то, что отдаёт эндпоинт таблицы.
export type ReflectionCsvTable = {
  positions: Record<string, string>;
  games: Array<{
    time: string;
    opponent: string;
    score: string | null;
    points: Array<{
      ordinal: number;
      result: string | null;
      deltaOtb: number;
      deltaOtbMismatch: boolean | null;
      captainReport: {
        combination: string | null;
        breakWidth: string | null;
        opponentBreakWidth: string | null;
        initiative: { snake: number | null; center: number | null; envelope: number | null };
        deltaOtb: number | null;
        note: string | null;
      } | null;
      reflections: Array<{
        name: string;
        nickname: string;
        eliminated: boolean;
        deathPhase: string | null;
        deathPositionId: string | null;
        kills: Array<{ phase: string; positionId: string | null }>;
        selfRating: number | null;
        note: string | null;
      }>;
    }>;
  }>;
};

export const CSV_HEADER = [
  "Время",
  "Соперник",
  "Счёт",
  "Пойнт",
  "Результат",
  "Игрок",
  "Ник",
  "Выбит",
  "Фаза поражения",
  "Укрытие поражения",
  "Киллов",
  "Киллы (фаза · укрытие)",
  "Самооценка",
  "Заметка игрока",
  "Дельта разбежки (расчёт)",
  "Дельта разбежки (капитан)",
  "Расхождение",
  "Комбинация",
  "Наша разбежка",
  "Разбежка соперника",
  "Инициатива змея",
  "Инициатива центр",
  "Инициатива конверты",
  "Заметка капитана",
];

// Экранирование по RFC 4180: заметки — свободный текст, там встречается всё.
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",;\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function renderTableCsv(table: ReflectionCsvTable): string {
  const lines = [CSV_HEADER.map(csvCell).join(";")];

  for (const game of table.games) {
    for (const point of game.points) {
      const shared = [
        game.time,
        game.opponent,
        game.score,
        point.ordinal,
        labelOf(POINT_RESULT_LABEL, point.result),
      ];
      const captain = [
        point.deltaOtb,
        point.captainReport?.deltaOtb ?? "",
        point.deltaOtbMismatch === null ? "" : point.deltaOtbMismatch ? "да" : "нет",
        labelOf(COMBINATION_LABEL, point.captainReport?.combination),
        labelOf(BREAK_WIDTH_LABEL, point.captainReport?.breakWidth),
        labelOf(BREAK_WIDTH_LABEL, point.captainReport?.opponentBreakWidth),
        initiativeLabel(point.captainReport?.initiative.snake),
        initiativeLabel(point.captainReport?.initiative.center),
        initiativeLabel(point.captainReport?.initiative.envelope),
        point.captainReport?.note ?? "",
      ];

      // Пойнт без единой формы всё равно строка: пустота в таблице — это
      // тоже факт, по ней видно, где команда рефлексию не заполняет.
      if (!point.reflections.length) {
        lines.push([...shared, "", "", "", "", "", "", "", "", "", ...captain].map(csvCell).join(";"));
        continue;
      }

      for (const reflection of point.reflections) {
        lines.push(
          [
            ...shared,
            reflection.name,
            reflection.nickname,
            reflection.eliminated ? "да" : "нет",
            labelOf(PHASE_LABEL, reflection.deathPhase),
            reflection.deathPositionId
              ? table.positions[reflection.deathPositionId] ?? reflection.deathPositionId
              : "",
            reflection.kills.length,
            reflection.kills
              .map(
                (k) =>
                  `${labelOf(PHASE_LABEL, k.phase)} · ${
                    k.positionId ? table.positions[k.positionId] ?? k.positionId : "укрытие не указано"
                  }`
              )
              .join("; "),
            reflection.selfRating ?? "",
            reflection.note ?? "",
            ...captain,
          ]
            .map(csvCell)
            .join(";")
        );
      }
    }
  }

  return lines.join("\r\n");
}
