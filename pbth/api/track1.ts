import { request, type InviteNextEvent } from '../api';

// Клиент трека 1 «Вход и заявки» (ревизия PBTH, 11.11.2026). Ручки — в
// backend/src/modules/join-requests, team-requests и teams (ссылка команды).

export type TeamBrief = { id: string; name: string; shortCode: string };

export type JoinRequestStatus = 'PENDING' | 'APPROVED' | 'DECLINED' | 'CANCELLED';

export type NextEvent = { title: string; startAt: string; location: string | null; timezone: string };

export type JoinRequest = {
  id: string;
  status: JoinRequestStatus;
  createdAt: string;
  decidedAt: string | null;
  team: TeamBrief;
  nextEvent: NextEvent | null;
};

export type JoinLinkPreview = {
  team: TeamBrief;
  authenticated: boolean;
  member: boolean;
  request: JoinRequest | null;
  /** Необязательные факты о команде: капитан, число людей, ближайшее событие. */
  inviter?: { name: string } | null;
  membersCount?: number;
  nextEvent?: InviteNextEvent | null;
};

export type SubmitJoinResult = { member: boolean; team: TeamBrief; request: JoinRequest | null };

export type PendingJoinRequest = {
  id: string;
  createdAt: string;
  user: { id: string; name: string; nickname: string; username: string | null; avatar: string | null };
};

export type TeamJoinLink = { code: string; url: string; createdAt: string };

export type TeamCreationRequest = {
  id: string;
  name: string;
  status: JoinRequestStatus;
  createdAt: string;
  decidedAt: string | null;
  team: TeamBrief | null;
};

export const track1Api = {
  previewJoinLink: (code: string) => request<JoinLinkPreview>(`/join-requests/link/${encodeURIComponent(code)}`),
  submitJoinRequest: (code: string) => request<SubmitJoinResult>('/join-requests', { method: 'POST', body: { code } }),
  getJoinRequest: (id: string) =>
    request<{ request: JoinRequest }>(`/join-requests/${encodeURIComponent(id)}`).then((r) => r.request),
  myJoinRequests: () => request<{ requests: JoinRequest[] }>('/join-requests/mine').then((r) => r.requests),
  /** Ждущие заявки команды запроса (заголовок команды ставит оболочка). */
  teamJoinRequests: () => request<{ count: number; requests: PendingJoinRequest[] }>('/join-requests'),
  decideJoinRequest: (id: string, decision: 'approve' | 'decline') =>
    request<{ ok: true; status: 'APPROVED' | 'DECLINED' }>(`/join-requests/${encodeURIComponent(id)}/${decision}`, {
      method: 'POST',
      body: {},
    }),

  getTeamJoinLink: (teamId: string) => request<TeamJoinLink>(`/teams/${encodeURIComponent(teamId)}/join-link`),
  rotateTeamJoinLink: (teamId: string) =>
    request<TeamJoinLink>(`/teams/${encodeURIComponent(teamId)}/join-link/rotate`, { method: 'POST', body: {} }),

  submitTeamRequest: (name: string) =>
    request<{ created: boolean; request: TeamCreationRequest }>('/team-requests', { method: 'POST', body: { name } }),
  myTeamRequests: () => request<{ requests: TeamCreationRequest[] }>('/team-requests/mine').then((r) => r.requests),

  setMemberRole: (teamId: string, membershipId: string, teamRole: 'CAPTAIN' | 'TRAINER' | 'PLAYER') =>
    request<{ ok: true }>(`/teams/${encodeURIComponent(teamId)}/memberships/${encodeURIComponent(membershipId)}`, {
      method: 'PATCH',
      body: { teamRole },
    }),
};

/** Адрес ссылки команды на этом сайте. */
export function joinUrl(origin: string | null | undefined, code: string): string {
  const base = String(origin || 'https://pbthub.ru').replace(/\/+$/, '');
  return `${base}/join/${encodeURIComponent(code)}`;
}

/** Код из поля ввода или из целой ссылки: «AB3K7Q», «ab3-k7q», «https://…/join/AB3K7Q». */
export function parseJoinCodeInput(raw: string): string | null {
  const text = String(raw || '').trim();
  const fromUrl = /\/join\/([A-Za-z0-9-]+)/.exec(text);
  const value = (fromUrl ? fromUrl[1] : text).replace(/[\s-]+/g, '').toUpperCase();
  return /^[A-Z0-9]{4,16}$/.test(value) ? value : null;
}

// Число ждущих заявок — общее для значка в шапке и экрана заявок: решил
// заявку на экране — значок обновился сразу, без своего запроса.
type Listener = () => void;
const listeners = new Set<Listener>();
export function onJoinRequestsChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function notifyJoinRequestsChanged(): void {
  for (const listener of listeners) listener();
}
