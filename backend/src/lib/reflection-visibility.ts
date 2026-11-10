// Кто видит чьи рефлексии (решение Василия 10.11.2026, п. 10):
// свои видит игрок, чужие — капитан и тренер, команде — обезличенная сводка.
//
// Обезличенная сводка — всё, что считается по команде целиком: покрытие,
// winrate, дельта разбежки, комбинации, выбивания по зонам. Строки людей
// (заметки, самооценки, «как выбили») и личная статистика игроков остаются
// только свои.

export type ReflectionScope = "TEAM" | "OWN";

export function reflectionScopeForRole(role: string | null | undefined): ReflectionScope {
  return role === "CAPTAIN" || role === "TRAINER" || role === "ADMIN" ? "TEAM" : "OWN";
}

type WithUser = { userId: string };

export function keepOwnReflections<T extends WithUser>(reflections: T[], userId: string): T[] {
  return reflections.filter((r) => r.userId === userId);
}

type TableShape<R extends WithUser> = {
  games: Array<{ points: Array<{ reflections: R[] }> }>;
};

type SummaryShape = { players: WithUser[] };

/** Таблица события для игрока: агрегаты по пойнтам остаются, строки — только свои. */
export function anonymizeEventTable<R extends WithUser, T extends TableShape<R>>(table: T, userId: string): T {
  return {
    ...table,
    games: table.games.map((game) => ({
      ...game,
      points: game.points.map((point) => ({
        ...point,
        reflections: keepOwnReflections(point.reflections, userId),
      })),
    })),
  };
}

export function anonymizeEventSummary<S extends SummaryShape>(summary: S, userId: string): S {
  return { ...summary, players: summary.players.filter((p) => p.userId === userId) };
}
