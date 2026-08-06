import { describe, expect, it } from 'vitest';
import { classifyFlushOutcome } from '../../lib/outbox';

// Судьба записи в очереди — единственное место, где заполненную на турнире
// рефлексию можно потерять молча. Поэтому решение вынесено в чистую функцию и
// закрыто тестами по каждой ветке.
describe('судьба записи при отправке', () => {
  it('успех — запись уходит из очереди', () => {
    expect(classifyFlushOutcome({ ok: true })).toBe('sent');
  });

  it('сети нет — ждём, ничего не выбрасываем', () => {
    expect(classifyFlushOutcome({ ok: false, offline: true })).toBe('retry');
  });

  it('авария сервера проходит сама — повторяем', () => {
    expect(classifyFlushOutcome({ ok: false, status: 500 })).toBe('retry');
    expect(classifyFlushOutcome({ ok: false, status: 502 })).toBe('retry');
    expect(classifyFlushOutcome({ ok: false, status: 429 })).toBe('retry');
  });

  // Телефон пролежал в кармане весь турнир, cookie истекла. Данные при этом
  // валидные — выбросить их из-за протухшей сессии значило бы наказать игрока
  // за то, что он честно всё заполнил.
  it('протухшая сессия — не повод терять запись', () => {
    expect(classifyFlushOutcome({ ok: false, status: 401 })).toBe('retry');
    expect(classifyFlushOutcome({ ok: false, status: 403 })).toBe('retry');
  });

  // А вот отказ по существу повтором не лечится: сотый повтор даст тот же 400.
  // Такая запись останавливается и показывается человеку.
  it('отказ по существу останавливает запись', () => {
    expect(classifyFlushOutcome({ ok: false, status: 400 })).toBe('blocked');
    expect(classifyFlushOutcome({ ok: false, status: 404 })).toBe('blocked');
    expect(classifyFlushOutcome({ ok: false, status: 409 })).toBe('blocked');
  });

  it('ошибка без статуса трактуется в пользу данных', () => {
    expect(classifyFlushOutcome({ ok: false })).toBe('retry');
  });
});
