// Клиентская логика опроса при входе по коду (#109).
//
// Чистые функции вынесены отдельно, потому что именно они решают, увидит ли
// человек «вошли» или экран так и останется висеть. Компонент вокруг них —
// разметка.

// Первые секунды опрашиваем часто: человек уже держит телефон в руке и жмёт
// «Это я» через две-три секунды после того, как код доехал до бота. Дальше
// разрежаем — попытка живёт всего пять минут, но всё это время держать
// секундный опрос значит греть батарею впустую.
export function nextPollDelayMs(elapsedMs: number): number {
  if (elapsedMs < 20_000) return 1_000;
  if (elapsedMs < 60_000) return 2_000;
  return 4_000;
}

export function pairingSecondsLeft(expiresAt: string | number, now: number): number {
  const deadline = typeof expiresAt === 'number' ? expiresAt : Date.parse(expiresAt);
  if (!Number.isFinite(deadline)) return 0;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

export interface StoredPairingAttempt {
  scope: 'USER' | 'ADMIN';
  redirectTo: string;
  code: string;
  botUrl: string;
  botUsername: string;
  expiresAt: string;
  startedAt: number;
}

// Возврат из Telegram иногда пересоздаёт React-дерево или перезагружает PWA.
// Код можно безопасно восстановить: забрать сессию всё равно сможет только
// браузер с httpOnly pairing-cookie, выданной на /pair/start.
export function restorePairingAttempt(
  raw: string | null,
  scope: StoredPairingAttempt['scope'],
  redirectTo: string,
  now: number,
): StoredPairingAttempt | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredPairingAttempt>;
    if (
      value.scope !== scope ||
      value.redirectTo !== redirectTo ||
      typeof value.code !== 'string' ||
      !value.code ||
      typeof value.botUrl !== 'string' ||
      typeof value.botUsername !== 'string' ||
      typeof value.expiresAt !== 'string' ||
      typeof value.startedAt !== 'number' ||
      !Number.isFinite(value.startedAt) ||
      pairingSecondsLeft(value.expiresAt, now) === 0
    ) {
      return null;
    }
    return value as StoredPairingAttempt;
  } catch {
    return null;
  }
}

export function formatPairingCountdown(secondsLeft: number): string {
  const safe = Math.max(0, Math.floor(secondsLeft));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export type PairingScreenState = 'idle' | 'starting' | 'waiting' | 'claimed' | 'approved' | 'denied' | 'expired' | 'error';

// Что человек читает на экране в каждом состоянии. Главное правило: из любого
// состояния должен быть виден путь вперёд — тупик «START BOT» без единого
// действия и был исходным инцидентом 2026-08-06.
export function pairingStatusMessage(state: PairingScreenState): string {
  switch (state) {
    case 'starting':
      return 'Готовим код...';
    case 'waiting':
      return 'Ждём подтверждения в Telegram';
    case 'claimed':
      return 'Код получен — подтвердите вход в чате с ботом';
    case 'approved':
      return 'Готово, входим';
    case 'denied':
      return 'Вход отклонён. Если это были не вы — всё в порядке, код больше не работает.';
    case 'expired':
      return 'Код истёк. Получите новый.';
    case 'error':
      return 'Не удалось получить код. Проверьте связь и попробуйте ещё раз.';
    default:
      return '';
  }
}

// Опрос останавливается на всём, что уже не изменится само: продолжать
// дёргать сервер после отказа или истечения — только жечь батарею.
export function shouldKeepPolling(state: PairingScreenState): boolean {
  return state === 'waiting' || state === 'claimed';
}
