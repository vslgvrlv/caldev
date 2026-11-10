// Оптимистичное действие: изменение видно сразу, запрос идёт следом. Сервер
// отказал — изменение откатывается и человек видит причину. Ошибка наружу не
// вылетает: необработанный отказ ронял страницу.

export type OptimisticResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

export async function runOptimistic<T>(steps: {
  apply: () => void;
  send: () => Promise<T>;
  rollback: () => void;
  onError: (error: unknown) => void;
}): Promise<OptimisticResult<T>> {
  steps.apply();
  try {
    return { ok: true, value: await steps.send() };
  } catch (error) {
    steps.rollback();
    steps.onError(error);
    return { ok: false, error };
  }
}
