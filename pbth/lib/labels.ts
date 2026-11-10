// Роли и статусы по-русски. На экран не выводим значения из базы как есть
// («PLAYER», «CAPTAIN»): человек их читать не обязан.

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Владелец',
  OWNER: 'Владелец',
  CAPTAIN: 'Капитан',
  TRAINER: 'Тренер',
  PLAYER: 'Игрок',
};

const PLAYER_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'В строю',
  INJURED: 'Травма',
  RESERVE: 'Запас',
  VACATION: 'В отпуске',
};

const RSVP_LABELS: Record<string, string> = {
  UNANSWERED: 'Нет ответа',
  PENDING: 'Под вопросом',
  CONFIRMED: 'Иду',
  DECLINED: 'Не иду',
};

function pick(map: Record<string, string>, value: unknown, fallback: string): string {
  const key = String(value ?? '').trim().toUpperCase();
  return map[key] ?? fallback;
}

export function roleLabel(role: unknown): string {
  return pick(ROLE_LABELS, role, 'Участник');
}

export function playerStatusLabel(status: unknown): string {
  return pick(PLAYER_STATUS_LABELS, status, 'Без статуса');
}

export function rsvpLabel(status: unknown): string {
  return pick(RSVP_LABELS, status, 'Нет ответа');
}
