// Дельта разбежки — центральная формула аналитики рефлексии (#89, спека §2.1).
//
// Считается ДЕЛЬТА, а не факт наших потерь. Прежняя формулировка «никого из наших
// не выбили на разбежке = большинство» была ошибкой: обоюдный отстрел нельзя
// схлопывать в «равные составы», 2 наших против 1 их — это меньшинство (−1).
//
// Величину храним/отдаём числом, а не enum из трёх значений: реализация +1 и +3 —
// разные задачи, «в большинстве выигрываем 60%» как метрика бессмысленна.

export type ReflectionPhase = "BREAK" | "COVER" | "ROTATION";

export type OtbInput = {
  // По одной записи на игрока, заполнившего форму гейма.
  reflections: Array<{ eliminated: boolean; deathPhase: ReflectionPhase | null }>;
  // Все киллы всех наших игроков за этот гейм, вперемешку — важна только фаза.
  kills: Array<{ phase: ReflectionPhase }>;
};

export type OtbResult = {
  ourOtbLosses: number;
  opponentOtbLosses: number;
  deltaOtb: number;
};

export function computeDeltaOtb(input: OtbInput): OtbResult {
  const ourOtbLosses = input.reflections.filter((r) => r.eliminated && r.deathPhase === "BREAK").length;
  const opponentOtbLosses = input.kills.filter((k) => k.phase === "BREAK").length;
  return { ourOtbLosses, opponentOtbLosses, deltaOtb: opponentOtbLosses - ourOtbLosses };
}

// Расхождение расчёта с мнением капитана — самостоятельная метрика (спека §6):
// одинаково ли команда видит игру. `null` = капитан дельту не проставил;
// это НЕ согласие, поэтому в false не схлопываем.
export function compareDeltaOtb(computed: number, captainClaim: number | null | undefined): boolean | null {
  if (captainClaim === null || captainClaim === undefined) return null;
  return captainClaim !== computed;
}
