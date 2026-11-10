// Адреса экранов команды (спека ревизии, «Контракты основы → Адреса экранов»).
//
// Команда живёт в адресе: `/t/<код>/<раздел>`. Код — короткий код команды в
// нижнем регистре; если кода нет, запасной вариант — id команды. Сервер ищет
// команду без учёта регистра, поэтому сравниваем тоже без него.

export type TeamRef = { teamId: string; shortCode?: string | null };

/** Разделы команды, которые сохраняются при смене команды. */
export type TeamSection = '' | 'calendar' | 'money' | 'roster' | 'event' | 'new' | 'requests' | string;

export type ParsedTeamPath = {
  team: string;
  /** Первый сегмент после команды: '' — главная. */
  section: TeamSection;
  /** Остаток адреса после раздела (id события, id игрока). */
  rest: string[];
};

const LAST_TEAM_KEY = 'pbth:last-team';

/** Код команды для адреса. */
export function teamCodeOf(team: TeamRef): string {
  const code = String(team.shortCode || '').trim();
  return (code || String(team.teamId)).toLowerCase();
}

/** Подходит ли команда к коду из адреса (по коду или по id, без учёта регистра). */
export function matchesTeamCode(code: string | null | undefined, team: TeamRef | null | undefined): boolean {
  if (!code || !team) return false;
  const wanted = code.trim().toLowerCase();
  if (!wanted) return false;
  if (String(team.teamId).toLowerCase() === wanted) return true;
  return String(team.shortCode || '').trim().toLowerCase() === wanted;
}

export function findTeamByCode<T extends TeamRef>(code: string | null | undefined, teams: T[]): T | undefined {
  return teams.find((team) => matchesTeamCode(code, team));
}

/** `/t/<код>` или `/t/<код>/<раздел>/<...>`. */
export function teamPath(code: string, ...segments: Array<string | null | undefined>): string {
  const parts = [encodeURIComponent(code.toLowerCase())];
  for (const segment of segments) {
    if (segment === null || segment === undefined || segment === '') continue;
    parts.push(encodeURIComponent(segment));
  }
  return `/t/${parts.join('/')}`;
}

export function eventPath(code: string, eventId: string): string {
  return teamPath(code, 'event', eventId);
}

export function memberPath(code: string, userId: string): string {
  return teamPath(code, 'roster', userId);
}

/** Разбор `/t/:team/...`. Чужие адреса — null. */
export function parseTeamPath(pathname: string | null | undefined): ParsedTeamPath | null {
  const path = String(pathname || '').split(/[?#]/)[0];
  const match = /^\/t\/([^/]+)(?:\/(.*))?$/.exec(path);
  if (!match) return null;
  let team: string;
  try {
    team = decodeURIComponent(match[1]).toLowerCase();
  } catch {
    return null;
  }
  if (!team) return null;
  const tail = (match[2] || '').split('/').filter(Boolean).map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });
  const [section = '', ...rest] = tail;
  return { team, section, rest };
}

/**
 * Куда вести при смене команды: раздел сохраняется, а экран одной записи
 * (событие, карточка игрока) у другой команды не существует — уходим на
 * раздел, к которому он относится.
 */
export function switchTeamPath(pathname: string, nextCode: string): string {
  const parsed = parseTeamPath(pathname);
  if (!parsed) return teamPath(nextCode);
  const { section } = parsed;
  if (!section || section === 'event') return teamPath(nextCode);
  return teamPath(nextCode, section);
}

/** Адреса приложения, куда можно вернуть человека после входа. */
export function isAppDeepPath(path: string | null | undefined): boolean {
  const clean = String(path || '').split(/[?#]/)[0];
  return (
    /^\/t\/[^/]+(\/.*)?$/.test(clean) ||
    clean === '/me' ||
    clean === '/teams' ||
    /^\/join\/[^/]+$/.test(clean)
  );
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Последняя открытая команда на этом устройстве — вход `/app` ведёт к ней. */
export function rememberLastTeam(code: string): void {
  try {
    storage()?.setItem(LAST_TEAM_KEY, code.toLowerCase());
  } catch {
    // приватный режим: просто не запоминаем
  }
}

export function readLastTeam(): string | null {
  try {
    return storage()?.getItem(LAST_TEAM_KEY) || null;
  } catch {
    return null;
  }
}

export function forgetLastTeam(): void {
  try {
    storage()?.removeItem(LAST_TEAM_KEY);
  } catch {
    // ignore
  }
}

/**
 * Команда для входа `/app`: последняя на устройстве, если человек в ней ещё
 * состоит; иначе активная по ответу сервера; иначе первая из списка.
 */
export function resolveEntryTeam<T extends TeamRef>(
  lastTeam: string | null,
  teams: T[],
  activeTeam: TeamRef | null,
): string | null {
  const last = findTeamByCode(lastTeam, teams);
  if (last) return teamCodeOf(last);
  if (activeTeam) return teamCodeOf(activeTeam);
  if (teams[0]) return teamCodeOf(teams[0]);
  return null;
}
