import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OfflineBannerView } from '../../components/OfflineBanner';
import type { OutboxEntry } from '../../lib/outbox';

// Плашка — единственное место, где человек узнаёт, что рефлексия не доехала, и
// может с этим что-то сделать. Тесты читают разметку так, как её читает
// человек: по словам на экране.

const NOW = Date.UTC(2026, 10, 11, 12, 0, 0);

const stuck = (patch: Partial<OutboxEntry> = {}): OutboxEntry => ({
  id: 7,
  method: 'PUT',
  path: '/reflections/points/p1/mine',
  body: { note: 'не потеряй меня' },
  dedupeKey: 'reflection:p1',
  label: 'Рефлексия за пойнт',
  createdAt: NOW - 12 * 60_000,
  attempts: 1,
  lastStatus: 409,
  blocked: true,
  ...patch,
});

function render(props: Partial<React.ComponentProps<typeof OfflineBannerView>> = {}) {
  const noop = () => undefined;
  return renderToStaticMarkup(
    React.createElement(OfflineBannerView, {
      snapshotAt: null,
      now: NOW,
      pending: 0,
      blocked: 0,
      expanded: false,
      entries: [],
      confirmId: null,
      busyId: null,
      onToggle: noop,
      onRetry: noop,
      onAskDiscard: noop,
      onCancelDiscard: noop,
      onDiscard: noop,
      ...props,
    })
  );
}

describe('плашка очереди: когда показывать', () => {
  it('нечего сообщать — плашки нет', () => {
    expect(render()).toBe('');
  });

  it('офлайн по-прежнему называет возраст данных', () => {
    expect(render({ snapshotAt: NOW - 12 * 60_000 })).toContain('Офлайн — данные 12 мин назад');
  });

  it('ждущие записи по-прежнему обещают отправку, и разбирать тут нечего', () => {
    const html = render({ pending: 2 });
    expect(html).toContain('2 записи ждут отправки');
    expect(html).not.toContain('Разобрать');
  });
});

describe('плашка очереди: застрявшие записи видно', () => {
  it('сообщает число и зовёт разобраться, а не «покажи это капитану»', () => {
    const html = render({ blocked: 2 });
    expect(html).toContain('2 записи не отправились');
    expect(html).toContain('Разобрать');
    expect(html).not.toContain('капитану');
  });

  it('склоняет по-русски', () => {
    expect(render({ blocked: 1 })).toContain('1 запись не отправилась');
    expect(render({ blocked: 5 })).toContain('5 записей не отправились');
    expect(render({ blocked: 21 })).toContain('21 запись не отправилась');
  });

  it('пока список свёрнут, кнопок «Убрать» нет', () => {
    const html = render({ blocked: 1, entries: [stuck()] });
    expect(html).not.toContain('Убрать');
    expect(html).toContain('aria-expanded="false"');
  });

  it('раскрытый список называет запись, причину и возраст', () => {
    const html = render({ blocked: 1, expanded: true, entries: [stuck()] });
    expect(html).toContain('Рефлексия за пойнт');
    expect(html).toContain('Данные на сервере уже изменились');
    expect(html).toContain('12 мин назад');
    expect(html).toContain('aria-expanded="true"');
  });

  it('у каждой записи есть «Отправить ещё раз» и «Убрать»', () => {
    const html = render({
      blocked: 2,
      expanded: true,
      entries: [stuck({ id: 1 }), stuck({ id: 2, label: 'Разбор капитана', lastStatus: 403 })],
    });
    expect(html.match(/Отправить ещё раз/g)).toHaveLength(2);
    expect(html.match(/>Убрать</g)).toHaveLength(2);
    expect(html).toContain('Разбор капитана');
    expect(html).toContain('Нет прав на это действие');
  });
});

describe('плашка очереди: убрать запись нельзя случайно', () => {
  it('сперва спрашивает, и называет последствие', () => {
    const html = render({ blocked: 1, expanded: true, entries: [stuck()], confirmId: 7 });
    expect(html).toContain('Убрать запись насовсем?');
    expect(html).toContain('не будет отправлена');
    expect(html).toContain('Да, убрать');
    expect(html).toContain('Оставить');
  });

  it('вопрос задаётся только по выбранной записи', () => {
    const html = render({
      blocked: 2,
      expanded: true,
      entries: [stuck({ id: 1 }), stuck({ id: 2, label: 'Состав пойнта' })],
      confirmId: 2,
    });
    expect(html.match(/Убрать запись насовсем\?/g)).toHaveLength(1);
    expect(html.match(/Отправить ещё раз/g)).toHaveLength(1);
  });

  it('пока запись отправляется заново, кнопки заблокированы', () => {
    const html = render({ blocked: 1, expanded: true, entries: [stuck()], busyId: 7 });
    expect(html).toContain('Отправляем');
    expect(html).toContain('disabled');
  });
});
