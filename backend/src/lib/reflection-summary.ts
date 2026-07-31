// Сводка по событию (#89). Считается из тех же данных, что отдаёт таблица
// разбора, и питает сразу трёх потребителей: экран разбора, выгрузку и API.
//
// Зачем отдельно от таблицы: 15 игроков × 8 пойнтов — это 120 строк, с которыми
// нельзя работать глазами (Василий, 2026-07-31). Сводка отвечает на вопросы
// спеки, а не показывает данные:
//   §2.1 реализуем ли численное преимущество — winrate ПО ВЕЛИЧИНЕ дельты,
//        а не по факту «в большинстве»: +1 и +3 это разные задачи;
//   §2.2 в равных составах решает инициатива — выигрываем ли линии;
//   §3.2 какая комбинация работает;
//   §3.3 узкая разбежка против широкой у соперника;
//   §1.1 где игрока выбивают.
//
// Каждая цифра несёт `total` — на скольких пойнтах посчитана. Winrate без
// размера выборки врёт: «85%» из трёх пойнтов выглядит как знание, но это
// гадание, а турнир даёт всего ~50 пойнтов на четыре комбинации.

export type SummaryInput = {
  // id укрытия -> зона поля (snake | center | envelope). Нужна, чтобы свести
  // 51 фигуру к трём зонам: на 75 выбиваниях за турнир по фигурам получается
  // 1–2 наблюдения на фигуру, а по зонам — рабочая матрица 3×3.
  positionZones?: Record<string, string>;
  games: Array<{
    points: Array<{
      result: string | null;
      deltaOtb: number;
      deltaOtbMismatch: boolean | null;
      captainReport: {
        combination: string | null;
        breakWidth: string | null;
        opponentBreakWidth: string | null;
        initiative: { snake: number | null; center: number | null; envelope: number | null };
      } | null;
      reflections: Array<{
        userId: string;
        name: string;
        nickname: string;
        eliminated: boolean;
        deathPhase: string | null;
        deathPositionId?: string | null;
        kills: Array<{ phase: string }>;
        selfRating: number | null;
      }>;
    }>;
  }>;
};

export type Rate = { wins: number; losses: number; total: number; winRate: number | null };

export type InitiativeLineSummary = {
  line: "snake" | "center" | "envelope";
  ours: Rate;
  theirs: Rate;
  even: Rate;
};

export type PlayerSummary = {
  userId: string;
  name: string;
  nickname: string;
  points: number;
  eliminated: number;
  deathPhases: Record<string, number>;
  kills: number;
  killPhases: Record<string, number>;
  avgSelfRating: number | null;
  avgSelfRatingInLosses: number | null;
};

export type ZoneDeaths = { zone: string; total: number; byPhase: Record<string, number> };

export type EventSummary = {
  coverage: {
    points: number;
    marked: number;
    withReflections: number;
    withCaptainReport: number;
    // Обычный состав на пойнте — сколько форм приходит, когда заполнили все.
    // Считается из самих данных, а не из ростера: в ростере 9-10 человек,
    // на поле выходит пятёрка, и мерить покрытие ростером значит всегда
    // получать «неполно».
    squadSize: number;
    withFullSquad: number;
  };
  // Winrate турнира целиком — якорь, без которого проценты блоков не с чем
  // сравнивать: 55% это хорошо или плохо, зависит от того, каким был турнир.
  overall: Rate;
  deltaOtb: Array<{ delta: number } & Rate>;
  equalSquads: { points: number; lines: InitiativeLineSummary[] };
  combinations: Array<{ combination: string } & Rate>;
  breakWidth: Array<{ ours: string; theirs: string } & Rate>;
  // Состав выбиваний: это часть-от-целого, а не сравнение winrate, поэтому
  // рисуется кольцом, а не полосами.
  deaths: { total: number; byPhase: Record<string, number>; zones: ZoneDeaths[] };
  players: PlayerSummary[];
  captainMismatch: { compared: number; mismatched: number };
};

const PHASES = ["BREAK", "COVER", "ROTATION"] as const;
const LINES = ["snake", "center", "envelope"] as const;
const ZONES = ["snake", "center", "envelope"] as const;

