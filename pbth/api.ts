import { Event, Team, TeamMember, TeamContext, Transaction, TransferConfirmation, User, RSVPStatus, EventType, TransactionType, FieldPosition, GameReflection, CaptainReport, GamePoint, GamePointsResponse, PointResult, EventTable } from './types';
import {
  createLocalDevEvent,
  getLocalDevAuthMe,
  getLocalDevEventAttendees,
  getLocalDevIcs,
  getLocalDevInitData,
  updateLocalDevRsvp,
} from './lib/local-dev-api';
import {
  SNAPSHOT_AUTH_ME,
  SNAPSHOT_FIELD_POSITIONS,
  SNAPSHOT_INIT,
  isOfflineError,
  loadSnapshot,
  saveSnapshot,
  toOfflineError,
} from './lib/offline';
import { enqueue, flushOutbox, type OutboxEntry } from './lib/outbox';

const baseFromEnv = ((import.meta as any).env?.VITE_API_BASE as string | undefined)?.replace(/\/$/, '');
const API_URL = baseFromEnv ? `${baseFromEnv}/api/v1` : '/api/v1';

export type IcsInfo = {
  url: string;
  subscriptionUrl: string;
  downloadUrl: string;
  hasToken: boolean;
};

export type SavedPlace = {
  id: string;
  name: string;
  address: string | null;
  yandexUrl: string | null;
  usageCount: number;
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

export type SeriesContextResponse = {
  seriesId: string;
  title: string;
  type: string;
  upcomingCount: number;
  committed: boolean;
};

export type EventAttendanceResponse = {
  eventId: string;
  attendance: Array<{ userId: string; present: boolean; markedAt: string }>;
};

export type TeamInviteCreateResponse = {
  token: string;
  role: 'CAPTAIN' | 'TRAINER' | 'PLAYER';
  expiresAt: string;
};

export type TeamCreateResponse = {
  team: {
    id: string;
    name: string;
    shortCode: string;
    logo: string | null;
    budget: number;
    timezone: string;
  };
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

export type AuthMethod = 'WEBAPP' | 'OIDC' | 'LEGACY_WIDGET' | 'DEV' | 'BOT_HANDOFF' | null;
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
      onboardingRequired?: boolean;
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
  stage?: 'GROUP' | 'R16' | 'QF' | 'SF' | 'FINAL';
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
  // Явное согласие ручки на отложенную отправку. Пометка ставится вручную и
  // только там, где повтор безопасен (перезапись по уникальному ключу).
  // Необратимые действия — удаление события, выход из серии, снятие из состава
  // — не очередятся никогда: «отложенное удаление», всплывшее через сутки,
  // хуже честного отказа.
  offlineQueue?: { dedupeKey: string; label: string };
};

type ApiError = Error & {
  code?: string;
  detail?: string;
  status?: number;
};

// Шесть секунд — предел, после которого ждать бессмысленно: снимок в
// IndexedDB уже лежит, и показать его лучше, чем крутить спиннер.
const REQUEST_DEADLINE_MS = 6000;

// Убедившись, что сеть мертва, не проверяем это заново каждым запросом. Иначе
// открытие приложения стоило бы столько сроков, сколько запросов идёт при
// старте, — по шесть секунд каждый, друг за другом.
const NETWORK_DEAD_MS = 15000;
let networkDeadUntil = 0;

function markNetworkDead() {
  networkDeadUntil = Date.now() + NETWORK_DEAD_MS;
}

// Экспортируется ради тестов: отсрочка живёт в модуле, и без сброса соседний
// тест проверял бы не срок ответа, а память о прошлой неудаче.
export function markNetworkAlive() {
  networkDeadUntil = 0;
}

// Связь вернулась — пробовать снова нужно сразу, а не досиживать отсрочку.
if (typeof window !== 'undefined') {
  window.addEventListener('online', markNetworkAlive);
}

// iOS в самолётном режиме и в поле с одной палкой часто НЕ отбивает запрос
// ошибкой, а держит его открытым: промис fetch не выполняется вообще. Весь
// офлайн-слой (#105) построен на том, что fetch отвергается — поэтому
// приложение зависало на загрузочном спиннере, хотя данные для показа были.
// Отсюда три ограничителя: явный сигнал «сети нет», жёсткий срок ответа и
// память о том, что срок уже вышел.
async function fetchWithDeadline(input: string, init: RequestInit): Promise<Response> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw toOfflineError(new Error('navigator.onLine = false'));
  }
  // Отсрочка распространяется только на чтение. Отправку пробуем всегда: у
  // чтения есть снимок, а нажатие «Иду» либо уходит, либо честно ложится в
  // очередь — угадывать за него по прошлой неудаче нельзя.
  const isRead = (init.method ?? 'GET').toUpperCase() === 'GET';
  if (isRead && Date.now() < networkDeadUntil) {
    throw toOfflineError(new Error('network known dead'));
  }
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), REQUEST_DEADLINE_MS);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    markNetworkAlive();
    return response;
  } catch (error) {
    markNetworkDead();
    // Отмена по сроку приходит AbortError'ом, а не TypeError'ом, и без нашей
    // пометки не была бы распознана как отсутствие сети.
    if (controller.signal.aborted) throw toOfflineError(new Error('request deadline exceeded'));
    throw error;
  } finally {
    clearTimeout(deadline);
  }
}

