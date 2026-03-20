import { Event, Team, TeamMember, TeamContext, Transaction, TransferConfirmation, User, RSVPStatus, EventType, TransactionType } from './types';

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

export type AuthMethod = 'WEBAPP' | 'OIDC' | 'LEGACY_WIDGET' | 'DEV' | null;
export type AdminScope = 'NONE' | 'TEAM' | 'PLATFORM';

export type AuthMeResponse =
  | { authenticated: false }
  | {
      authenticated: true;
      user: {
        id: string;
        name: string;
        nickname: string;
        telegramUsername?: string | null;
        avatar?: string | null;
      };
      accountRole: 'ADMIN' | 'USER' | null;
      roleSelectionRequired: boolean;
      canChooseAdminRole: boolean;
      isOwnerAdminEligible: boolean;
      hasMemberships: boolean;
      activeMembershipId: string | null;
      activeTeamId: string | null;
      authMethod: AuthMethod;
      capabilities: string[];
      adminScope: AdminScope;
      managedTeamIds: string[];
      managedTeams?: Array<{
        id: string;
        name: string;
      }>;
      availableRoles: Array<{
        membershipId: string;
        teamId: string;
        teamName: string;
        role: 'CAPTAIN' | 'TRAINER' | 'PLAYER';
      }>;
    };

export type AdminOverviewResponse = {
  scope: 'PLATFORM' | 'TEAM';
  teamIds: string[];
  summary: {
    teamsCount: number;
    membersCount: number;
    upcomingEventsCount: number;
    rsvpCompletionRate: number;
    reminderDelivery: {
      attempted: number;
      sent: number;
      queued: number;
      failed: number;
      successRate: number;
    };
  };
};

export type EventOwnerKind = 'TEAM' | 'VENUE' | 'INTEGRATION';
export type EventSourceKind = 'MANUAL' | 'VENUE_API' | 'INTEGRATION_API';
export type EventRegistrationStatus = 'REQUESTED' | 'CONFIRMED' | 'WAITLISTED' | 'REJECTED' | 'CANCELLED';

export type AdminEventScheduleItem = {
  id?: string;
  time: string;
  opponent: string;
  score?: string;
  pitZone?: 'NEAR' | 'FAR';
  gamePair?: 'FIRST' | 'SECOND';
};

export type AdminImportedScheduleItem = AdminEventScheduleItem & {
  teamId: string;
  startAt?: string | null;
  sourceKind?: EventSourceKind;
  sourceProvider?: string | null;
  sourceExternalGameId?: string | null;
  publishedAt?: string;
};

export type AdminEventRegistration = {
  id: string;
  teamId: string;
  status: EventRegistrationStatus;
  requestedAt?: string;
  confirmedAt?: string | null;
  externalRegistrationId?: string | null;
  confirmedByUserId?: string | null;
};

export type AdminEventRegistrationSummary = {
  total: number;
  requested: number;
  confirmed: number;
  waitlisted: number;
  rejected: number;
  cancelled: number;
};

export type AdminEventItem = {
  id: string;
  teamId: string;
  type: EventType | string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  location: string | null;
  isCancelled: boolean;
  cost: number | null;
  costStatus: 'UNKNOWN' | 'ESTIMATED' | 'FINAL';
  financeState: 'NOT_CALCULATED' | 'COLLECTING' | 'CLOSED';
  ownerKind: EventOwnerKind;
  ownerTeamId: string | null;
  ownerName: string | null;
  sourceKind: EventSourceKind;
  sourceProvider: string | null;
  sourceExternalEventId: string | null;
  registration?: AdminEventRegistration | null;
  registrationSummary?: AdminEventRegistrationSummary;
  importedSchedule?: AdminImportedScheduleItem[];
  createdAt: string;
  schedule: AdminEventScheduleItem[];
};

export type AdminEventsResponse = {
  items: AdminEventItem[];
  total: number;
  limit: number;
  offset: number;
};

export type AdminTeamMember = {
  membershipId: string;
  teamId: string;
  userId: string;
  role: 'CAPTAIN' | 'TRAINER' | 'PLAYER';
  status: 'ACTIVE' | 'INJURED' | 'RESERVE' | 'VACATION';
  balance: number;
  user: {
    username: string | null;
    name: string;
    nickname: string;
    avatar: string | null;
    isActive: boolean;
  };
  createdAt: string;
};

