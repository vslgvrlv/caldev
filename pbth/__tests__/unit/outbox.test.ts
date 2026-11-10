import { describe, expect, it } from 'vitest';
import { MAX_SERVER_REFUSALS, classifyFlushOutcome, countsAsServerRefusal } from '../../lib/outbox';

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

// Запись, которую сервер раз за разом отклоняет (403 после смены роли, 500 на
// конкретных данных), не должна висеть «ожидающей» вечно: человек её не увидит
// и не уберёт. Поэтому такие отказы считаются, а на последнем запись
// становится «не принятой сервером».
describe('застрявшая запись: когда отказ перестаёт быть временным', () => {
  const last = MAX_SERVER_REFUSALS - 1;

  it('403 и 500 терпим, пока попыток мало, и признаём застрявшими на последней', () => {
    for (const status of [403, 500]) {
      expect(classifyFlushOutcome({ ok: false, status, attempts: 0 })).toBe('retry');
      expect(classifyFlushOutcome({ ok: false, status, attempts: last - 1 })).toBe('retry');
      expect(classifyFlushOutcome({ ok: false, status, attempts: last })).toBe('blocked');
    }
  });

  // 401 лечится новым входом, а не повтором, и к записи отношения не имеет.
  // Блокировать из-за него значило бы наказывать за протухшую сессию.
  it('401 никогда не делает запись застрявшей', () => {
    expect(classifyFlushOutcome({ ok: false, status: 401, attempts: 0 })).toBe('retry');
    expect(classifyFlushOutcome({ ok: false, status: 401, attempts: 99 })).toBe('retry');
  });

  it('перегрузка и шлюз (408, 429, 502, 503, 504) — авария на той стороне, не вина записи', () => {
    for (const status of [408, 429, 502, 503, 504]) {
      expect(classifyFlushOutcome({ ok: false, status, attempts: 99 })).toBe('retry');
    }
  });

  it('отсутствие сети не накапливается', () => {
    expect(classifyFlushOutcome({ ok: false, offline: true, attempts: 99 })).toBe('retry');
  });

  it('отказ по существу застревает сразу, сколько бы попыток ни было', () => {
    expect(classifyFlushOutcome({ ok: false, status: 409, attempts: 0 })).toBe('blocked');
    expect(classifyFlushOutcome({ ok: false, status: 422, attempts: 0 })).toBe('blocked');
  });

  it('в счётчик отказов идут только 403 и «настоящие» 5xx', () => {
    expect(countsAsServerRefusal(403)).toBe(true);
    expect(countsAsServerRefusal(500)).toBe(true);
    expect(countsAsServerRefusal(501)).toBe(true);
    expect(countsAsServerRefusal(401)).toBe(false);
    expect(countsAsServerRefusal(429)).toBe(false);
    expect(countsAsServerRefusal(503)).toBe(false);
    expect(countsAsServerRefusal(409)).toBe(false);
    expect(countsAsServerRefusal(undefined)).toBe(false);
  });
});