// Доля состава, при которой дельта считается посчитанной. Дельта выводится из
// форм: у кого не заполнено — того как будто не выбивали. При двух формах из
// пяти пойнт покажет ноль и попадёт в «равные составы», хотя это «нет данных».
const SQUAD_COVERAGE = 0.8;

// Обычный размер пятёрки берём как самое частое число форм на пойнт среди
// пойнтов, где формы вообще есть. Мода устойчивее максимума: один пойнт с
// лишней формой не должен поднимать планку для всего турнира.
function inferSquadSize(counts: number[]): number {
  const filled = counts.filter((n) => n > 0);
  if (!filled.length) return 0;
  const freq = new Map<number, number>();
  for (const n of filled) freq.set(n, (freq.get(n) ?? 0) + 1);
  let best = 0;
  let bestFreq = 0;
  for (const [size, times] of freq) {
    if (times > bestFreq || (times === bestFreq && size > best)) {
      best = size;
      bestFreq = times;
    }
  }
  return best;
}

function emptyRate(): Rate {
  return { wins: 0, losses: 0, total: 0, winRate: null };
}

// Пойнт без разметки в winrate не идёт: неизвестный результат это не поражение.
function addResult(rate: Rate, result: string | null): void {
  if (result !== "WIN" && result !== "LOSS") return;
  rate.total += 1;
  if (result === "WIN") rate.wins += 1;
  else rate.losses += 1;
}

function sealRate(rate: Rate): Rate {
  rate.winRate = rate.total === 0 ? null : Math.round((rate.wins / rate.total) * 100);
  return rate;
}

function bucket<K>(map: Map<K, Rate>, key: K): Rate {
  const existing = map.get(key);
  if (existing) return existing;
  const created = emptyRate();
  map.set(key, created);
  return created;
}