export type AdminTeamMembersResponse = {
  teamId: string;
  team?: {
    id: string;
    name: string;
    shortCode: string;
    timezone: string;
    ownerEventsCount: number;
    registrationSummary: AdminEventRegistrationSummary;
  };
  registrationLinks?: Array<{
    registrationId: string;
    eventId: string;
    eventTitle: string;
    status: EventRegistrationStatus;
    requestedAt: string;
    confirmedAt: string | null;
    ownerKind: EventOwnerKind;
    ownerName: string | null;
    sourceKind: EventSourceKind;
    sourceProvider: string | null;
    importedItemsCount: number;
    lastPublishedAt: string | null;
  }>;
  items: AdminTeamMember[];
};

export type AdminAuditResponse = {
  items: Array<{
    id: string;
    action: string;
    payload: Record<string, unknown>;
    createdAt: string;
    actor: {
      userId: string;
      name: string | null;
      username: string | null;
    } | null;
    flow?: {
      key: string | null;
      stage:
        | 'registration_requested'
        | 'registration_confirmed'
        | 'registration_waitlisted'
        | 'registration_rejected'
        | 'registration_cancelled'
        | 'schedule_published';
      eventId: string | null;
      teamId: string | null;
    } | null;
  }>;
  limit: number;
};

export type FinanceOverviewResponse = {
  team?: {
    id: string;
    name: string;
    budget?: number;
  };
  summary?: {
    balance?: number;
    totalOutstanding?: number;
    totalEventChargesOpen?: number;
    overdueCount?: number;
    pendingDeposits?: number;
    pendingConfirmations?: number;
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
  topDebtors?: Array<{
    userId: string;
    name: string;
    nickname: string;
    avatar?: string | null;
    debt: number;
  }>;
};

export type FinanceMembersResponse = {
  items?: Array<{
    userId: string;
    name?: string;
    nickname?: string;
    avatar?: string | null;
    role?: 'ADMIN' | 'CAPTAIN' | 'TRAINER' | 'PLAYER';
    memberStatus?: 'ACTIVE' | 'INJURED' | 'RESERVE' | 'VACATION';
    totalDue?: number;
    totalPaid?: number;
    outstanding?: number;
    overpaid?: number;
  }>;
};

export type FinanceEventsResponse = {
  items?: Array<{
    eventId: string;
    title: string;
    type: string;
    startDate: string;
    costStatus: 'UNKNOWN' | 'ESTIMATED' | 'FINAL';
    plannedTotal?: number;
    expenseTotal?: number;
    collectionTargetTotal?: number;
    chargedTotal: number;
    paidTotal: number;
    outstandingTotal: number;
    undistributedTotal?: number;
    remainingToCollect?: number;
    overpaidTotal?: number;
    membersCharged: number;
    membersPaid: number;
    state: 'NOT_CALCULATED' | 'COLLECTING' | 'CLOSED';
    collectionState?: 'EMPTY' | 'NEEDS_DISTRIBUTION' | 'COLLECTING' | 'COLLECTED' | 'OVERPAID';
  }>;
};

export type FinanceEventDetailResponse = {
  event: {
    id: string;
    title: string;
    type: string;
    startDate: string;
    location?: string | null;
    cost?: number;
    costStatus: 'UNKNOWN' | 'ESTIMATED' | 'FINAL';
    financeState: 'NOT_CALCULATED' | 'COLLECTING' | 'CLOSED';
  };
  summary: {
    chargedTotal: number;
    paidTotal: number;
    outstandingTotal: number;
    collectionRatePct: number;
  };
  collection?: {
    expenseTotal: number;
    targetTotal: number;
    chargedTotal: number;
    paidTotal: number;
    undistributedTotal: number;
    remainingToCollect: number;
    overpaidTotal: number;
    membersCharged: number;
    membersPaid: number;
    state: 'EMPTY' | 'NEEDS_DISTRIBUTION' | 'COLLECTING' | 'COLLECTED' | 'OVERPAID';
  };
  participants: Array<{
    userId: string;
    name: string;
    nickname: string;
    avatar?: string | null;
    role?: 'CAPTAIN' | 'TRAINER' | 'PLAYER';
    memberStatus?: 'ACTIVE' | 'INJURED' | 'RESERVE' | 'VACATION';
    rsvpStatus?: 'UNANSWERED' | 'PENDING' | 'CONFIRMED' | 'DECLINED';
    amountDue: number;
    amountPaid: number;
    amountOutstanding: number;
    chargeStatus: 'PENDING' | 'PARTIAL' | 'PAID';
  }>;
  payments: Array<{
    transactionId: string;
    date: string;
    type: TransactionType;
    title: string;
    amount: number;
    payerUserId?: string;
    payerName?: string;
    status: 'PENDING' | 'COMPLETED';
    allocations: Array<{ userId: string; amount: number }>;
  }>;
};

export type FinanceMemberDetailResponse = {
  member?: {
    userId: string;
    name: string;
    nickname: string;
    avatar?: string | null;
    role: 'CAPTAIN' | 'TRAINER' | 'PLAYER';
    status: 'ACTIVE' | 'INJURED' | 'RESERVE' | 'VACATION';
    balance: number;
  };
  summary?: {
    totalDue: number;
    totalPaid: number;
    outstanding: number;
    eventsWithDebt: number;
  };
  eventDebts?: Array<{
    eventId: string;
    teamId?: string;
    teamName?: string;
    title: string;
    date: string;
    amountDue: number;
    amountPaid: number;
    outstanding: number;
    chargeStatus: 'PENDING' | 'PARTIAL' | 'PAID';
  }>;
  payments?: Array<{
    transactionId: string;
    date: string;
    amount: number;
    title: string;
    allocatedAmount: number;
    unallocatedAmount: number;
  }>;
};

export type FinanceTransferConfirmationsResponse = {
  items?: TransferConfirmation[];
};

type RequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

type ApiError = Error & {
  code?: string;
  detail?: string;
  status?: number;
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
    let code: string | undefined;
    try {
      const payload = await res.json();
      if (payload?.detail) detail = String(payload.detail);
      if (payload?.code) code = String(payload.code);
    } catch (_) {}
    const err = new Error(detail) as ApiError;
    err.code = code;
    err.detail = detail;
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

export const api = {
  async getAuthMe(): Promise<AuthMeResponse> {
    return request<AuthMeResponse>('/auth/me');
  },

  async selectAccountRole(accountRole: 'ADMIN' | 'USER'): Promise<{ ok: true; accountRole: 'ADMIN' | 'USER' }> {
    return request<{ ok: true; accountRole: 'ADMIN' | 'USER' }>('/auth/select-role', {
      method: 'POST',
      body: { accountRole },
    });
  },

  async switchTeamContext(membershipId: string): Promise<{ ok: true }> {
    return request<{ ok: true }>('/auth/context', {
      method: 'POST',
      body: { membershipId },
    });
  },

  startTelegramOidc(redirectTo = '/app') {
    window.location.assign(`/api/v1/auth/telegram/oidc/start?redirectTo=${encodeURIComponent(redirectTo)}`);
  },

  startTelegramDirect(redirectTo = '/app') {
    window.location.assign(`/api/v1/auth/telegram/direct?redirectTo=${encodeURIComponent(redirectTo)}`);
  },

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
      teams?: TeamContext[];
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
      teams: (data.teams || []) as TeamContext[],
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
    const qs = tx.teamId ? `?teamId=${encodeURIComponent(tx.teamId)}` : '';
    return request(`/transactions${qs}`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: {
        ...tx,
        date: tx.date.toISOString()
      },
    });
  },

  async updateTransaction(payload: {
    transactionId: string;
    title?: string;
    amount?: number;
    eventId?: string | null;
  }) {
    return request<{ success: boolean; transaction: Transaction }>(`/transactions/${encodeURIComponent(payload.transactionId)}`, {
      method: 'PATCH',
      body: payload,
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

  async getFinanceEvents(teamId: string): Promise<FinanceEventsResponse> {
    return request<FinanceEventsResponse>(`/finance/events?teamId=${encodeURIComponent(teamId)}`);
  },

  async getFinanceEventDetail(eventId: string): Promise<FinanceEventDetailResponse> {
    return request<FinanceEventDetailResponse>(`/finance/events/${encodeURIComponent(eventId)}`);
  },

  async getFinanceMember(teamId: string, userId: string): Promise<FinanceMemberDetailResponse> {
    return request<FinanceMemberDetailResponse>(`/finance/members/${encodeURIComponent(userId)}?teamId=${encodeURIComponent(teamId)}`);
  },

  async getFinanceConfirmations(teamId: string): Promise<FinanceTransferConfirmationsResponse> {
    return request<FinanceTransferConfirmationsResponse>(`/finance/confirmations?teamId=${encodeURIComponent(teamId)}`);
  },

  async createTransferConfirmation(payload: {
    teamId: string;
    userId?: string;
    amount: number;
    screenshotDataUrl: string;
    note?: string;
    submittedAt?: string;
  }): Promise<{ success: boolean; confirmation: TransferConfirmation | null }> {
    return request<{ success: boolean; confirmation: TransferConfirmation | null }>('/finance/confirmations', {
      method: 'POST',
      body: payload,
    });
  },

  async reviewTransferConfirmation(payload: {
    confirmationId: string;
    decision: 'APPROVE' | 'REJECT';
    reviewNote?: string;
    preferredEventId?: string;
  }): Promise<{ success: boolean; confirmation: TransferConfirmation | null }> {
    return request<{ success: boolean; confirmation: TransferConfirmation | null }>(
      `/finance/confirmations/${encodeURIComponent(payload.confirmationId)}/review`,
      {
        method: 'POST',
        body: {
          decision: payload.decision,
          reviewNote: payload.reviewNote,
          preferredEventId: payload.preferredEventId,
        },
      }
    );
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

  async generateEventCharges(payload: {
    eventId: string;
    mode?: 'CONFIRMED_ONLY' | 'CONFIRMED_AND_PENDING';
    amountType: 'FIXED_PER_PERSON' | 'TOTAL_SPLIT' | 'UNDISTRIBUTED_SPLIT' | 'CUSTOM';
    fixedAmount?: number;
    totalAmount?: number;
    overwriteExisting?: boolean;
    custom?: Array<{ userId: string; amount: number }>;
  }) {
    const idempotencyKey = `event-charge-${payload.eventId}-${Date.now()}`.slice(0, 120);
    return request(`/finance/events/${encodeURIComponent(payload.eventId)}/charges/generate`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: {
        mode: payload.mode ?? 'CONFIRMED_ONLY',
        amountType: payload.amountType,
        fixedAmount: payload.fixedAmount,
        totalAmount: payload.totalAmount,
        overwriteExisting: payload.overwriteExisting ?? false,
        custom: payload.custom,
      },
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
    teamId?: string;
    userIds?: string[];
    customText?: string;
  }): Promise<NotificationDeliveryResponse> {
    return request('/notifications/finance/remind-debtors', {
      method: 'POST',
      body: payload ?? {},
    });
  },

  async remindFinanceMemberDebt(payload: {
    teamId?: string;
    userId: string;
    customText?: string;
  }): Promise<NotificationDeliveryResponse> {
    return request(`/notifications/finance/members/${payload.userId}/remind-debt`, {
      method: 'POST',
      body: {
        ...(payload.customText ? { customText: payload.customText } : {}),
        ...(payload.teamId ? { teamId: payload.teamId } : {}),
      },
    });
  },

  async remindEventDebtors(payload: {
    eventId: string;
    userIds?: string[];
    customText?: string;
  }): Promise<NotificationDeliveryResponse> {
    return request(`/notifications/finance/events/${payload.eventId}/remind-debtors`, {
      method: 'POST',
      body: {
        userIds: payload.userIds,
        customText: payload.customText,
      },
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

  async updateTeamMembership(
    teamId: string,
    membershipId: string,
    payload: {
      teamRole?: 'CAPTAIN' | 'TRAINER' | 'PLAYER';
      status?: 'ACTIVE' | 'INJURED' | 'RESERVE' | 'VACATION';
    }
  ): Promise<{ ok: true }> {
    return request<{ ok: true }>(`/teams/${teamId}/memberships/${membershipId}`, {
      method: 'PATCH',
      body: payload,
    });
  },

  async removeTeamMembership(teamId: string, membershipId: string): Promise<{ ok: true }> {
    return request<{ ok: true }>(`/teams/${teamId}/memberships/${membershipId}`, {
      method: 'DELETE',
      body: {},
    });
  },

  async authTelegramWebApp(initData: string, forceLogin = false) {
    return request('/auth/telegram/webapp', {
      method: 'POST',
      body: { initData, forceLogin },
    });
  },

  async getAdminOverview(teamId?: string): Promise<AdminOverviewResponse> {
    const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
    return request<AdminOverviewResponse>(`/admin/v1/overview${qs}`);
  },

  async getAdminEvents(params?: {
    teamId?: string;
    q?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }): Promise<AdminEventsResponse> {
    const search = new URLSearchParams();
    if (params?.teamId) search.set('teamId', params.teamId);
    if (params?.q) search.set('q', params.q);
    if (params?.from) search.set('from', params.from);
    if (params?.to) search.set('to', params.to);
    if (typeof params?.limit === 'number') search.set('limit', String(params.limit));
    if (typeof params?.offset === 'number') search.set('offset', String(params.offset));
    const qs = search.toString() ? `?${search.toString()}` : '';
    return request<AdminEventsResponse>(`/admin/v1/events${qs}`);
  },

  async createAdminEvent(payload: {
    teamId: string;
    type: EventType | 'OTHER';
    title: string;
    description?: string;
    startAt: string;
    endAt?: string;
    location?: string;
    cost?: number;
    costStatus?: 'UNKNOWN' | 'ESTIMATED' | 'FINAL';
    ownerKind?: EventOwnerKind;
    ownerTeamId?: string;
    ownerName?: string;
    sourceKind?: EventSourceKind;
    sourceProvider?: string;
    sourceExternalEventId?: string;
    registration?: {
      teamId?: string;
      status: EventRegistrationStatus;
      externalRegistrationId?: string;
      confirmedAt?: string;
    };
    importedSchedule?: Array<{
      time: string;
      startAt?: string;
      opponent: string;
      score?: string;
      pitZone?: 'NEAR' | 'FAR';
      gamePair?: 'FIRST' | 'SECOND';
      sourceKind?: EventSourceKind;
      sourceProvider?: string;
      sourceExternalGameId?: string;
      publishedAt?: string;
    }>;
    schedule?: AdminEventScheduleItem[];
  }): Promise<{ event: AdminEventItem }> {
    return request<{ event: AdminEventItem }>('/admin/v1/events', {
      method: 'POST',
      body: payload,
    });
  },

  async patchAdminEvent(
    eventId: string,
    payload: {
      title?: string;
      description?: string | null;
      startAt?: string;
      endAt?: string | null;
      location?: string | null;
      isCancelled?: boolean;
      cost?: number | null;
      costStatus?: 'UNKNOWN' | 'ESTIMATED' | 'FINAL';
      registrationStatus?: EventRegistrationStatus;
      externalRegistrationId?: string | null;
      importedSchedule?: Array<{
        time: string;
        startAt?: string;
        opponent: string;
        score?: string;
        pitZone?: 'NEAR' | 'FAR';
        gamePair?: 'FIRST' | 'SECOND';
        sourceKind?: EventSourceKind;
        sourceProvider?: string;
        sourceExternalGameId?: string;
        publishedAt?: string;
      }>;
      schedule?: AdminEventScheduleItem[];
    }
  ): Promise<{ event: AdminEventItem }> {
    return request<{ event: AdminEventItem }>(`/admin/v1/events/${eventId}`, {
      method: 'PATCH',
      body: payload,
    });
  },

  async getAdminTeamMembers(teamId: string): Promise<AdminTeamMembersResponse> {
    return request<AdminTeamMembersResponse>(`/admin/v1/team/members?teamId=${encodeURIComponent(teamId)}`);
  },

  async patchAdminTeamMember(
    teamId: string,
    membershipId: string,
    payload: {
      teamRole?: 'CAPTAIN' | 'TRAINER' | 'PLAYER';
      status?: 'ACTIVE' | 'INJURED' | 'RESERVE' | 'VACATION';
    }
  ) {
    return request<{ ok: boolean }>(
      `/admin/v1/team/members/${membershipId}?teamId=${encodeURIComponent(teamId)}`,
      {
        method: 'PATCH',
        body: payload,
      }
    );
  },

  async getAdminAudit(params?: {
    teamId?: string;
    action?: string;
    limit?: number;
  }): Promise<AdminAuditResponse> {
    const search = new URLSearchParams();
    if (params?.teamId) search.set('teamId', params.teamId);
    if (params?.action) search.set('action', params.action);
    if (typeof params?.limit === 'number') search.set('limit', String(params.limit));
    const qs = search.toString() ? `?${search.toString()}` : '';
    return request<AdminAuditResponse>(`/admin/v1/audit${qs}`);
  },
};
