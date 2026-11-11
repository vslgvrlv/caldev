import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { InviteFacts } from '../../components/track1/InviteFrame';
import { membersParts, nextEventLines } from '../../lib/invite-copy';

// Факты о команде на экранах приглашения и событие в заявке: тексты,
// склонение, обратная совместимость со старым ответом сервера. Имени того, кто
// зовёт, нет: сервер его не отдаёт, а из старого ответа экран его не читает.

const NOW = new Date('2026-11-11T10:00:00.000Z');

describe('подписи фактов', () => {
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

  it('старый ответ заявки (startAt, title, location, без типа): время есть, названия и места нет', () => {
    const oldRequestEvent = { title: 'Закрытое собрание', startAt: '2026-11-12T16:00:00.000Z', location: 'https://maps.example/secret', timezone: 'Europe/Moscow' };
    expect(nextEventLines(oldRequestEvent, NOW)).toEqual({ when: 'Завтра в 19:00', details: '' });
  });

  it('дальше «завтра» — дата по поясу команды, а не браузера', () => {
    // 20 ноября 23:30 по Москве — это уже 21 ноября во Владивостоке.
    const startsAt = '2026-11-20T20:30:00.000Z';
    expect(nextEventLines({ startsAt, type: 'TRAINING', timezone: 'Europe/Moscow' }, NOW)?.when).toBe('20 ноября в 23:30');
    expect(nextEventLines({ startsAt, type: 'TRAINING', timezone: 'Asia/Vladivostok' }, NOW)?.when).toBe('21 ноября в 06:30');
  });
});

describe('блок фактов', () => {
  type Facts = Parameters<typeof InviteFacts>[0]['facts'];
  const render = (facts: Facts, children?: React.ReactNode) =>
    renderToStaticMarkup(React.createElement(InviteFacts, { facts }, children));

  it('с полями: две строки', () => {
    const html = render({
      membersCount: 12,
      nextEvent: { startsAt: '2099-01-01T16:00:00.000Z', type: 'TRAINING', timezone: 'Europe/Moscow' },
    });
    expect(html).toContain('12 человек');
    expect(html).toContain('1 января в 19:00');
    expect(html).toContain('Тренировка');
    expect(html).not.toContain('зовёт');
  });

  it('старый ответ с именем, названием и местом: на экране их нет', () => {
    const old = {
      inviter: { name: 'ivanpetrov' },
      membersCount: 3,
      nextEvent: { startsAt: '2099-01-01T16:00:00.000Z', type: 'TRAINING', title: 'Закрытое собрание', location: 'https://maps.example/secret', timezone: 'Europe/Moscow' },
    };
    const html = render(old as Facts);
    expect(html).toContain('3 человека');
    expect(html).toContain('Тренировка');
    expect(html).not.toContain('ivanpetrov');
    expect(html).not.toContain('Закрытое собрание');
    expect(html).not.toContain('maps.example');
  });

  it('старый ответ без новых полей: блока нет, ничего не падает', () => {
    expect(render({})).toBe('');
    expect(render(null)).toBe('');
    expect(render({ membersCount: undefined, nextEvent: null })).toBe('');
  });

  it('без фактов строка роли остаётся', () => {
    const html = render({}, React.createElement('span', null, 'Роль: игрок'));
    expect(html).toContain('Роль: игрок');
  });

  it('часть полей: только те строки, что пришли', () => {
    const html = render({ membersCount: 3 });
    expect(html).toContain('3 человека');
    expect(html).not.toContain('Тренировка');
  });
});
