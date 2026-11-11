import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { InviteFacts } from '../../components/track1/InviteFrame';
import { inviterName, inviterSubText, membersParts, nextEventLines, requestWaitingParts } from '../../lib/invite-copy';

// Факты о команде на экранах приглашения: тексты, склонение, обратная
// совместимость со старым ответом сервера.

const NOW = new Date('2026-11-11T10:00:00.000Z');

describe('подписи фактов', () => {
  it('кто зовёт: роль зовущего и роль приглашения', () => {
    expect(inviterSubText('CAPTAIN', 'PLAYER')).toBe('Капитан · зовёт тебя игроком');
    expect(inviterSubText('CAPTAIN', 'TRAINER')).toBe('Капитан · зовёт тебя тренером');
    expect(inviterSubText(null, 'PLAYER')).toBe('Зовёт тебя игроком');
    expect(inviterSubText(null, 'CAPTAIN')).toBe('Зовёт тебя капитаном');
  });

  it('сколько людей: склонение', () => {
    const text = (n: number) => {
      const p = membersParts(n)!;
      return p.strong + p.rest;
    };
    expect(text(1)).toBe('1 человек в команде');
    expect(text(2)).toBe('2 человека в команде');
    expect(text(5)).toBe('5 человек в команде');
    expect(text(12)).toBe('12 человек в команде');
    expect(text(22)).toBe('22 человека в команде');
    expect(membersParts(0)).toBeNull();
    expect(membersParts(undefined)).toBeNull();
  });

  it('ближайшее событие: когда и что', () => {
    const event = { startsAt: '2026-11-12T16:00:00.000Z', type: 'TRAINING', title: 'Тренировка', location: 'Арена', timezone: 'Europe/Moscow' };
    expect(nextEventLines(event, NOW)).toEqual({ when: 'Завтра в 19:00', details: 'Тренировка · «Арена»' });
    expect(nextEventLines({ ...event, location: null }, NOW)?.details).toBe('Тренировка');
    expect(nextEventLines({ ...event, type: 'FRIENDLY_MATCH', title: 'Спарринг с South Crew', location: null }, NOW)?.details).toBe(
      'Спарринг · Спарринг с South Crew',
    );
    expect(nextEventLines(null, NOW)).toBeNull();
  });

  it('заявка у капитана: имя первым словом, без имени — «Капитан»', () => {
    expect(requestWaitingParts('Денис Голев')).toEqual({ name: 'Денис', rest: ' увидит заявку и ответит. Мы пришлём уведомление.' });
    expect(requestWaitingParts(undefined).name).toBeNull();
    expect(requestWaitingParts(' ').rest).toMatch(/^Капитан увидит/);
  });

  it('имя зовущего: пустое имя — нет имени', () => {
    expect(inviterName({ inviter: { name: ' Денис Голев ' } })).toBe('Денис Голев');
    expect(inviterName({ inviter: { name: '' } })).toBeNull();
    expect(inviterName({})).toBeNull();
  });
});

describe('блок фактов', () => {
  const render = (facts: Parameters<typeof InviteFacts>[0]['facts']) =>
    renderToStaticMarkup(React.createElement(InviteFacts, { facts, inviterRole: 'CAPTAIN', invitedRole: 'PLAYER' }));

  it('с полями: три строки', () => {
    const html = render({
      inviter: { name: 'Денис Голев' },
      membersCount: 12,
      nextEvent: { startsAt: '2099-01-01T16:00:00.000Z', type: 'TRAINING', title: 'Тренировка', location: 'Арена', timezone: 'Europe/Moscow' },
    });
    expect(html).toContain('Денис Голев');
    expect(html).toContain('Капитан · зовёт тебя игроком');
    expect(html).toContain('12 человек');
    expect(html).toContain('Тренировка · «Арена»');
  });

  it('старый ответ без новых полей: блока нет, ничего не падает', () => {
    expect(render({})).toBe('');
    expect(render(null)).toBe('');
    expect(render({ inviter: null, membersCount: undefined, nextEvent: null })).toBe('');
  });

  it('часть полей: только те строки, что пришли', () => {
    const html = render({ membersCount: 3 });
    expect(html).toContain('3 человека');
    expect(html).not.toContain('зовёт тебя');
  });
});
