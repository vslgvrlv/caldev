import { describe, expect, it } from "vitest";
import { buildEventSummary, type SummaryInput } from "../../lib/reflection-summary.js";

// Сводка — это выводы, на которые тренер опирается вслух перед командой.
// Ошибка здесь не ломает экран, а тихо меняет смысл цифры, поэтому каждое
// правило спеки закреплено отдельным тестом.

type Point = SummaryInput["games"][number]["points"][number];
type Reflection = Point["reflections"][number];

const reflection = (over: Partial<Reflection> = {}): Reflection => ({
  userId: "u1",
  name: "Василий Гаврилов",
  nickname: "vasily",
  exitReason: "SURVIVED",
  penaltyKind: null,
  exitPhase: null,
  kills: [],
  selfRating: null,
  ...over,
});

const point = (over: Partial<Point> = {}): Point => ({
  result: "WIN",
  deltaOtb: 0,
  deltaOtbMismatch: null,
  captainReport: null,
  reflections: [reflection()],
  ...over,
});

const summaryOf = (points: Point[]) => buildEventSummary({ games: [{ points }] });

const captainReport = (over: Partial<NonNullable<Point["captainReport"]>> = {}) => ({
  combination: null,
  breakWidth: null,
  opponentBreakWidth: null,
  initiative: { snake: null, center: null, envelope: null },
  ...over,
});