export function buildEventSummary(table: SummaryInput): EventSummary {
  const points = table.games.flatMap((game) => game.points);
  const positionZones = table.positionZones ?? {};

  const squadSize = inferSquadSize(points.map((point) => point.reflections.length));
  // Порог не может быть нулём: без форм дельта не существует вовсе.
  const squadThreshold = Math.max(1, Math.ceil(squadSize * SQUAD_COVERAGE));

  const overall = emptyRate();
  const deathsByPhase: Record<string, number> = Object.fromEntries(PHASES.map((phase) => [phase, 0]));
  const deathsByZone = new Map<string, Record<string, number>>(
    ZONES.map((zone) => [zone, Object.fromEntries(PHASES.map((phase) => [phase, 0]))])
  );
  let deathsTotal = 0;
  let withFullSquad = 0;

  const deltaBuckets = new Map<number, Rate>();
  const combinationBuckets = new Map<string, Rate>();
  const breakWidthBuckets = new Map<string, Rate>();
  const initiative: Record<string, { ours: Rate; theirs: Rate; even: Rate }> = {
    snake: { ours: emptyRate(), theirs: emptyRate(), even: emptyRate() },
    center: { ours: emptyRate(), theirs: emptyRate(), even: emptyRate() },
    envelope: { ours: emptyRate(), theirs: emptyRate(), even: emptyRate() },
  };

  const players = new Map<string, PlayerSummary & { ratings: number[]; ratingsInLosses: number[] }>();

  let marked = 0;
  let withReflections = 0;
  let withCaptainReport = 0;
  let equalSquadPoints = 0;
  let compared = 0;
  let mismatched = 0;

  for (const point of points) {
    if (point.result === "WIN" || point.result === "LOSS") marked += 1;
    addResult(overall, point.result);
    if (point.reflections.length) withReflections += 1;
    if (point.captainReport) withCaptainReport += 1;
    if (point.deltaOtbMismatch !== null) {
      compared += 1;
      if (point.deltaOtbMismatch) mismatched += 1;
    }

    // Дельта считается из форм игроков: у кого форма не заполнена — того как
    // будто не выбивали. Поэтому пойнт с неполной пятёркой в дельту не идёт,
    // иначе одна форма даёт ноль и пойнт уезжает в «равные составы».
    const fullSquad = point.reflections.length >= squadThreshold;
    if (fullSquad) {
      withFullSquad += 1;
      addResult(bucket(deltaBuckets, point.deltaOtb), point.result);
      if (point.deltaOtb === 0) equalSquadPoints += 1;
    }

    const report = point.captainReport;
    if (report?.combination) {
      addResult(bucket(combinationBuckets, report.combination), point.result);
    }
    if (report?.breakWidth && report.opponentBreakWidth) {
      addResult(bucket(breakWidthBuckets, `${report.breakWidth}|${report.opponentBreakWidth}`), point.result);
    }

    // Инициатива различает пойнты только в равных составах (§2.2): когда кого-то
    // отстреляли на разбежке, исход объясняет численность, а не темп выхода.
    if (report && fullSquad && point.deltaOtb === 0) {
      for (const line of LINES) {
        const value = report.initiative[line];
        if (value === null || value === undefined) continue;
        const slot = value > 0 ? "ours" : value < 0 ? "theirs" : "even";
        addResult(initiative[line][slot], point.result);
      }
    }

    for (const reflection of point.reflections) {
      let player = players.get(reflection.userId);
      if (!player) {
        player = {
          userId: reflection.userId,
          name: reflection.name,
          nickname: reflection.nickname,
          points: 0,
          eliminated: 0,
          deathPhases: Object.fromEntries(PHASES.map((phase) => [phase, 0])),
          kills: 0,
          killPhases: Object.fromEntries(PHASES.map((phase) => [phase, 0])),
          avgSelfRating: null,
          avgSelfRatingInLosses: null,
          ratings: [],
          ratingsInLosses: [],
        };
        players.set(reflection.userId, player);
      }

      player.points += 1;
      if (reflection.eliminated) {
        player.eliminated += 1;
        deathsTotal += 1;
        if (reflection.deathPhase) {
          player.deathPhases[reflection.deathPhase] = (player.deathPhases[reflection.deathPhase] ?? 0) + 1;
          deathsByPhase[reflection.deathPhase] = (deathsByPhase[reflection.deathPhase] ?? 0) + 1;
          // Зона нужна вместе с фазой: «выбили на разбежке» не даёт задания на
          // тренировку, «выбили на разбежке в змее» — даёт.
          const zone = reflection.deathPositionId ? positionZones[reflection.deathPositionId] : undefined;
          const cell = zone ? deathsByZone.get(zone) : undefined;
          if (cell) cell[reflection.deathPhase] = (cell[reflection.deathPhase] ?? 0) + 1;
        }
      }
      player.kills += reflection.kills.length;
      for (const kill of reflection.kills) {
        player.killPhases[kill.phase] = (player.killPhases[kill.phase] ?? 0) + 1;
      }
      if (reflection.selfRating !== null) {
        player.ratings.push(reflection.selfRating);
        // Самооценка в проигранных пойнтах отдельно: расхождение с общей и есть
        // сигнал, что игрок не связывает свою игру с результатом команды.
        if (point.result === "LOSS") player.ratingsInLosses.push(reflection.selfRating);
      }
    }
  }

  const average = (values: number[]): number | null =>
    values.length === 0 ? null : Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10;

  return {
    coverage: { points: points.length, marked, withReflections, withCaptainReport, squadSize, withFullSquad },
    overall: sealRate(overall),
    deaths: {
      total: deathsTotal,
      byPhase: deathsByPhase,
      zones: ZONES.map((zone) => {
        const byPhase = deathsByZone.get(zone)!;
        return { zone, total: PHASES.reduce((sum, phase) => sum + (byPhase[phase] ?? 0), 0), byPhase };
      }),
    },
    deltaOtb: [...deltaBuckets.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([delta, rate]) => ({ delta, ...sealRate(rate) })),
    equalSquads: {
      points: equalSquadPoints,
      lines: LINES.map((line) => ({
        line,
        ours: sealRate(initiative[line].ours),
        theirs: sealRate(initiative[line].theirs),
        even: sealRate(initiative[line].even),
      })),
    },
    combinations: [...combinationBuckets.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .map(([combination, rate]) => ({ combination, ...sealRate(rate) })),
    breakWidth: [...breakWidthBuckets.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .map(([key, rate]) => {
        const [ours, theirs] = key.split("|");
        return { ours, theirs, ...sealRate(rate) };
      }),
    players: [...players.values()]
      .map((player) => {
        const { ratings, ratingsInLosses, ...rest } = player;
        return { ...rest, avgSelfRating: average(ratings), avgSelfRatingInLosses: average(ratingsInLosses) };
      })
      .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name)),
    captainMismatch: { compared, mismatched },
  };
}
