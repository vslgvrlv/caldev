import { Event, Team, TeamMember, Transaction, User, RSVPStatus, EventType } from './types';

const baseFromEnv = ((import.meta as any).env?.VITE_API_BASE as string | undefined)?.replace(/\/$/, '');
const API_URL = baseFromEnv ? `${baseFromEnv}/api/v1` : '/api/v1';

export type IcsInfo = {
  url: string;
  subscriptionUrl: string;
  downloadUrl: string;
  hasToken: boolean;
};

export type NotificationDeliveryResponse = {
  success: boolean;
  deliveryMode: 'SYNC' | 'QUEUE';
  attempted: number;
  sent: number;
  queued: number;
  skippedNoTelegram: number;
  failed: Array<{ userId?: string; reason?: string }>;
};

export type TeamInviteCreateResponse = {
  token: string;
  role: 'CAPTAIN' | 'TRAINER' | 'PLAYER';
  expiresAt: string;
};

export type TeamInviteInfoResponse = {
  teamId: string;
  teamName: string;
  role: 'CAPTAIN' | 'TRAINER' | 'PLAYER';
  expiresAt: string;
  isValid: boolean;
  isExpired: boolean;
  isUsed: boolean;
  isRevoked: boolean;
};

type FinanceOverviewResponse = {
  summary?: {
    balance?: number;
  };
  recentTransactions?: Array<{
    id: string;
    type: TransactionType;
    amount: number;
    title: string;
    date: string;
    userId?: string | null;
    userName?: string | null;
    status?: 'PENDING' | 'COMPLETED';
  }>;
};

type FinanceMembersResponse = {
  items?: Array<{
    userId: string;
    outstanding?: number;
    overpaid?: number;
  }>;
};

type RequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