async function request<T>(path: string, options?: RequestOptions): Promise<T> {
  let res: Response;
  try {
    res = await fetchWithDeadline(`${API_URL}${path}`, {
      method: options?.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers || {}),
      },
      credentials: 'include',
      body: options?.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (networkError) {
    // Сети нет — это не отказ сервера. Разница принципиальна: на 401 надо
    // отправлять на логин, на отсутствие сети — поднимать приложение из
    // снимка. Раньше оба случая приходили одним TypeError и лечились одинаково.
    if (options?.offlineQueue) {
      await enqueue({
        method: options.method || 'GET',
        path,
        body: options.body,
        dedupeKey: options.offlineQueue.dedupeKey,
        label: options.offlineQueue.label,
      });
      // Для человека сохранение состоялось: он нажал кнопку, форма закрылась,
      // доставка дальше — наша забота. Вернуть ошибку значило бы заставить его
      // жать «Сохранить» в поле, где сети не будет ещё несколько часов.
      return { queuedOffline: true } as T;
    }
    throw toOfflineError(networkError);
  }
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

// Нормализация ответа /init вынесена наружу, потому что путей теперь два —
// свежий ответ и снимок из IndexedDB. Две копии этой раскладки разъехались бы,
// и офлайн-режим тихо показывал бы события не так, как онлайн.
export function normalizeInitPayload(data: Record<string, any>) {
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
}

function localDevStorage() {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

function localDevHostname() {
  if (typeof window === 'undefined') return '';
  return window.location.hostname;
}

export const api = {
  // Отправка отложенного. Повтор безопасен: все очередящиеся ручки — перезапись
  // по уникальному ключу, а не добавление, поэтому дубль в очереди не создаёт
  // дубль в базе.
  async flushOfflineQueue(): Promise<void> {
    await flushOutbox(async (entry: OutboxEntry) => {
      await request(entry.path, { method: entry.method, body: entry.body });
    });
  },

  async getAuthMe(): Promise<AuthMeResponse> {
    const storage = localDevStorage();
    const localPayload = storage ? getLocalDevAuthMe(storage, localDevHostname()) : null;
    if (localPayload) {
      return localPayload as AuthMeResponse;
    }
    try {
      const payload = await request<AuthMeResponse>('/auth/me');
      // Личность кладём в снимок только когда сервер её подтвердил. Снимок
      // неаутентифицированного ответа заморозил бы человека на экране логина.
      if (payload?.authenticated) void saveSnapshot(SNAPSHOT_AUTH_ME, payload);
      return payload;
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      const cached = await loadSnapshot<AuthMeResponse>(SNAPSHOT_AUTH_ME);
      if (!cached) throw error;
      return cached.value;
    }
  },

  async selectAccountRole(accountRole: 'ADMIN' | 'USER'): Promise<{ ok: true; accountRole: 'ADMIN' | 'USER' }> {
    return request<{ ok: true; accountRole: 'ADMIN' | 'USER' }>('/auth/select-role', {
      method: 'POST',
      body: { accountRole },
    });
  },

  async startTelegramHandoff(scope: 'USER' | 'ADMIN', redirectTo = '/app'): Promise<{ botUrl: string; expiresAt: string }> {
    return request<{ botUrl: string; expiresAt: string }>('/auth/telegram/handoff/start', {
      method: 'POST',
      body: { scope, redirectTo },
    });
  },

  async startPairing(
    scope: 'USER' | 'ADMIN',
    redirectTo = '/app',
  ): Promise<{ code: string; botUrl: string; botUsername: string; expiresAt: string }> {
    return request('/auth/pair/start', {
      method: 'POST',
      body: { scope, redirectTo },
    });
  },

  // Ответ на этот запрос несёт Set-Cookie с сессией — именно поэтому вход
  // работает в PWA на домашнем экране: кука ложится в банку того браузера,
  // который запрос и сделал (#109).
  async getPairingStatus(
    code: string,
  ): Promise<{ status: 'pending' | 'claimed' | 'approved' | 'denied' | 'expired'; redirectTo?: string }> {
    return request(`/auth/pair/status?code=${encodeURIComponent(code)}`);
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

  async getInitData(): Promise<{
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
  }> {
    const storage = localDevStorage();
    const localData = storage ? getLocalDevInitData(storage, localDevHostname()) : null;
    if (localData) {
      return localData;
    }

    let res: Response;
    try {
      res = await fetchWithDeadline(`${API_URL}/init`, {
        credentials: 'include',
      });
    } catch (networkError) {
      // Снимок хранится сырым, до нормализации: в нём нет объектов Date, он
      // переживает structured clone и не зависит от того, как мы сегодня
      // раскладываем события. Нормализация — одна на оба пути, ниже.
      const cached = await loadSnapshot<Record<string, any>>(SNAPSHOT_INIT);
      if (!cached) throw toOfflineError(networkError);
      return { ...normalizeInitPayload(cached.value), offlineSnapshotAt: cached.savedAt };
    }
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

    // Снимок обновляем только на полноценном ответе. Кешировать «команды пока
    // нет» или админский ответ нельзя: человек уедет на турнир со снимком,
    // который заведомо не пустит его в приложение.
    if (data?.user && data?.team && !data?.noTeamYet && !data?.admin) {
      void saveSnapshot(SNAPSHOT_INIT, data);
    }

    return normalizeInitPayload(data);
  },

  async listPlaces(): Promise<SavedPlace[]> {
    const res: any = await request('/places');
    return (res?.items || []) as SavedPlace[];
  },

  async createEvent(payload: {
    teamId?: string;
    type: EventType;
    title: string;
    description?: string;
    startDate: Date;
    endDate?: Date;
    location?: string;
    locationUrl?: string;
    locationAddress?: string;
    cost?: number;
    costStatus?: 'UNKNOWN' | 'ESTIMATED' | 'FINAL';
    schedule?: Array<{
      time: string;
      opponent: string;
      score?: string;
      pitZone?: 'NEAR' | 'FAR';
      gamePair?: 'FIRST' | 'SECOND';
    }>;
    recurrence?: { enabled: boolean; weekdays: string[]; untilDate: string };
  }) {
    const storage = localDevStorage();
    const localCreated = storage
      ? createLocalDevEvent(storage, {
          teamId: payload.teamId,
          type: payload.type,
          title: payload.title,
          description: payload.description,
          startAt: payload.startDate.toISOString(),
          endAt: payload.endDate ? payload.endDate.toISOString() : undefined,
          location: payload.location,
          cost: payload.cost,
        })
      : null;
    if (localCreated) {
      return localCreated;
    }

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
        locationUrl: payload.locationUrl,
        locationAddress: payload.locationAddress,
        cost: payload.cost,
        costStatus: payload.costStatus,
        schedule: payload.schedule,
        recurrence: payload.recurrence,
      }
    });
  },

  async updateEventSchedule(
    eventId: string,
    schedule: Array<{ id?: string; time: string; opponent: string; score?: string; pitZone?: 'NEAR' | 'FAR'; gamePair?: 'FIRST' | 'SECOND'; stage?: 'GROUP' | 'R16' | 'QF' | 'SF' | 'FINAL' }>
  ) {
    return request(`/events/${eventId}`, {
      method: 'PATCH',
      body: { scope: 'single', schedule },
    });
  },

  // --- Рефлексия по пойнту (#89) ---

  // Каталог укрытий отдаётся целиком (51 позиция) и не меняется в течение
  // турнира — тянем один раз на открытие формы, фильтруем на клиенте.
  // Без каталога форма рефлексии не открывается вообще — а именно её и заполняют
  // в поле, где сети нет. Поэтому каталог держим снимком: он статичный, устареть
  // за турнир не может.
  async getFieldPositions(): Promise<FieldPosition[]> {
    try {
      const data = await request<{ items: FieldPosition[] }>('/field-positions');
      void saveSnapshot(SNAPSHOT_FIELD_POSITIONS, data.items);
      return data.items;
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      const cached = await loadSnapshot<FieldPosition[]>(SNAPSHOT_FIELD_POSITIONS);
      if (!cached) throw error;
      return cached.value;
    }
  },

  // Пойнты материализуются на сервере из счёта игры — отдельного «создать» нет.
  async getGamePoints(gameId: string): Promise<GamePointsResponse> {
    return request<GamePointsResponse>(`/reflections/games/${gameId}/points`);
  },

  // Разметка «какие пойнты выиграли»: из счёта известно количество побед, но не
  // их порядок, поэтому его проставляет капитан.
  async saveGamePointResults(gameId: string, points: Array<{ ordinal: number; result: PointResult | null }>) {
    return request(`/reflections/games/${gameId}/points`, {
      method: 'PUT',
      body: { points },
      offlineQueue: { dedupeKey: `points:${gameId}`, label: 'Разметка пойнтов' },
    });
  },

  // Состав пойнта пишется целиком: капитан видит на экране пятёрку и сохраняет
  // то, что видит. opponentRosterSize — сколько было у соперника (5-на-4 после
  // штрафа это другой пойнт, и складывать его с равным составом нельзя).
  async saveGamePointRoster(pointId: string, userIds: string[], opponentRosterSize: number | null) {
    return request(`/reflections/points/${pointId}/roster`, {
      method: 'PUT',
      body: { userIds, opponentRosterSize },
      offlineQueue: { dedupeKey: `roster:${pointId}`, label: 'Состав пойнта' },
    });
  },

  // Отсутствие сети — не отсутствие формы. Офлайн отвечаем «сохранённой версии
  // нет»: то, что человек заполнит, ляжет в черновик и уедет очередью.
  async getMyReflection(pointId: string): Promise<GameReflection | null> {
    try {
      const data = await request<{ reflection: GameReflection | null }>(`/reflections/points/${pointId}/mine`);
      return data.reflection;
    } catch (error) {
      if (isOfflineError(error)) return null;
      throw error;
    }
  },

  async saveMyReflection(pointId: string, reflection: GameReflection) {
    return request(`/reflections/points/${pointId}/mine`, {
      method: 'PUT',
      body: reflection,
      offlineQueue: { dedupeKey: `reflection:${pointId}`, label: 'Рефлексия за пойнт' },
    });
  },

  // canEdit считает сервер по роли в команде — на клиенте роль не выводим,
  // от неё зависит доступ к записи.
  async getCaptainReport(pointId: string): Promise<{ report: CaptainReport | null; canEdit: boolean }> {
    return request<{ report: CaptainReport | null; canEdit: boolean }>(`/reflections/points/${pointId}/captain`);
  },

  async saveCaptainReport(pointId: string, report: CaptainReport) {
    const { initiative, ...rest } = report;
    return request(`/reflections/points/${pointId}/captain`, {
      method: 'PUT',
      body: {
        ...rest,
        initiativeSnake: initiative.snake,
        initiativeCenter: initiative.center,
        initiativeEnvelope: initiative.envelope,
      },
      offlineQueue: { dedupeKey: `captain:${pointId}`, label: 'Разбор капитана' },
    });
  },

  // Таблица разбора по всему событию: тренер смотрит турнир целиком.
  async getEventTable(eventId: string): Promise<EventTable> {
    return request<EventTable>(`/reflections/events/${eventId}/table`);
  },

  // Внутри Telegram переход по ссылке на файл открывает его отдельным окном
  // без кнопки «назад» — поэтому там CSV уходит файлом в чат, а не скачивается.
  async sendEventTableCsv(eventId: string): Promise<{ sent: boolean }> {
    return request<{ sent: boolean }>(`/reflections/events/${eventId}/table.csv/send`, { method: 'POST' });
  },


  // Изменить дату/время события (scope single). Бэкенд PATCH /events/:id умеет
  // менять start/end; роль проверяется на сервере (капитан/штаб/админ).
  async updateEventTime(eventId: string, startAt: string, endAt: string) {
    return request(`/events/${eventId}`, {
      method: 'PATCH',
      body: { scope: 'single', startAt, endAt },
    });
  },

  // Полное редактирование события (scope single): название, место (+ссылка/адрес),
  // дата/время, стоимость, описание. Роль проверяется на сервере.
  async updateEvent(
    eventId: string,
    patch: {
      title?: string;
      location?: string | null;
      locationUrl?: string | null;
      locationAddress?: string | null;
      startAt?: string;
      endAt?: string;
      cost?: number | null;
      description?: string | null;
    }
  ) {
    return request(`/events/${eventId}`, {
      method: 'PATCH',
      body: { scope: 'single', ...patch },
    });
  },

  // #61: удалить событие. scope 'single' — только это занятие (серия сохраняется),
  // scope 'future' — это и все будущие занятия серии.
  async deleteEvent(
    eventId: string,
    scope: 'single' | 'future' = 'single'
  ): Promise<{ success: boolean; deleted: number; scope: 'single' | 'future' }> {
    return request(`/events/${eventId}`, {
      method: 'DELETE',
      body: { scope },
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
    const storage = localDevStorage();
    const localAttendees = storage ? getLocalDevEventAttendees(storage, eventId) : null;
    if (localAttendees) {
      return localAttendees;
    }
    return request(`/events/${eventId}/attendees`);
  },

  async rsvp(eventId: string, userId: string, status: RSVPStatus) {
    const storage = localDevStorage();
    if (storage && updateLocalDevRsvp(storage, eventId, status)) {
      return { ok: true, eventId, userId, status };
    }
    return request('/rsvp', {
      method: 'POST',
      body: { eventId, userId, status },
    });
  },

  // #60: согласие игрока на всю серию занятий (дефолт «иду» на каждое занятие).
  async commitSeries(seriesId: string): Promise<{ ok: boolean; committed: boolean }> {
    return request(`/events/series/${seriesId}/commit`, { method: 'POST', body: {} });
  },

  async leaveSeries(seriesId: string): Promise<{ ok: boolean; committed: boolean }> {
    return request(`/events/series/${seriesId}/commit`, { method: 'DELETE' });
  },

  async getSeriesContext(seriesId: string): Promise<SeriesContextResponse> {
    return request(`/events/series/${seriesId}/context`);
  },

  // #62: фактическая явка (был/не был) — отдельный слой от намерения (RSVP).
  async getAttendance(eventId: string): Promise<EventAttendanceResponse> {
    return request(`/events/${eventId}/attendance`);
  },

  async markAttendance(
    eventId: string,
    entries: Array<{ userId: string; present: boolean }>
  ): Promise<EventAttendanceResponse & { marked: number }> {
    return request(`/events/${eventId}/attendance`, {
      method: 'POST',
      body: { entries },
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
    const storage = localDevStorage();
    const localIcs = storage ? getLocalDevIcs(storage, teamId) : null;
    if (localIcs) {
      return localIcs;
    }
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

  async createTeam(payload: { name: string; shortCode: string; timezone?: string }): Promise<TeamCreateResponse> {
    return request<TeamCreateResponse>('/teams', {
      method: 'POST',
      body: {
        name: payload.name,
        shortCode: payload.shortCode,
        ...(payload.timezone ? { timezone: payload.timezone } : {}),
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
