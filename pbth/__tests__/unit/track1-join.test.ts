import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { joinUrl, parseJoinCodeInput, type JoinRequest } from '../../api/track1';
import { JoinRequestStatusCard } from '../../components/track1/JoinRequestStatusCard';
import { resolvePostLoginAction } from '../../lib/post-login';
import track1Ext from '../../shell/ext/track1-requests';
import type { ShellExtContext } from '../../shell/extensions';
import { Role } from '../../types';

// Трек 1 «Вход и заявки»: что видит новичок по ссылке команды и кто видит
// заявки. Тексты проверяются так, как их читает человек.

const request = (patch: Partial<JoinRequest> = {}): JoinRequest => ({
  id: 'r1',
  status: 'PENDING',
  createdAt: '2026-11-11T10:00:00.000Z',
  decidedAt: null,
  team: { id: 't1', name: 'Дневной Дозор', shortCode: 'DD' },
  nextEvent: { startsAt: '2026-11-22T09:00:00.000Z', type: 'FRIENDLY_MATCH', timezone: 'Europe/Moscow' },
  ...patch,
});

describe('код команды из поля ввода', () => {
  it('принимает код в любом регистре, с пробелами и целую ссылку', () => {
    expect(parseJoinCodeInput('k7q3mp')).toBe('K7Q3MP');
    expect(parseJoinCodeInput(' K7Q 3MP ')).toBe('K7Q3MP');
    expect(parseJoinCodeInput('https://pbthub.ru/join/K7Q3MP')).toBe('K7Q3MP');
    expect(parseJoinCodeInput('абв')).toBeNull();
    expect(parseJoinCodeInput('')).toBeNull();
  });

  it('ссылка команды на этом сайте', () => {
    expect(joinUrl('https://pbthub.ru/', 'K7Q3MP')).toBe('https://pbthub.ru/join/K7Q3MP');
  });
});

describe('после входа по ссылке команды человек возвращается на неё', () => {
  it('/join/<код> — адрес приложения, а не /app', () => {
    expect(resolvePostLoginAction('/join/K7Q3MP')).toEqual({ kind: 'app', path: '/join/K7Q3MP' });
  });
});

describe('экран заявки', () => {
  it('ждёт: название команды, ближайшее событие (тип и время), без состава и денег', () => {
    const html = renderToStaticMarkup(React.createElement(JoinRequestStatusCard, { request: request() }));
    expect(html).toContain('Заявка у капитана');
    expect(html).toContain('Дневной Дозор');
    expect(html).toContain('Спарринг');
    expect(html).toContain('22 ноября');
    expect(html).not.toMatch(/₽|Состав|Баланс/);
  });

  it('старый ответ с названием и местом события: их на экране нет', () => {
    const old = { title: 'Закрытое собрание', startAt: '2026-11-22T09:00:00.000Z', location: 'https://maps.example/secret', timezone: 'Europe/Moscow' };
    const html = renderToStaticMarkup(
      React.createElement(JoinRequestStatusCard, { request: request({ nextEvent: old as unknown as JoinRequest['nextEvent'] }) }),
    );
    expect(html).toContain('22 ноября');
    expect(html).not.toContain('Закрытое собрание');
    expect(html).not.toContain('maps.example');
  });

  it('отказ — словами', () => {
    const html = renderToStaticMarkup(
      React.createElement(JoinRequestStatusCard, { request: request({ status: 'DECLINED', nextEvent: null }) }),
    );
    expect(html).toContain('Заявку отклонили');
    expect(html).toContain('Дневной Дозор');
  });
});

describe('заявки в шапке и меню команды', () => {
  const ctx = (role: Role): ShellExtContext => ({
    user: { id: 'u', name: 'U', nickname: 'u' } as any,
    team: { id: 't', name: 'T', shortCode: 'T', role, budget: 0 } as any,
    teamCode: 't',
    role,
    teams: [],
  });

  it('видят капитан и тренер, игрок — нет', () => {
    const item = track1Ext.teamMenu![0];
    const badge = track1Ext.headerBadges![0];
    expect(item.visible!(ctx(Role.CAPTAIN))).toBe(true);
    expect(item.visible!(ctx(Role.TRAINER))).toBe(true);
    expect(item.visible!(ctx(Role.PLAYER))).toBe(false);
    expect(badge.visible!(ctx(Role.PLAYER))).toBe(false);
    expect(item.to(ctx(Role.CAPTAIN))).toBe('/t/t/requests');
  });
});
