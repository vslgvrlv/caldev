// Состояния загрузки приложения, которые не ошибка: у человека нет команды —
// он на экране «Вступить или создать», в консоль ошибкой это не пишем.

const EXPECTED_INIT_STATES = ['INIT_NO_TEAM'];

export function isExpectedInitState(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  return EXPECTED_INIT_STATES.some((state) => message.includes(state));
}
