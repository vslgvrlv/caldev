import { Role, type TeamContext } from '../types';
import { pluralRu } from './plural';
import { eventCreateAccess } from './event-create-access';

// Фильтр команд на «Моё» и в «Календаре»: какие команды показывают свои события.
//
// Храним множество ВЫКЛЮЧЕННЫХ команд: новая команда, в которую человек
// вступил позже, появляется включённой сама. Множество живёт на устройстве
// отдельно для каждого человека (localStorage, ключ с id пользователя);
// команды, которых у человека больше нет, из него вычищаются.
// Фильтруются только свои команды (членство). Команда, куда владелец
// платформы зашёл как владелец, в фильтр не входит и не скрывается.

export type HiddenTeams = ReadonlySet<string>;

const KEY_PREFIX = 'pbth.teamFilter.v1:';

export function filterKey(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

/** Свои команды, по которым работает фильтр: без команд владельца платформы без членства. */
export function filterTeams(teams: TeamContext[]): TeamContext[] {
  return teams.filter((t) => t.via !== 'owner');
}

export function isTeamShown(hidden: HiddenTeams, teamId: string): boolean {
  return !hidden.has(String(teamId));
}

export function toggleTeam(hidden: HiddenTeams, teamId: string): Set<string> {
  return setTeamShown(hidden, teamId, hidden.has(teamId)) as Set<string>;
}

/** Явное состояние (выключатель в шторке). Состояние уже такое — то же множество. */
export function setTeamShown(hidden: HiddenTeams, teamId: string, shown: boolean): HiddenTeams {
  const id = String(teamId);
  if (shown !== hidden.has(id)) return hidden;
  const next = new Set(hidden);
  if (shown) next.delete(id);
  else next.add(id);
  return next;
}

export function showAll(): Set<string> {
  return new Set();
}

/** Показать только перечисленные свои команды, остальные свои — выключить. */
export function showOnly(teams: TeamContext[], keep: string[]): Set<string> {
  const keepSet = new Set(keep.map(String));
  return new Set(filterTeams(teams).map((t) => t.teamId).filter((id) => !keepSet.has(id)));
}

/** «Играю»: команды, где я на поле — капитан или игрок. Тренерство не входит. */
export function playingTeamIds(teams: TeamContext[]): string[] {
  return filterTeams(teams)
    .filter((t) => t.role === Role.CAPTAIN || t.role === Role.PLAYER || t.role === Role.ADMIN)
    .map((t) => t.teamId);
}

export type QuickPick = 'all' | 'playing' | '';

/** Какой сегмент быстрого выбора отмечен: набор совпадает с «Все», с «Играю» или ручной. */
export function quickPick(hidden: HiddenTeams, teams: TeamContext[]): QuickPick {
  const own = filterTeams(teams).map((t) => t.teamId);
  const hiddenOwn = own.filter((id) => hidden.has(id));
  if (hiddenOwn.length === 0) return 'all';
  const playing = new Set(playingTeamIds(teams));
  const expected = own.filter((id) => !playing.has(id));
  if (expected.length === hiddenOwn.length && expected.every((id) => hidden.has(id))) return 'playing';
  return '';
}

/** Выключены все свои команды (и они есть): вместо ленты — «Все команды скрыты». */
export function allHidden(hidden: HiddenTeams, teams: TeamContext[]): boolean {
  const own = filterTeams(teams);
  return own.length > 0 && own.every((t) => hidden.has(t.teamId));
}

/** Вычистить команды, которых у человека больше нет. Пока список не пришёл (пустой) — не трогаем. */
export function pruneHidden(hidden: HiddenTeams, teams: TeamContext[]): HiddenTeams {
  if (teams.length === 0 || hidden.size === 0) return hidden;
  const ids = new Set(teams.map((t) => t.teamId));
  const kept = [...hidden].filter((id) => ids.has(id));
  return kept.length === hidden.size ? hidden : new Set(kept);
}

export function serializeHidden(hidden: HiddenTeams): string {
  return JSON.stringify([...hidden].sort());
}

/** Разбор из хранилища; всё непонятное — «показаны все». */
export function parseHidden(raw: string | null | undefined): Set<string> {
  if (!raw) return new Set();
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return new Set();
    return new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0));
  } catch {
    return new Set();
  }
}

export type FilterGroup = { id: 'captain' | 'trainer' | 'player'; title: string; teams: TeamContext[] };

/** Группы шторки «Команды» по моей роли; пустые не показываем. */
export function filterGroups(teams: TeamContext[]): FilterGroup[] {
  const own = filterTeams(teams);
  const groups: FilterGroup[] = [
    { id: 'captain', title: 'Я капитан', teams: own.filter((t) => t.role === Role.CAPTAIN || t.role === Role.ADMIN) },
    { id: 'trainer', title: 'Я тренер', teams: own.filter((t) => t.role === Role.TRAINER) },
    { id: 'player', title: 'Играю', teams: own.filter((t) => t.role === Role.PLAYER) },
  ];
  return groups.filter((g) => g.teams.length > 0);
}

/** «Гроза: 2 заявки ждут ответа». */
export function requestsNoticeText(teamName: string, count: number): string {
  const noun = pluralRu(count, 'заявка', 'заявки', 'заявок');
  const verb = pluralRu(count, 'ждёт', 'ждут', 'ждут');
  return `${teamName}: ${count} ${noun} ${verb} ответа`;
}

/** Свои команды, где я решаю заявки (капитан, тренер): по ним спрашиваем число заявок. */
export function requestTeams(teams: TeamContext[]): TeamContext[] {
  return filterTeams(teams).filter((t) => t.role === Role.CAPTAIN || t.role === Role.TRAINER || t.role === Role.ADMIN);
}

export type RequestsNotice = { team: TeamContext; count: number; text: string };

/** Строки «<Команда>: N заявок ждут ответа» — по одной на включённую команду, где заявки есть; порядок — как у команд. */
export function requestsNotices(teams: TeamContext[], counts: Record<string, number>, hidden: HiddenTeams): RequestsNotice[] {
  return requestTeams(teams)
    .filter((t) => isTeamShown(hidden, t.teamId) && (counts[t.teamId] ?? 0) > 0)
    .map((t) => ({ team: t, count: counts[t.teamId], text: requestsNoticeText(t.teamName, counts[t.teamId]) }));
}

/** Свои команды, где я могу создавать события (капитан, тренер). */
export function creatableTeams(teams: TeamContext[]): TeamContext[] {
  return filterTeams(teams).filter((t) => eventCreateAccess(t.role).canCreate);
}

export type PlusAction = { kind: 'pick'; teams: TeamContext[] } | { kind: 'go'; team: TeamContext } | { kind: 'none' };

/** «Плюс» на «Моё» и в «Календаре»: больше одной команды — спросить, одна — сразу форма. */
export function plusAction(teams: TeamContext[]): PlusAction {
  const list = creatableTeams(teams);
  if (list.length > 1) return { kind: 'pick', teams: list };
  if (list.length === 1) return { kind: 'go', team: list[0] };
  return { kind: 'none' };
}
