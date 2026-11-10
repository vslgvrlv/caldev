// Одно действие за раз: пока запрос идёт, повторный вызов ничего не
// отправляет. Так второе нажатие «Создать событие» не создаёт дубль
// (ключа идемпотентности у `POST /events` нет). Флаг ставится синхронно,
// поэтому двойной тап до перерисовки кнопки тоже не проходит.

export type SingleFlightResult<T> = { skipped: true } | { skipped: false; value: T };

export function createSingleFlight() {
  let busy = false;
  return {
    get busy(): boolean {
      return busy;
    },
    async run<T>(fn: () => Promise<T> | T): Promise<SingleFlightResult<T>> {
      if (busy) return { skipped: true };
      busy = true;
      try {
        return { skipped: false, value: await fn() };
      } finally {
        busy = false;
      }
    },
  };
}
