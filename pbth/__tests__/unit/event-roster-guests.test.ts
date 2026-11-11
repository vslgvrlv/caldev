import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SlotGuest } from '../../api/track4';
import { RosterBlock } from '../../components/event/RosterBlock';
import { buildRoster, type EventAttendee } from '../../lib/event-view';

const person = (userId: string, extra: Partial<EventAttendee> = {}): EventAttendee =>
  ({ userId, name: `Игрок ${userId}`, nickname: userId, avatar: null, role: 'PLAYER', rsvpStatus: 'CONFIRMED', memberStatus: 'ACTIVE', ...extra }) as EventAttendee;

const guest = (userId: string, paid: boolean): SlotGuest => ({ userId, name: `Гость ${userId}`, nickname: userId, avatar: null, paid, price: 1000, bookedAt: '' });

const render = (props: Partial<React.ComponentProps<typeof RosterBlock>> = {}) =>
  renderToStaticMarkup(
    React.createElement(RosterBlock, {
      roster: buildRoster({
        attendees: [...['1', '2', '3', '4', '5', '6'].map((id) => person(id)), person('7', { rsvpStatus: 'UNANSWERED' }), person('8', { rsvpStatus: 'DECLINED' })],
        maxAttendees: 8,
      }),
      loading: false,
      onPerson: () => {},
      ...props,
    }),
  );

describe('состав события: приглашённые гости', () => {
  it('гости стоят после пятёрок, до свободных мест и свёрнутых «Не ответили» и «Не идут»', () => {
    const html = render({ guests: [guest('g1', true), guest('g2', false)] });
    const at = (text: string) => html.indexOf(text);
    expect(at('Вторая пятёрка')).toBeGreaterThan(-1);
    expect(at('Гости')).toBeGreaterThan(at('Вторая пятёрка'));
    expect(at('Гость g1')).toBeGreaterThan(at('Гости'));
    expect(at('Свободно')).toBeGreaterThan(at('Гость g2'));
    expect(at('Не ответили')).toBeGreaterThan(at('Свободно'));
    expect(at('Не идут')).toBeGreaterThan(at('Не ответили'));
    expect(html).toContain('гость · оплатил');
    expect(html).toContain('гость · не оплатил');
  });

  it('без гостей группы нет, свободные места на прежнем месте', () => {
    const html = render();
    expect(html).not.toContain('Гости');
    expect(html.indexOf('Свободно')).toBeGreaterThan(html.indexOf('Вторая пятёрка'));
  });

  it('«Снять» только у того, кому передан обработчик; гости в счётчик «Идут» не входят', () => {
    const guests = [guest('g1', true)];
    expect(render({ guests })).not.toContain('Снять Гость g1');
    expect(render({ guests, onRemoveGuest: () => {}, onGuestPaid: () => {} })).toContain('Снять Гость g1');
    expect(render({ guests })).toContain('Идут 6 из 8');
  });
});
