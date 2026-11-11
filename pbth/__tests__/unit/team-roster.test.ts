import { describe, expect, it } from 'vitest';
import { PlayerStatus, Role, type TeamMember } from '../../types';
import {
  attendanceLabel,
  filterMembers,
  formatBalance,
  joinLinkHint,
  memberSub,
  rosterHeadline,
  sinceLabel,
  sortRoster,
} from '../../lib/team-roster';

const m = (id: string, role: Role, status = PlayerStatus.ACTIVE, rate = 0): TeamMember => ({
  id,
  name: `Имя ${id}`,
  nickname: `nick_${id}`,
  role,
  status,
  stats: { attendanceRate: rate, eventsAttended: 0, totalEvents: 0, mvpCount: 0, matchesPlayed: 0 },
});

describe('состав: порядок, подписи', () => {
  const list = [
    m('p1', Role.PLAYER),
    m('r1', Role.PLAYER, PlayerStatus.RESERVE),
    m('t1', Role.TRAINER),
    m('c1', Role.CAPTAIN),
    m('p2', Role.PLAYER, PlayerStatus.ACTIVE, 90),
  ];

  it('руководство, тренеры, в строю, остальные; внутри порядок сервера', () => {
    expect(sortRoster(list).map((x) => x.id)).toEqual(['c1', 't1', 'p1', 'p2', 'r1']);
  });

  it('посещаемость — по убыванию', () => {
    expect(sortRoster(list, 'attendance')[0].id).toBe('p2');
  });

  it('подпись: роль по-русски, статус только если не «в строю»', () => {
    expect(memberSub(list[0])).toBe('Игрок');
    expect(memberSub(list[1])).toBe('Игрок · Запас');
    expect(memberSub(m('x', Role.CAPTAIN, PlayerStatus.INJURED))).toBe('Капитан · Травма');
    expect(memberSub(list[3])).not.toMatch(/CAPTAIN|PLAYER/);
  });

  it('поиск по имени и нику', () => {
    expect(filterMembers(list, 'NICK_c1').map((x) => x.id)).toEqual(['c1']);
    expect(filterMembers(list, '  ')).toHaveLength(5);
    expect(filterMembers(list, 'нет такого')).toEqual([]);
  });

  it('заголовок со склонением и ролью', () => {
    expect(rosterHeadline(1, Role.PLAYER)).toBe('1 игрок · ты игрок');
    expect(rosterHeadline(12, Role.CAPTAIN)).toBe('12 игроков · ты капитан');
    expect(rosterHeadline(3, Role.ADMIN, 'owner')).toBe('3 игрока · ты владелец платформы');
  });

  it('посещаемость строкой', () => {
    const x = m('z', Role.PLAYER, PlayerStatus.ACTIVE, 84.6);
    x.stats = { ...x.stats!, eventsAttended: 11, totalEvents: 13 };
    expect(attendanceLabel(x)).toEqual({ percent: '85%', detail: '11 из 13' });
  });
});

describe('сумма и время заявки', () => {
  it('суммы с неразрывным пробелом и минусом', () => {
    expect(formatBalance(3000)).toBe('+3 000 ₽');
    expect(formatBalance(-1500)).toBe('−1 500 ₽');
    expect(formatBalance(0)).toBe('0 ₽');
    expect(formatBalance(undefined)).toBe('0 ₽');
  });

  it('когда пришла заявка', () => {
    const now = new Date('2026-11-11T12:00:00Z').getTime();
    const ago = (min: number) => new Date(now - min * 60000).toISOString();
    expect(sinceLabel(ago(0), now)).toBe('только что');
    expect(sinceLabel(ago(1), now)).toBe('1 минуту назад');
    expect(sinceLabel(ago(15), now)).toBe('15 минут назад');
    expect(sinceLabel(ago(60), now)).toBe('час назад');
    expect(sinceLabel(ago(180), now)).toBe('3 часа назад');
    expect(sinceLabel(ago(60 * 30), now)).toBe('вчера');
    expect(sinceLabel(ago(60 * 24 * 5), now)).toMatch(/ноября|ноябрь/);
  });

  it('подпись шторки ссылки от лица открывшего', () => {
    expect(joinLinkHint(false)).toContain('принимаешь ты или капитан');
    expect(joinLinkHint(true)).toContain('принимаешь ты или тренер');
  });
});