describe("buildEventSummary", () => {
  it("дельта разбивается по величине, а не по знаку", () => {
    // «В плюс один выигрываем 40%, в плюс два — 85%» это разные задачи,
    // и в одном ведре «в большинстве» они бы схлопнулись в бессмысленное среднее.
    const summary = summaryOf([
      point({ deltaOtb: 1, result: "WIN" }),
      point({ deltaOtb: 1, result: "LOSS" }),
      point({ deltaOtb: 2, result: "WIN" }),
    ]);

    expect(summary.deltaOtb).toEqual([
      { delta: 2, wins: 1, losses: 0, total: 1, winRate: 100 },
      { delta: 1, wins: 1, losses: 1, total: 2, winRate: 50 },
    ]);
  });

  it("неразмеченный пойнт не идёт в winrate", () => {
    // Неизвестный результат — это не поражение. Иначе команда, которая просто
    // не доразметила гейм, увидит проваленный winrate.
    const summary = summaryOf([point({ deltaOtb: 1, result: "WIN" }), point({ deltaOtb: 1, result: null })]);

    expect(summary.deltaOtb).toEqual([{ delta: 1, wins: 1, losses: 0, total: 1, winRate: 100 }]);
    expect(summary.coverage).toEqual({
      points: 2,
      marked: 1,
      withReflections: 2,
      withCaptainReport: 0,
      squadSize: 1,
      withFullSquad: 2,
    });
  });

  it("пойнт без форм в дельту не попадает", () => {
    // Дельта считается из форм игроков, поэтому на пустом пойнте она формально
    // ноль — но это «нет данных», а не «равные составы».
    const summary = summaryOf([point({ deltaOtb: 0, reflections: [] })]);

    expect(summary.deltaOtb).toEqual([]);
    expect(summary.equalSquads.points).toBe(0);
  });

  it("инициатива считается только в равных составах", () => {
    // §2.2: когда кого-то отстреляли на разбежке, исход объясняет численность,
    // а не то, кто первым занял укрытие.
    const summary = summaryOf([
      point({
        deltaOtb: 0,
        result: "WIN",
        captainReport: captainReport({ initiative: { snake: 1, center: 0, envelope: -1 } }),
      }),
      point({
        deltaOtb: 2,
        result: "LOSS",
        captainReport: captainReport({ initiative: { snake: 1, center: 1, envelope: 1 } }),
      }),
    ]);

    const snake = summary.equalSquads.lines.find((line) => line.line === "snake");
    expect(summary.equalSquads.points).toBe(1);
    expect(snake?.ours).toEqual({ wins: 1, losses: 0, total: 1, winRate: 100 });
    expect(snake?.theirs.total).toBe(0);

    const envelope = summary.equalSquads.lines.find((line) => line.line === "envelope");
    expect(envelope?.theirs).toEqual({ wins: 1, losses: 0, total: 1, winRate: 100 });

    const center = summary.equalSquads.lines.find((line) => line.line === "center");
    expect(center?.even.total).toBe(1);
  });

  it("разбежка учитывается только парой: наша ширина против ширины соперника", () => {
    const summary = summaryOf([
      point({ captainReport: captainReport({ breakWidth: "NARROW", opponentBreakWidth: "WIDE" }) }),
      point({ captainReport: captainReport({ breakWidth: "NARROW", opponentBreakWidth: null }) }),
    ]);

    expect(summary.breakWidth).toEqual([
      { ours: "NARROW", theirs: "WIDE", wins: 1, losses: 0, total: 1, winRate: 100 },
    ]);
  });

  it("комбинации сортируются по числу пойнтов", () => {
    const summary = summaryOf([
      point({ captainReport: captainReport({ combination: "SNAKE_ATTACK" }) }),
      point({ captainReport: captainReport({ combination: "ENVELOPE_ATTACK" }), result: "LOSS" }),
      point({ captainReport: captainReport({ combination: "ENVELOPE_ATTACK" }) }),
    ]);

    expect(summary.combinations.map((row) => row.combination)).toEqual(["ENVELOPE_ATTACK", "SNAKE_ATTACK"]);
    expect(summary.combinations[0]).toMatchObject({ total: 2, wins: 1, losses: 1, winRate: 50 });
  });

  it("самооценка в проигранных считается отдельно от общей", () => {
    // Расхождение общей и «в проигранных» показывает игрока, который не связывает
    // свою игру с результатом команды.
    const summary = summaryOf([
      point({ result: "WIN", reflections: [reflection({ selfRating: 5 })] }),
      point({ result: "LOSS", reflections: [reflection({ selfRating: 4 })] }),
    ]);

    expect(summary.players[0]).toMatchObject({ points: 2, avgSelfRating: 4.5, avgSelfRatingInLosses: 4 });
  });

  it("пропущенная самооценка не считается нулём", () => {
    const summary = summaryOf([
      point({ reflections: [reflection({ selfRating: 4 })] }),
      point({ reflections: [reflection({ selfRating: null })] }),
    ]);

    expect(summary.players[0].avgSelfRating).toBe(4);
  });

  it("поражения и киллы раскладываются по фазам", () => {
    const summary = summaryOf([
      point({
        reflections: [
          reflection({ exitReason: "HIT", penaltyKind: null, exitPhase: "BREAK", kills: [{ phase: "COVER" }, { phase: "COVER" }] }),
          reflection({ userId: "u2", name: "Денис Голев", nickname: "golev", exitReason: "HIT", exitPhase: "ROTATION" }),
        ],
      }),
    ]);

    const vasily = summary.players.find((player) => player.userId === "u1");
    expect(vasily).toMatchObject({
      eliminated: 1,
      kills: 2,
      deathPhases: { BREAK: 1, COVER: 0, ROTATION: 0 },
      killPhases: { BREAK: 0, COVER: 2, ROTATION: 0 },
    });
    expect(summary.players.find((player) => player.userId === "u2")?.deathPhases.ROTATION).toBe(1);
  });

  // Штрафной вывод не выбивание: если считать его смертью, дисциплинированный
  // игрок и штрафник в таблице неотличимы, а тепловая карта покажет укрытие,
  // на котором игрока никто не выбивал (#104).
  it("штрафной вывод не попадает ни в выбивания, ни в фазы, ни в зоны", () => {
    const summary = buildEventSummary({
      positionZones: { "snake.1.near": "snake" },
      games: [
        {
          points: [
            point({
              reflections: [
                reflection({
                  exitReason: "PENALTY",
                  penaltyKind: "OWN",
                  exitPhase: "BREAK",
                  exitPositionId: "snake.1.near",
                }),
              ],
            }),
          ],
        },
      ],
    } as unknown as SummaryInput);

    const player = summary.players.find((p) => p.userId === "u1")!;
    expect(player.eliminated).toBe(0);
    expect(player.penalties).toBe(1);
    expect(player.ownPenalties).toBe(1);
    expect(player.deathPhases.BREAK).toBe(0);
    expect(summary.deaths.total).toBe(0);
    expect(summary.deaths.zones.find((z) => z.zone === "snake")?.total).toBe(0);
  });

  it("расхождение с капитаном считается только там, где капитан дельту поставил", () => {
    // Отсутствие ответа — это не согласие: пойнты без капитанской дельты
    // не должны разбавлять статистику расхождений.
    const summary = summaryOf([
      point({ deltaOtbMismatch: true }),
      point({ deltaOtbMismatch: false }),
      point({ deltaOtbMismatch: null }),
    ]);

    expect(summary.captainMismatch).toEqual({ compared: 2, mismatched: 1 });
  });

  it("пустое событие не падает и не выдумывает проценты", () => {
    const summary = buildEventSummary({ games: [] });

    expect(summary.coverage).toEqual({
      points: 0,
      marked: 0,
      withReflections: 0,
      withCaptainReport: 0,
      squadSize: 0,
      withFullSquad: 0,
    });
    expect(summary.deltaOtb).toEqual([]);
    expect(summary.players).toEqual([]);
    expect(summary.overall.winRate).toBeNull();
    expect(summary.deaths).toEqual({
      total: 0,
      byPhase: { BREAK: 0, COVER: 0, ROTATION: 0 },
      zones: [
        { zone: "snake", total: 0, byPhase: { BREAK: 0, COVER: 0, ROTATION: 0 } },
        { zone: "center", total: 0, byPhase: { BREAK: 0, COVER: 0, ROTATION: 0 } },
        { zone: "envelope", total: 0, byPhase: { BREAK: 0, COVER: 0, ROTATION: 0 } },
      ],
    });
    expect(summary.equalSquads.lines.every((line) => line.ours.winRate === null)).toBe(true);
  });

  it("пойнт с неполной пятёркой форм в дельту не идёт", () => {
    // Главный подвох: дельта выводится из форм, и при одной заполненной форме
    // (1 килл, 1 смерть) она равна нулю — пойнт уехал бы в «равные составы»
    // и потянул за собой всю инициативу. Обычный состав берётся из самих данных.
    const squad = (over: Partial<Reflection> = {}) =>
      [1, 2, 3, 4, 5].map((n) => reflection({ userId: `u${n}`, nickname: `p${n}`, ...over }));

    const summary = summaryOf([
      point({ deltaOtb: 0, result: "WIN", reflections: squad() }),
      point({ deltaOtb: 0, result: "WIN", reflections: squad() }),
      point({ deltaOtb: 0, result: "WIN", reflections: squad() }),
      // Заполнил один человек: формально дельта 0, фактически данных нет.
      point({
        deltaOtb: 0,
        result: "LOSS",
        captainReport: captainReport({ initiative: { snake: -1, center: -1, envelope: -1 } }),
        reflections: [reflection()],
      }),
    ]);

    expect(summary.coverage.squadSize).toBe(5);
    expect(summary.coverage.withReflections).toBe(4);
    expect(summary.coverage.withFullSquad).toBe(3);
    expect(summary.equalSquads.points).toBe(3);
    expect(summary.deltaOtb).toEqual([{ delta: 0, wins: 3, losses: 0, total: 3, winRate: 100 }]);
    // Инициатива с недозаполненного пойнта не должна была просочиться.
    expect(summary.equalSquads.lines.every((line) => line.theirs.total === 0)).toBe(true);
  });

  it("winrate турнира считается по всем размеченным пойнтам, а не только по заполненным", () => {
    // Якорь, с которым сравниваются проценты блоков: он не зависит от того,
    // насколько прилежно команда заполняла формы.
    const summary = summaryOf([
      point({ result: "WIN", reflections: [] }),
      point({ result: "LOSS", reflections: [] }),
      point({ result: "WIN" }),
      point({ result: null }),
    ]);

    expect(summary.overall).toEqual({ wins: 2, losses: 1, total: 3, winRate: 67 });
  });

  it("выбивания раскладываются по зонам и фазам, укрытие без зоны остаётся в итоге", () => {
    // 51 фигура на 75 выбиваний за турнир даёт 1-2 наблюдения на фигуру,
    // поэтому агрегат идёт по трём зонам. Смерти без укрытия не выбрасываются:
    // иначе сумма по матрице разойдётся с общим числом выбиваний.
    const summary = buildEventSummary({
      positionZones: { "snake.1.near": "snake", "grid.300.far": "center" },
      games: [
        {
          points: [
            point({
              reflections: [
                reflection({ exitReason: "HIT", penaltyKind: null, exitPhase: "BREAK", exitPositionId: "snake.1.near" }),
                reflection({ userId: "u2", exitReason: "HIT", penaltyKind: null, exitPhase: "COVER", exitPositionId: "grid.300.far" }),
                reflection({ userId: "u3", exitReason: "HIT", penaltyKind: null, exitPhase: "COVER", exitPositionId: null }),
              ],
            }),
          ],
        },
      ],
    });

    expect(summary.deaths.total).toBe(3);
    expect(summary.deaths.byPhase).toEqual({ BREAK: 1, COVER: 2, ROTATION: 0 });
    expect(summary.deaths.zones.find((zone) => zone.zone === "snake")).toEqual({
      zone: "snake",
      total: 1,
      byPhase: { BREAK: 1, COVER: 0, ROTATION: 0 },
    });
    expect(summary.deaths.zones.find((zone) => zone.zone === "center")?.total).toBe(1);
    expect(summary.deaths.zones.find((zone) => zone.zone === "envelope")?.total).toBe(0);
  });
});
