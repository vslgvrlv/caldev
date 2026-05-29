// Единый сборщик ссылки-приглашения: ${origin}/invite/<token>.
// Используется и в TeamView (капитан), и в Platform Console (владелец),
// чтобы формат ссылки не разъезжался между местами.

const DEFAULT_ORIGIN = 'https://pbthub.ru';

export function buildInviteLink(origin: string | null | undefined, token: string): string {
  const base = (origin && origin.trim()) || DEFAULT_ORIGIN;
  const normalized = base.replace(/\/+$/, '');
  return `${normalized}/invite/${encodeURIComponent(token)}`;
}
