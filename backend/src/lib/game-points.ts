// Пойнты гейма выводятся из счёта: «4:3» = 4 победных + 3 проигранных = 7
// пойнтов. Вынесено из роутов, потому что это правило домена и его нужно
// покрывать тестами: счёт вводится руками и приходит в произвольном виде.

export type ParsedScore = { our: number; opponent: number; total: number };

// Разумный потолок: в пейнтболе матч до 5–7 побед, 30 пойнтов — заведомо
// опечатка вроде «40:30». Лучше не показать пойнты, чем сгенерировать сотни.
const MAX_POINTS = 30;

// Разделителем пишут и двоеточие, и дефис, и тире — счёт вводится вручную.
const SCORE_RE = /^\s*(\d{1,2})\s*[:\-–—]\s*(\d{1,2})\s*$/;

export function parseScore(score: string | null | undefined): ParsedScore | null {
  if (!score) return null;
  const match = SCORE_RE.exec(score);
  if (!match) return null;

  const our = Number(match[1]);
  const opponent = Number(match[2]);
  const total = our + opponent;
  if (total === 0 || total > MAX_POINTS) return null;

  return { our, opponent, total };
}

// Сколько пойнтов ещё не размечено и сходится ли разметка со счётом.
// Порядок побед из счёта не выводится — его знает только человек, поэтому
// разметка ручная, а это её проверка.
export function checkPointResults(
  score: ParsedScore,
  results: Array<"WIN" | "LOSS" | null>
): { wins: number; losses: number; unmarked: number; matchesScore: boolean } {
  const wins = results.filter((r) => r === "WIN").length;
  const losses = results.filter((r) => r === "LOSS").length;
  const unmarked = results.filter((r) => r === null).length;
  return {
    wins,
    losses,
    unmarked,
    matchesScore: unmarked === 0 && wins === score.our && losses === score.opponent,
  };
}
