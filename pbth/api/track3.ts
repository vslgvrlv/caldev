import { request } from '../api';

// Клиент консоли владельца и журнала команды (трек 3 ревизии).
// Консоль — ручки `/platform` (только владельцу). Приглашение капитана и
// заявки на создание команды — ручки трека 1.

export type PlatformTeam = {
  id: string;
  name: string;
  shortCode: string;
  timezone: string;
  createdAt: string;
  membersCount: number;
  captains: string[];
  nextEvent: { id: string; title: string; startAt: string } | null;
  /** null — число заявок неизвестно (нет модуля заявок). */
  pendingJoinRequests: number | null;
  lastActivityAt: string | null;
  /** Владелец сам состоит в этой команде. */
  isMine: boolean;
};

export type PlatformTeamCard = {
  team: PlatformTeam;
  members: Array<{ id: string; name: string; nickname: string; role: string; status: string }>;
  upcomingEvents: Array<{ id: string; title: string; type: string; startAt: string }>;
};

export type JournalItem = {
  id: string;
  at: string;
  actorName: string;
  byOwner: boolean;
  text: string;
};

/** Заявка на создание команды — как её отдаёт трек 1 (читаем терпимо к именам полей). */
export type TeamCreationRequest = {
  id: string;
  teamName: string;
  shortCode: string | null;
  requesterName: string;
  requesterUsername: string | null;
  note: string | null;
  createdAt: string | null;
};

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function parseTeamCreationRequests(body: unknown): TeamCreationRequest[] {
  const raw = Array.isArray(body)
    ? body
    : Array.isArray((body as any)?.items)
      ? (body as any).items
      : Array.isArray((body as any)?.requests)
        ? (body as any).requests
        : [];
  return raw
    .filter((item: any) => item && (typeof item.id === 'string' || typeof item.id === 'number'))
    .map((item: any) => {
      const requester = item.requester ?? item.user ?? {};
      return {
        id: String(item.id),
        teamName: str(item.teamName) ?? str(item.name) ?? str(item.team_name) ?? 'Без названия',
        shortCode: str(item.shortCode) ?? str(item.short_code),
        requesterName: str(requester.name) ?? str(item.requesterName) ?? str(item.requester_name) ?? 'Без имени',
        requesterUsername: str(requester.username) ?? str(requester.telegramUsername) ?? str(item.requesterUsername),
        note: str(item.note) ?? str(item.comment) ?? str(item.message),
        createdAt: str(item.createdAt) ?? str(item.created_at),
      };
    });
}

export const platformApi = {
  listTeams(): Promise<{ items: PlatformTeam[] }> {
    return request('/platform/teams');
  },
  getTeam(code: string): Promise<PlatformTeamCard> {
    return request(`/platform/teams/${encodeURIComponent(code)}`);
  },
  suggestShortCode(name: string): Promise<{ shortCode: string }> {
    return request(`/platform/teams/code-suggestion?name=${encodeURIComponent(name)}`);
  },
  createTeam(payload: { name: string; shortCode?: string }): Promise<{ team: { id: string; name: string; shortCode: string } }> {
    return request('/platform/teams', { method: 'POST', body: payload });
  },
  journal(teamId: string): Promise<{ items: JournalItem[] }> {
    return request(`/platform/teams/${encodeURIComponent(teamId)}/journal`);
  },
  /** Именная одноразовая ссылка для капитана — ручка трека 1. */
  inviteCaptain(teamId: string, note: string): Promise<{ token: string; expiresAt?: string }> {
    return request(`/teams/${encodeURIComponent(teamId)}/invites`, {
      method: 'POST',
      body: { teamRole: 'CAPTAIN', singleUse: true, note },
    });
  },
  async listTeamCreationRequests(): Promise<TeamCreationRequest[]> {
    return parseTeamCreationRequests(await request<unknown>('/team-requests?status=pending'));
  },
  approveTeamCreationRequest(id: string): Promise<unknown> {
    return request(`/team-requests/${encodeURIComponent(id)}/approve`, { method: 'POST', body: {} });
  },
  declineTeamCreationRequest(id: string): Promise<unknown> {
    return request(`/team-requests/${encodeURIComponent(id)}/decline`, { method: 'POST', body: {} });
  },
};
