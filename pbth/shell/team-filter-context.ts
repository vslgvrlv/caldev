import React, { createContext, useContext } from 'react';
import type { TeamContext } from '../types';
import {
  allHidden as allHiddenOf,
  filterKey,
  filterTeams,
  isTeamShown,
  parseHidden,
  pruneHidden,
  serializeHidden,
  setTeamShown,
  type HiddenTeams,
} from '../lib/team-filter';

// Состояние фильтра команд для «Моё» и «Календаря»: одно на оболочку,
// поэтому шапка, шторка и оба экрана видят одно и то же. Хранится на
// устройстве под ключом человека (lib/team-filter.ts).

export type TeamFilterState = {
  hidden: HiddenTeams;
  /** Свои команды, которые можно включать и выключать. */
  teams: TeamContext[];
  isShown: (teamId: string) => boolean;
  setShown: (teamId: string, shown: boolean) => void;
  toggle: (teamId: string) => void;
  setHidden: (next: HiddenTeams) => void;
  showAll: () => void;
  /** Выключены все свои команды. */
  allHidden: boolean;
};

const EMPTY: HiddenTeams = new Set();

const ALL_SHOWN: TeamFilterState = {
  hidden: EMPTY,
  teams: [],
  isShown: () => true,
  setShown: () => {},
  toggle: () => {},
  setHidden: () => {},
  showAll: () => {},
  allHidden: false,
};

export const TeamFilterContext = createContext<TeamFilterState>(ALL_SHOWN);

/** Фильтр команд оболочки. Вне оболочки — «показаны все». */
export const useTeamFilter = () => useContext(TeamFilterContext);

/**
 * Число ждущих заявок по своим командам, где я капитан или тренер. Считает
 * оболочка (`useTeamRequestCounts`), а не экран «Моё»: переходы между «Моё» и
 * «Календарём» не повторяют запросы.
 */
export const RequestCountsContext = createContext<Record<string, number>>({});
export const useRequestCounts = () => useContext(RequestCountsContext);

function readStored(userId: string | null | undefined): HiddenTeams {
  if (!userId || typeof window === 'undefined') return EMPTY;
  try {
    return parseHidden(window.localStorage.getItem(filterKey(userId)));
  } catch {
    return EMPTY;
  }
}

function writeStored(userId: string | null | undefined, hidden: HiddenTeams) {
  if (!userId || typeof window === 'undefined') return;
  try {
    if (hidden.size === 0) window.localStorage.removeItem(filterKey(userId));
    else window.localStorage.setItem(filterKey(userId), serializeHidden(hidden));
  } catch {
    // Хранилище недоступно (приватный режим): фильтр работает до перезагрузки.
  }
}

/** Состояние фильтра для провайдера в оболочке. */
export function useTeamFilterState(userId: string | null | undefined, teams: TeamContext[]): TeamFilterState {
  const [state, setState] = React.useState(() => ({ userId, hidden: readStored(userId) }));
  // Сменился человек — берём его набор.
  const current = state.userId === userId ? state.hidden : readStored(userId);
  if (state.userId !== userId) setState({ userId, hidden: current });

  // Команды, которых больше нет, вычищаем и из памяти, и из хранилища.
  React.useEffect(() => {
    const pruned = pruneHidden(current, teams);
    if (pruned !== current) {
      setState({ userId, hidden: pruned });
      writeStored(userId, pruned);
    }
  }, [current, teams, userId]);

  // Через функцию от прежнего состояния: два быстрых тапа подряд не теряют первый.
  const update = React.useCallback(
    (fn: (prev: HiddenTeams) => HiddenTeams) => {
      setState((prev) => {
        const base = prev.userId === userId ? prev.hidden : readStored(userId);
        const next = fn(base);
        if (next === base && prev.userId === userId) return prev;
        writeStored(userId, next);
        return { userId, hidden: next };
      });
    },
    [userId],
  );

  return React.useMemo(() => {
    const own = filterTeams(teams);
    return {
      hidden: current,
      teams: own,
      isShown: (teamId: string) => isTeamShown(current, teamId),
      setShown: (teamId: string, shown: boolean) => update((prev) => setTeamShown(prev, teamId, shown)),
      toggle: (teamId: string) => update((prev) => setTeamShown(prev, teamId, !isTeamShown(prev, teamId))),
      setHidden: (next: HiddenTeams) => update(() => next),
      showAll: () => update(() => EMPTY),
      allHidden: allHiddenOf(current, teams),
    };
  }, [current, teams, update]);
}
