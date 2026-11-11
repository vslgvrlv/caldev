import { PlayerStatus, Role, type TeamMember } from '../types';
import { playerStatusLabel, roleLabel } from './labels';
import { countLabel, pluralRu } from './plural';

// Чистая логика экранов состава, карточки игрока и заявок: порядок строк,
// подписи, сумма, «когда пришла заявка». Отрисовка — в views/TeamView.tsx и
// соседних экранах.

export type RosterMode = 'roster' | 'attendance';

const NBSP = '\u00a0';
const RUB = `${NBSP}\u20bd`;

function rank(member: TeamMember): number {
  if (member.role === Role.ADMIN || member.role === Role.CAPTAIN) return 0;
  if (member.role === Role.TRAINER) return 1;
  if (member.status === PlayerStatus.ACTIVE) return 2;
  return 3;
}

/** Поиск по имени и нику без учёта регистра. */
export function filterMembers(members: TeamMember[], term: string): TeamMember[] {
  const needle = term.trim().toLowerCase();
  if (!needle) return members;
  return members.filter((m) => m.name.toLowerCase().includes(needle) || m.nickname.toLowerCase().includes(needle));
}

/**
 * Порядок строк: руководство, тренеры, игроки в строю, остальные; внутри — как
 * пришло с сервера. «Посещаемость» — по убыванию доли, как раньше на вкладке статистики.
 */
export function sortRoster(members: TeamMember[], mode: RosterMode = 'roster'): TeamMember[] {
  const indexed = members.map((member, index) => ({ member, index }));
  if (mode === 'attendance') {
    indexed.sort((a, b) => (b.member.stats?.attendanceRate || 0) - (a.member.stats?.attendanceRate || 0) || a.index - b.index);
  } else {
    indexed.sort((a, b) => rank(a.member) - rank(b.member) || a.index - b.index);
  }
  return indexed.map((x) => x.member);
}

/** Подпись под именем: роль по-русски и, если не «в строю», статус игрока. */
export function memberSub(member: TeamMember): string {
  const role = roleLabel(member.role);
  if (!member.status || member.status === PlayerStatus.ACTIVE) return role;
  return `${role} · ${playerStatusLabel(member.status)}`;
}

export function isLeader(member: TeamMember): boolean {
  return member.role === Role.ADMIN || member.role === Role.CAPTAIN;
}

/** «12 игроков · ты капитан». */
export function rosterHeadline(count: number, role: Role | string, via?: 'membership' | 'owner'): string {
  const who = via === 'owner' ? 'владелец платформы' : roleLabel(role).toLowerCase();
  return `${countLabel(count, 'игрок', 'игрока', 'игроков')} · ты ${who}`;
}

/** «85% · 11 из 13» для режима «Посещаемость». */
export function attendanceLabel(member: TeamMember): { percent: string; detail: string } {
  const s = member.stats;
  const rate = Math.round(s?.attendanceRate || 0);
  return { percent: `${rate}%`, detail: `${s?.eventsAttended ?? 0} из ${s?.totalEvents ?? 0}` };
}

/** «+3 000 ₽», «−1 500 ₽», «0 ₽»: неразрывные пробелы, настоящий минус. */
export function formatBalance(value: number | null | undefined): string {
  const n = Math.round(Number(value) || 0);
  const digits = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  if (n > 0) return `+${digits}${RUB}`;
  if (n < 0) return `\u2212${digits}${RUB}`;
  return `0${RUB}`;
}

/** Когда пришла заявка: «только что», «15 минут назад», «час назад», «вчера», «12 ноября». */
export function sinceLabel(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  const minutes = Math.max(0, Math.round((now - then) / 60000));
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} ${pluralRu(minutes, 'минуту', 'минуты', 'минут')} назад`;
  const hours = Math.round(minutes / 60);
  if (hours === 1) return 'час назад';
  if (hours < 24) return `${hours} ${pluralRu(hours, 'час', 'часа', 'часов')} назад`;
  const days = Math.floor((now - then) / 86400000);
  if (days <= 1) return 'вчера';
  return new Date(then).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

/** Подпись шторки ссылки команды: кто ещё принимает заявки. */
export function joinLinkHint(canRotate: boolean): string {
  return `По ней подают заявку, принимаешь ты или ${canRotate ? 'тренер' : 'капитан'}.`;
}