async function request<T>(path: string, options?: RequestOptions): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: options?.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
    credentials: 'include',
    body: options?.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const payload = await res.json();
      if (payload?.detail) detail = String(payload.detail);
    } catch (_) {}
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  async getInitData() {
    const res = await fetch(`${API_URL}/init`, {
      credentials: 'include',
    });
    if (!res.ok) {
      let detail = 'Failed to fetch data';
      try {
        const payload = await res.json();
        if (payload?.detail) detail = String(payload.detail);
      } catch (_) {}
      throw new Error(`INIT_FAILED:${res.status}:${detail}`);
    }
    const data = await res.json() as {
      user?: User;
      team?: Team;
      members?: TeamMember[];
      events?: any[];
      actionRequiredEvents?: any[];
      transactions?: any[];
      noTeamYet?: boolean;
      admin?: boolean;
      [k: string]: any;
    };

    const mergedEvents = [...(data.events || []), ...(data.actionRequiredEvents || [])];
    const normalizedEvents = mergedEvents.map((e: any) => {
      const rawStart = e.startAt || e.startDate;
      const rawEnd = e.endAt || e.endDate;
      return {
      ...e,
      startAt: rawStart,
      endAt: rawEnd,
      startDate: new Date(rawStart),
      endDate: rawEnd ? new Date(rawEnd) : undefined,
      };
    });
    const normalizedTransactions = (data.transactions || []).map((t: any) => ({
      ...t,
      date: new Date(t.date),
    }));

    return {
      ...data,
      events: normalizedEvents,
      transactions: normalizedTransactions,
      members: data.members || [],
    };
  },

  async createEvent(payload: {
    teamId?: string;
    type: EventType;
    title: string;
    description?: string;
    startDate: Date;
    endDate?: Date;
    location?: string;
    cost?: number;
    costStatus?: 'UNKNOWN' | 'ESTIMATED' | 'FINAL';
    schedule?: Array<{
      time: string;
      opponent: string;
      score?: string;
      pitZone?: 'NEAR' | 'FAR';
      gamePair?: 'FIRST' | 'SECOND';
    }>;
  }) {
    return request(`${'/events'}`, {
      method: 'POST',
      body: {
        teamId: payload.teamId,
        type: payload.type,
        title: payload.title,
        description: payload.description,
        startAt: payload.startDate.toISOString(),
        endAt: payload.endDate ? payload.endDate.toISOString() : undefined,
        location: payload.location,
        cost: payload.cost,
        costStatus: payload.costStatus,
        schedule: payload.schedule,
      }
    });
  },

  async updateEventSchedule(
    eventId: string,
    schedule: Array<{ time: string; opponent: string; score?: string; pitZone?: 'NEAR' | 'FAR'; gamePair?: 'FIRST' | 'SECOND' }>
  ) {
    return request(`/events/${eventId}`, {
      method: 'PATCH',
      body: { scope: 'single', schedule },
    });
  },

  async getEventAttendees(eventId: string): Promise<{
    eventId: string;
    attendees: Array<{
      userId: string;
      name: string;
      nickname: string;
      avatar?: string;
      role: 'CAPTAIN' | 'TRAINER' | 'PLAYER';
      memberStatus: 'ACTIVE' | 'INJURED' | 'RESERVE' | 'VACATION';
      rsvpStatus: 'UNANSWERED' | 'PENDING' | 'CONFIRMED' | 'DECLINED';
    }>;
  }> {
    return request(`/events/${eventId}/attendees`);
  },

  async rsvp(eventId: string, userId: string, status: RSVPStatus) {
    return request('/rsvp', {
      method: 'POST',
      body: { eventId, userId, status },
    });
  },

  async addTransaction(tx: Transaction) {
    const idempotencyKey = `legacy-tx-${tx.id}`.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 128);
    return request('/transactions', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: {
        ...tx,
        date: tx.date.toISOString()
      },
    });
  },

  async getIcs(teamId?: string): Promise<IcsInfo> {
    const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
    return request<IcsInfo>(`/profile/ics${qs}`);
  },

  async rotateIcs(teamId?: string): Promise<IcsInfo> {
    const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
    return request<IcsInfo>(`/profile/ics/rotate${qs}`, { method: 'POST' });
  },

  async getFinanceOverview(teamId: string): Promise<FinanceOverviewResponse> {
    return request<FinanceOverviewResponse>(`/finance/overview?teamId=${encodeURIComponent(teamId)}`);
  },

  async getFinanceMembers(teamId: string): Promise<FinanceMembersResponse> {
    return request<FinanceMembersResponse>(`/finance/members?teamId=${encodeURIComponent(teamId)}`);
  },

  async createFinancePayment(payload: {
    teamId: string;
    amount: number;
    title: string;
    payerUserId?: string;
    eventId?: string;
    status?: 'PENDING' | 'COMPLETED';
  }) {
    const idempotencyKey = `payment-${Date.now()}-${Math.random().toString(16).slice(2)}`.slice(0, 120);
    return request('/finance/payments', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: payload,
    });
  },

  async sendEventReminder(payload: {
    eventId: string;
    audience: 'ALL' | 'RESPONDED' | 'UNANSWERED' | 'CONFIRMED' | 'PENDING' | 'DECLINED';
    template?: 'EVENT_REMINDER' | 'WARMUP_REMINDER' | 'ROLE_REMINDER' | 'GAME_GATHERING' | 'GAME_WARMUP';
    gameId?: string;
    customText?: string;
  }): Promise<NotificationDeliveryResponse> {
    return request(`/notifications/events/${payload.eventId}/remind`, {
      method: 'POST',
      body: {
        audience: payload.audience,
        template: payload.template ?? 'EVENT_REMINDER',
        gameId: payload.gameId,
        customText: payload.customText,
      },
    });
  },

  async remindFinanceDebtors(payload?: {
    userIds?: string[];
    customText?: string;
  }): Promise<NotificationDeliveryResponse> {
    return request('/notifications/finance/remind-debtors', {
      method: 'POST',
      body: payload ?? {},
    });
  },

  async remindFinanceMemberDebt(payload: {
    userId: string;
    customText?: string;
  }): Promise<NotificationDeliveryResponse> {
    return request(`/notifications/finance/members/${payload.userId}/remind-debt`, {
      method: 'POST',
      body: payload.customText ? { customText: payload.customText } : {},
    });
  },

  async createTeamInvite(
    teamId: string,
    payload?: { teamRole?: 'CAPTAIN' | 'TRAINER' | 'PLAYER'; expiresInHours?: number }
  ): Promise<TeamInviteCreateResponse> {
    return request(`/teams/${teamId}/invites`, {
      method: 'POST',
      body: {
        teamRole: payload?.teamRole ?? 'PLAYER',
        expiresInHours: payload?.expiresInHours ?? 72,
      },
    });
  },

  async getTeamInvite(token: string): Promise<TeamInviteInfoResponse> {
    return request(`/teams/invites/${token}`);
  },

  async acceptTeamInvite(token: string): Promise<{ ok: boolean; membershipId: string; teamId: string }> {
    return request(`/teams/invites/${token}/accept`, {
      method: 'POST',
      body: {},
    });
  },

  async joinTeam(teamId: string): Promise<{ ok: boolean; membershipId: string }> {
    return request(`/teams/${teamId}/join`, {
      method: 'POST',
      body: {},
    });
  },

  async authTelegramWebApp(initData: string) {
    return request('/auth/telegram/webapp', {
      method: 'POST',
      body: { initData },
    });
  },
};
