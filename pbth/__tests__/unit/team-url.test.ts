import { describe, expect, it } from 'vitest';
import {
  eventPath,
  findTeamByCode,
  isAppDeepPath,
  matchesTeamCode,
  memberPath,
  parseTeamPath,
  resolveEntryTeam,
  switchTeamPath,
  teamCodeOf,
  teamPath,
} from '../../lib/team-url';

// Команда живёт в адресе (ревизия 11.11.2026, боль Б2): у экранов есть
// ссылки, «Назад» и перезагрузка работают, смена команды сохраняет раздел.
const alpha = { teamId: '11111111-1111-1111-1111-111111111111', shortCode: 'DTA' };
const beta = { teamId: '22222222-2222-2222-2222-222222222222', shortCode: 'DTB' };
const noCode = { teamId: '33333333-3333-3333-3333-333333333333', shortCode: '' };

describe('адреса команды', () => {
  it('код команды — короткий код в нижнем регистре, без кода — id', () => {
    expect(teamCodeOf(alpha)).toBe('dta');
    expect(teamCodeOf(noCode)).toBe(noCode.teamId);
  });

  it('строит адреса разделов, события и карточки игрока', () => {
    expect(teamPath('DTA')).toBe('/t/dta');
    expect(teamPath('dta', 'calendar')).toBe('/t/dta/calendar');
    expect(eventPath('dta', 'e-1')).toBe('/t/dta/event/e-1');
    expect(memberPath('dta', 'u-7')).toBe('/t/dta/roster/u-7');
  });

  it('разбирает адрес команды', () => {
    expect(parseTeamPath('/t/dta')).toEqual({ team: 'dta', section: '', rest: [] });
    expect(parseTeamPath('/t/DTA/')).toEqual({ team: 'dta', section: '', rest: [] });
    expect(parseTeamPath('/t/dta/event/e-1')).toEqual({ team: 'dta', section: 'event', rest: ['e-1'] });
    expect(parseTeamPath('/t/dta/roster/u-7?x=1')).toEqual({ team: 'dta', section: 'roster', rest: ['u-7'] });
    expect(parseTeamPath('/t/%D0%BA%D0%BE%D0%B4/money')).toEqual({ team: 'код', section: 'money', rest: [] });
  });

  it('чужие адреса не считаются адресом команды', () => {
    for (const path of ['/', '/app', '/me', '/t', '/t/', '/team/dta', '/admin/t/dta', '', null]) {
      expect(parseTeamPath(path as string), String(path)).toBeNull();
    }
  });

  it('находит команду по коду или id без учёта регистра', () => {
    expect(matchesTeamCode('dta', alpha)).toBe(true);
    expect(matchesTeamCode('DTA', alpha)).toBe(true);
    expect(matchesTeamCode(alpha.teamId.toUpperCase(), alpha)).toBe(true);
    expect(matchesTeamCode('dtb', alpha)).toBe(false);
    expect(matchesTeamCode('', alpha)).toBe(false);
    expect(findTeamByCode('dtb', [alpha, beta])).toBe(beta);
    expect(findTeamByCode('zzz', [alpha, beta])).toBeUndefined();
  });
});

describe('смена команды сохраняет раздел', () => {
  it('разделы переносятся как есть', () => {
    expect(switchTeamPath('/t/dta', 'dtb')).toBe('/t/dtb');
    expect(switchTeamPath('/t/dta/calendar', 'dtb')).toBe('/t/dtb/calendar');
    expect(switchTeamPath('/t/dta/money', 'dtb')).toBe('/t/dtb/money');
    expect(switchTeamPath('/t/dta/roster', 'dtb')).toBe('/t/dtb/roster');
    expect(switchTeamPath('/t/dta/requests', 'dtb')).toBe('/t/dtb/requests');
  });

  it('экран одной записи уходит на свой раздел', () => {
    expect(switchTeamPath('/t/dta/event/e-1', 'dtb')).toBe('/t/dtb');
    expect(switchTeamPath('/t/dta/roster/u-7', 'dtb')).toBe('/t/dtb/roster');
  });

  it('вне команды — на главную команды', () => {
    expect(switchTeamPath('/me', 'dtb')).toBe('/t/dtb');
  });
});

describe('вход /app ведёт в последнюю команду', () => {
  it('последняя команда устройства, если человек ещё в ней', () => {
    expect(resolveEntryTeam('dtb', [alpha, beta], { teamId: alpha.teamId, shortCode: 'DTA' })).toBe('dtb');
  });

  it('из последней команды исключили — активная по ответу сервера', () => {
    expect(resolveEntryTeam('old', [alpha, beta], { teamId: beta.teamId, shortCode: 'DTB' })).toBe('dtb');
  });

  it('ничего не известно — первая из списка; команд нет — null', () => {
    expect(resolveEntryTeam(null, [alpha, beta], null)).toBe('dta');
    expect(resolveEntryTeam(null, [], null)).toBeNull();
  });
});

describe('адреса, куда можно вернуть после входа', () => {
  it('экраны приложения', () => {
    for (const path of ['/t/dta', '/t/dta/event/e-1', '/me', '/teams', '/join/ABC123']) {
      expect(isAppDeepPath(path), path).toBe(true);
    }
  });

  it('остальное — нет', () => {
    for (const path of ['/', '/app', '/login', '/admin', '/support', '/t/', '/join/', null]) {
      expect(isAppDeepPath(path as string), String(path)).toBe(false);
    }
  });
});
