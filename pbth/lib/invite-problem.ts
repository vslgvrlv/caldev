/**
 * Человеческий текст, когда приглашением воспользоваться нельзя.
 *
 * Старые ссылки вида /invite/<ID команды> раньше давали вступить напрямую.
 * Это закрыто: в команду попадают только по действующему приглашению, и
 * человек должен понять, что делать дальше, — попросить у капитана новое.
 * `null` — приглашение в порядке (или ошибка не про само приглашение).
 */
export function describeInviteProblem(err: unknown): string | null {
  const code = String((err as { code?: string } | null)?.code || '');
  const message = err instanceof Error ? err.message.toLowerCase() : '';
  if (code === 'INVITE_NOT_FOUND' || code === 'INVITE_REQUIRED' || message.includes('invite not found')) {
    return 'Эта ссылка устарела. Попроси у капитана новую ссылку-приглашение.';
  }
  if (code === 'INVITE_EXPIRED' || message.includes('invite expired')) {
    return 'Срок приглашения истёк. Попроси у капитана новую ссылку-приглашение.';
  }
  if (code === 'INVITE_REVOKED' || message.includes('invite is revoked')) {
    return 'Капитан отозвал это приглашение. Попроси у него новую ссылку.';
  }
  return null;
}
