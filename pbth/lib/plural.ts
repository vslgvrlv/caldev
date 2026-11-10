// Склонение по числу — один помощник на весь фронт: 1 участник, 2 участника,
// 5 участников, 11 участников, 21 участник.

export function pluralRu(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.trunc(Number(n) || 0));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** «1 участник», «5 участников». */
export function countLabel(n: number, one: string, few: string, many: string): string {
  return `${n} ${pluralRu(n, one, few, many)}`;
}
