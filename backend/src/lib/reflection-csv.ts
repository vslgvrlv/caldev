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
import type { EventSummary } from "./reflection-summary.js";

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

// Сводка отдельным файлом, а не блоком поверх таблицы: если положить её сверху,
// строка заголовка детальной таблицы перестаёт быть первой и в Excel ломаются
// фильтр и сводная. Два файла — две чистые таблицы.
const LINE_LABEL: Record<string, string> = {
  snake: "змея",
  center: "центр",
  envelope: "конверты",
};

// Проценты без размера выборки врут, поэтому winrate и «на скольких пойнтах»
// всегда идут парой — в отдельных колонках, чтобы по ним можно было сортировать.
function rateCells(rate: { wins: number; losses: number; total: number; winRate: number | null }) {
  return [rate.total, rate.wins, rate.losses, rate.winRate === null ? "" : `${rate.winRate}%`];
}

const RATE_HEADER = ["Пойнтов", "Выиграли", "Проиграли", "Winrate"];

export function renderSummaryCsv(summary: EventSummary, eventTitle: string): string {
  const lines: string[] = [];
  const push = (cells: unknown[]) => lines.push(cells.map(csvCell).join(";"));
  const section = (title: string, header: string[]) => {
    if (lines.length) lines.push("");
    push([title]);
    push(header);
  };

  push([`Сводка разбора: ${eventTitle}`]);
  lines.push("");
  push(["Пойнтов всего", summary.coverage.points]);
  push(["Размечено по результату", summary.coverage.marked]);
  push(["Выиграно", summary.overall.wins]);
  push(["Проиграно", summary.overall.losses]);
  push(["Winrate турнира", summary.overall.winRate === null ? "" : `${summary.overall.winRate}%`]);
  push(["С рефлексиями игроков", summary.coverage.withReflections]);
  push(["Обычный состав на пойнте (форм)", summary.coverage.squadSize]);
  push(["Пойнтов с полным составом форм", summary.coverage.withFullSquad]);
  push(["С разбором капитана", summary.coverage.withCaptainReport]);

  section("Реализация численного преимущества (дельта разбежки)", ["Дельта", ...RATE_HEADER]);
  if (!summary.deltaOtb.length) push(["нет данных"]);
  for (const row of summary.deltaOtb) {
    push([row.delta > 0 ? `+${row.delta}` : String(row.delta), ...rateCells(row)]);
  }

  section(`Инициатива в равных составах (пойнтов с дельтой 0: ${summary.equalSquads.points})`, [
    "Линия",
    "Инициатива",
    ...RATE_HEADER,
  ]);
  for (const line of summary.equalSquads.lines) {
    push([LINE_LABEL[line.line] ?? line.line, "забрали мы", ...rateCells(line.ours)]);
    push([LINE_LABEL[line.line] ?? line.line, "забрал соперник", ...rateCells(line.theirs)]);
    push([LINE_LABEL[line.line] ?? line.line, "поровну", ...rateCells(line.even)]);
  }

  section("Комбинации", ["Комбинация", ...RATE_HEADER]);
  if (!summary.combinations.length) push(["нет данных"]);
  for (const row of summary.combinations) {
    push([labelOf(COMBINATION_LABEL, row.combination), ...rateCells(row)]);
  }

  section("Разбежка", ["Наша", "Соперника", ...RATE_HEADER]);
  if (!summary.breakWidth.length) push(["нет данных"]);
  for (const row of summary.breakWidth) {
    push([labelOf(BREAK_WIDTH_LABEL, row.ours), labelOf(BREAK_WIDTH_LABEL, row.theirs), ...rateCells(row)]);
  }

  // Матрица «зона × фаза»: из неё прямо следует упражнение на тренировку —
  // «змея не проходит разбежку» читается как клетка, а не как список фигур.
  section("Где выбивают (зона × фаза)", ["Зона", "На разбежке", "За укрытием", "На перемещении", "Всего"]);
  if (!summary.deaths.total) push(["нет данных"]);
  else {
    for (const zone of summary.deaths.zones) {
      push([
        LINE_LABEL[zone.zone] ?? zone.zone,
        zone.byPhase.BREAK ?? 0,
        zone.byPhase.COVER ?? 0,
        zone.byPhase.ROTATION ?? 0,
        zone.total,
      ]);
    }
    const unknown =
      summary.deaths.total - summary.deaths.zones.reduce((sum, zone) => sum + zone.total, 0);
    push([
      "всего",
      summary.deaths.byPhase.BREAK ?? 0,
      summary.deaths.byPhase.COVER ?? 0,
      summary.deaths.byPhase.ROTATION ?? 0,
      summary.deaths.total,
    ]);
    // Укрытие не обязательно, поэтому часть выбиваний в зоны не раскладывается.
    // Прятать этот остаток нельзя: иначе сумма по матрице не сходится с итогом.
    if (unknown > 0) push(["укрытие не указано", "", "", "", unknown]);
  }

  section("Игроки", [
    "Игрок",
    "Ник",
    "Пойнтов заполнено",
    "Выбит",
    "На разбежке",
    "За укрытием",
    "На перемещении",
    "Киллов",
    "Самооценка средняя",
    "Самооценка в проигранных",
  ]);
  if (!summary.players.length) push(["нет данных"]);
  for (const player of summary.players) {
    push([
      player.name,
      player.nickname,
      player.points,
      player.eliminated,
      player.deathPhases.BREAK ?? 0,
      player.deathPhases.COVER ?? 0,
      player.deathPhases.ROTATION ?? 0,
      player.kills,
      player.avgSelfRating ?? "",
      player.avgSelfRatingInLosses ?? "",
    ]);
  }

  section("Расхождение капитана с расчётом дельты", ["Сравнено пойнтов", "Разошлось"]);
  push([summary.captainMismatch.compared, summary.captainMismatch.mismatched]);

  return lines.join("\r\n");
}
