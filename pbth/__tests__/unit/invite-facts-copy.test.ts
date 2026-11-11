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

  it('ближайшее событие: когда и тип, без названия и места', () => {
    const event = { startsAt: '2026-11-12T16:00:00.000Z', type: 'TRAINING', timezone: 'Europe/Moscow' };
    expect(nextEventLines(event, NOW)).toEqual({ when: 'Завтра в 19:00', details: 'Тренировка' });
    expect(nextEventLines({ ...event, type: 'FRIENDLY_MATCH' }, NOW)?.details).toBe('Спарринг');
    expect(nextEventLines({ ...event, type: 'TOURNAMENT' }, NOW)?.details).toBe('Турнир');
    expect(nextEventLines({ ...event, type: 'CHAMPIONSHIP' }, NOW)?.details).toBe('Чемпионат');
    expect(nextEventLines({ ...event, type: 'НЕИЗВЕСТНО' }, NOW)?.details).toBe('');
    expect(nextEventLines(null, NOW)).toBeNull();
    expect(nextEventLines({ ...event, startsAt: 'не дата' }, NOW)).toBeNull();
  });

  it('старый ответ с названием и местом: они не показываются', () => {
    const old = { startsAt: '2026-11-12T16:00:00.000Z', type: 'TRAINING', title: 'Закрытое собрание', location: 'https://maps.example/secret', timezone: 'Europe/Moscow' };
    expect(nextEventLines(old, NOW)).toEqual({ when: 'Завтра в 19:00', details: 'Тренировка' });
  });

  it('дальше «завтра» — дата по поясу команды, а не браузера', () => {
    // 20 ноября 23:30 по Москве — это уже 21 ноября во Владивостоке.
    const startsAt = '2026-11-20T20:30:00.000Z';
    expect(nextEventLines({ startsAt, type: 'TRAINING', timezone: 'Europe/Moscow' }, NOW)?.when).toBe('20 ноября в 23:30');
    expect(nextEventLines({ startsAt, type: 'TRAINING', timezone: 'Asia/Vladivostok' }, NOW)?.when).toBe('21 ноября в 06:30');
  });

  it('заявка у капитана: имя как пришло (сервер уже отдаёт первое имя), без имени — «Капитан»', () => {
    expect(requestWaitingParts('Денис')).toEqual({ name: 'Денис', rest: ' увидит заявку и ответит. Мы пришлём уведомление.' });
    expect(requestWaitingParts(' Анна-Мария ').name).toBe('Анна-Мария');
    expect(requestWaitingParts(undefined).name).toBeNull();
    expect(requestWaitingParts(null).name).toBeNull();
    expect(requestWaitingParts(' ').rest).toMatch(/^Капитан увидит/);
  });

  it('имя зовущего: пустое имя — нет имени', () => {
    expect(inviterName({ inviter: { name: ' Денис ' } })).toBe('Денис');
    expect(inviterName({ inviter: null })).toBeNull();
    expect(inviterName({ inviter: { name: '' } })).toBeNull();
    expect(inviterName({})).toBeNull();
  });
});

describe('блок фактов', () => {
  const render = (facts: Parameters<typeof InviteFacts>[0]['facts']) =>
    renderToStaticMarkup(React.createElement(InviteFacts, { facts, inviterRole: 'CAPTAIN', invitedRole: 'PLAYER' }));

  it('с полями: три строки', () => {
    const html = render({
      inviter: { name: 'Денис' },
      membersCount: 12,
      nextEvent: { startsAt: '2099-01-01T16:00:00.000Z', type: 'TRAINING', timezone: 'Europe/Moscow' },
    });
    expect(html).toContain('Денис');
    expect(html).toContain('Капитан · зовёт тебя игроком');
    expect(html).toContain('12 человек');
    expect(html).toContain('1 января в 19:00');
    expect(html).toContain('Тренировка');
  });

  it('старый ответ с названием и местом события: их на экране нет', () => {
    const old = { startsAt: '2099-01-01T16:00:00.000Z', type: 'TRAINING', title: 'Закрытое собрание', location: 'https://maps.example/secret', timezone: 'Europe/Moscow' };
    const html = render({ inviter: { name: 'Денис' }, membersCount: 3, nextEvent: old });
    expect(html).toContain('Тренировка');
    expect(html).not.toContain('Закрытое собрание');
    expect(html).not.toContain('maps.example');
  });

  it('inviter: null — строки «кто зовёт» нет, остальное на месте', () => {
    const html = render({ inviter: null, membersCount: 3, nextEvent: null });
    expect(html).toContain('3 человека');
    expect(html).not.toContain('зовёт тебя');
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
