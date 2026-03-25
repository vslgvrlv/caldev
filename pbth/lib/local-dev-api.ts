import { EventType, PlayerStatus, RSVPStatus, Role, TransactionType, type Event, type Team, type TeamContext, type TeamMember, type Transaction, type User } from "../types";

export type LocalDevProfile = "captain" | "player";

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

type LocalDevSession = {
  profile: LocalDevProfile;
};

type RawEvent = Omit<Event, "startDate" | "endDate"> & {
  startAt: string;
  endAt: string;
};

type LocalDevState = {
  profile: LocalDevProfile;
  user: User;
  team: Team;
  teams: TeamContext[];
  members: TeamMember[];
  events: RawEvent[];
  transactions: Array<Omit<Transaction, "date"> & { date: string }>;
};

const SESSION_KEY = "pbth:local-dev-session:v1";
const STATE_KEY = "pbth:local-dev-state:v1";

function isLocalHostname(hostname: string | null | undefined): boolean {
  const normalized = String(hostname || "").trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1";
}

function plusMinutes(baseTs: number, deltaMinutes: number): string {
  return new Date(baseTs + deltaMinutes * 60_000).toISOString();
}

function makeMembers(): TeamMember[] {
  return [
    {
      id: "dev-user-captain",
      name: "Dev Captain",
      nickname: "captain_dev",
      avatar: "https://i.pravatar.cc/150?u=dev-captain",
      role: Role.CAPTAIN,
      status: PlayerStatus.ACTIVE,
      balance: 1200,
    },
    {
      id: "dev-user-trainer",
      name: "Dev Trainer",
      nickname: "trainer_dev",
      avatar: "https://i.pravatar.cc/150?u=dev-trainer",
      role: Role.TRAINER,
      status: PlayerStatus.ACTIVE,
      balance: 0,
    },
    {
      id: "dev-user-player",
      name: "Dev Player",
      nickname: "player_dev",
      avatar: "https://i.pravatar.cc/150?u=dev-player",
      role: Role.PLAYER,
      status: PlayerStatus.ACTIVE,
      balance: -400,
    },
    {
      id: "dev-user-support",
      name: "Support Gunner",
      nickname: "support_dev",
      avatar: "https://i.pravatar.cc/150?u=dev-support",
      role: Role.PLAYER,
      status: PlayerStatus.ACTIVE,
      balance: 0,
    },
  ];
}

function buildState(profile: LocalDevProfile, nowTs: number): LocalDevState {
  const role = profile === "captain" ? Role.CAPTAIN : Role.PLAYER;
  const user: User =
    profile === "captain"
      ? {
          id: "dev-user-captain",
          name: "Dev Captain",
          nickname: "captain_dev",
          avatar: "https://i.pravatar.cc/150?u=dev-captain",
          telegramUsername: "captain_dev",
          telegramId: "9000000101",
        }
      : {
          id: "dev-user-player",
          name: "Dev Player",
          nickname: "player_dev",
          avatar: "https://i.pravatar.cc/150?u=dev-player",
          telegramUsername: "player_dev",
          telegramId: "9000000103",
        };

  const team: Team = {
    id: "team-hsg",
    name: "Headshot Gladiators",
    shortCode: "HSG",
    timezone: "Europe/Moscow",
    role,
    budget: 45000,
  };

  const teams: TeamContext[] = [
    {
      membershipId: profile === "captain" ? "00000000-0000-0000-0000-000000000101" : "00000000-0000-0000-0000-000000000103",
      teamId: team.id,
      teamName: team.name,
      shortCode: team.shortCode,
      role,
    },
  ];

  const members = makeMembers();
  const attendeePreview = members
    .filter((member) => member.role !== Role.TRAINER)
    .map((member) => ({
      userId: member.id,
      name: member.name,
      nickname: member.nickname,
      avatar: member.avatar,
    }));

  const heroPendingStatus = profile === "captain" ? RSVPStatus.UNANSWERED : RSVPStatus.PENDING;
  const events: RawEvent[] = [
    {
      id: "dev-event-ongoing-soon",
      teamId: team.id,
      viewerRole: role,
      teamTimezone: team.timezone,
      type: EventType.TRAINING,
      title: "Текущая тренировка",
      description: "Локальный fixture для проверки hero-card и safe area.",
      startAt: plusMinutes(nowTs, -45),
      endAt: plusMinutes(nowTs, 20),
      location: "Арена Север",
      rsvpStatus: heroPendingStatus,
      attendeesCount: attendeePreview.length,
      attendeePreview,
    },
    {
      id: "dev-event-ongoing-late",
      teamId: team.id,
      viewerRole: role,
      teamTimezone: team.timezone,
      type: EventType.MEETING,
      title: "Длинный разбор тактики",
      description: "Второе текущее событие, которое должно проигрывать hero по более позднему завершению.",
      startAt: plusMinutes(nowTs, -30),
      endAt: plusMinutes(nowTs, 90),
      location: "Штаб команды",
      rsvpStatus: RSVPStatus.CONFIRMED,
      attendeesCount: attendeePreview.length,
      attendeePreview,
    },
    {
      id: "dev-event-upcoming-pending",
      teamId: team.id,
      viewerRole: role,
      teamTimezone: team.timezone,
      type: EventType.TOURNAMENT,
      title: "Турнир выходного дня",
      description: "Ближайшее будущее событие, которое должно оставаться в списках ниже hero.",
      startAt: plusMinutes(nowTs, 180),
      endAt: plusMinutes(nowTs, 360),
      location: "Полигон Восток",
      rsvpStatus: RSVPStatus.PENDING,
      attendeesCount: 2,
      attendeePreview,
      schedule: [
        { id: "g-1", time: "11:00", opponent: "North Wolves", gamePair: "FIRST", pitZone: "NEAR" },
      ],
    },
    {
      id: "dev-event-upcoming-confirmed",
      teamId: team.id,
      viewerRole: role,
      teamTimezone: team.timezone,
      type: EventType.FRIENDLY_MATCH,
      title: "Спарринг с South Crew",
      description: "Подтверждённое будущее событие для секции недели.",
      startAt: plusMinutes(nowTs, 1440),
      endAt: plusMinutes(nowTs, 1560),
      location: "Арена Юг",
      rsvpStatus: RSVPStatus.CONFIRMED,
      attendeesCount: 2,
      attendeePreview,
    },
  ];

  const transactions: LocalDevState["transactions"] = [
    {
      id: "dev-tx-1",
      teamId: team.id,
      type: TransactionType.DEPOSIT,
      amount: 2000,
      title: "Взнос на месяц",
      date: plusMinutes(nowTs, -600),
      userId: "dev-user-player",
      userName: "Dev Player",
      status: "COMPLETED",
    },
    {
      id: "dev-tx-2",
      teamId: team.id,
      type: TransactionType.EXPENSE,
      amount: 1500,
      title: "Шары и воздух",
      date: plusMinutes(nowTs, -300),
      status: "COMPLETED",
    },
  ];

  return {
    profile,
    user,
    team,
    teams,
    members,
    events,
    transactions,
  };
}

function readSession(storage: StorageLike): LocalDevSession | null {
  const raw = storage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LocalDevSession;
  } catch {
    return null;
  }
}

function readState(storage: StorageLike): LocalDevState | null {
  const raw = storage.getItem(STATE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LocalDevState;
  } catch {
    return null;
  }
}

function writeState(storage: StorageLike, state: LocalDevState) {
  storage.setItem(STATE_KEY, JSON.stringify(state));
}

function normalizeEvents(events: RawEvent[]): Event[] {
  return events
    .map((event) => ({
      ...event,
      startDate: new Date(event.startAt),
      endDate: event.endAt ? new Date(event.endAt) : undefined,
    }))
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
}

export function createLocalDevSession(storage: StorageLike, profile: LocalDevProfile, nowTs = Date.now()) {
  storage.setItem(SESSION_KEY, JSON.stringify({ profile }));
  writeState(storage, buildState(profile, nowTs));
}

export function clearLocalDevSession(storage: StorageLike) {
  storage.removeItem(SESSION_KEY);
  storage.removeItem(STATE_KEY);
}

export function getLocalDevAuthMe(storage: StorageLike, pageHostname: string) {
  if (!isLocalHostname(pageHostname)) return null;
  const session = readSession(storage);
  const state = readState(storage);
  if (!session || !state) return null;

  return {
    authenticated: true,
    user: {
      id: state.user.id,
      name: state.user.name,
      nickname: state.user.nickname,
      telegramUsername: state.user.telegramUsername || null,
      avatar: state.user.avatar || null,
    },
    accountRole: "USER" as const,
    roleSelectionRequired: false,
    canChooseAdminRole: false,
    isOwnerAdminEligible: false,
    hasMemberships: true,
    activeMembershipId: state.teams[0]?.membershipId || null,
    activeTeamId: state.team.id,
    authMethod: "DEV" as const,
    capabilities: [],
    adminScope: "NONE" as const,
    managedTeamIds: [],
    availableRoles: state.teams.map((item) => ({
      membershipId: item.membershipId,
      teamId: item.teamId,
      teamName: item.teamName,
      role: item.role,
    })),
  };
}

export function getLocalDevInitData(storage: StorageLike, pageHostname: string) {
  if (!isLocalHostname(pageHostname)) return null;
  const state = readState(storage);
  if (!state) return null;

  return {
    user: state.user,
    team: state.team,
    teams: state.teams,
    members: state.members,
    events: normalizeEvents(state.events),
    transactions: state.transactions.map((item) => ({
      ...item,
      date: new Date(item.date),
    })),
    noTeamYet: false,
    admin: false,
  };
}

export function updateLocalDevRsvp(storage: StorageLike, eventId: string, status: RSVPStatus): boolean {
  const state = readState(storage);
  if (!state) return false;

  let changed = false;
  state.events = state.events.map((event) => {
    if (event.id !== eventId) return event;
    changed = true;
    const nextAttendeesCount =
      status === RSVPStatus.CONFIRMED && event.rsvpStatus !== RSVPStatus.CONFIRMED
        ? event.attendeesCount + 1
        : status !== RSVPStatus.CONFIRMED && event.rsvpStatus === RSVPStatus.CONFIRMED
          ? Math.max(0, event.attendeesCount - 1)
          : event.attendeesCount;
    return {
      ...event,
      rsvpStatus: status,
      attendeesCount: nextAttendeesCount,
    };
  });

  if (!changed) return false;
  writeState(storage, state);
  return true;
}

export function createLocalDevEvent(
  storage: StorageLike,
  payload: {
    teamId?: string;
    type: EventType | string;
    title: string;
    description?: string;
    startAt: string;
    endAt?: string;
    location?: string;
    cost?: number;
  }
) {
  const state = readState(storage);
  if (!state) return null;

  const created: RawEvent = {
    id: `dev-event-${Date.now()}`,
    teamId: payload.teamId || state.team.id,
    viewerRole: state.team.role,
    teamTimezone: state.team.timezone,
    type: payload.type as EventType,
    title: payload.title,
    description: payload.description,
    startAt: payload.startAt,
    endAt: payload.endAt || plusMinutes(new Date(payload.startAt).getTime(), 120),
    location: payload.location,
    cost: payload.cost,
    rsvpStatus: RSVPStatus.UNANSWERED,
    attendeesCount: 0,
    attendeePreview: [],
  };

  state.events = [...state.events, created].sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
  writeState(storage, state);

  return {
    event: {
      ...created,
      startDate: new Date(created.startAt),
      endDate: created.endAt ? new Date(created.endAt) : undefined,
    },
  };
}

export function getLocalDevEventAttendees(storage: StorageLike, eventId: string) {
  const state = readState(storage);
  if (!state) return null;
  const event = state.events.find((item) => item.id === eventId);
  if (!event) return null;

  const attendees = (event.attendeePreview || []).map((item) => {
    const member = state.members.find((candidate) => candidate.id === item.userId);
    const role: "CAPTAIN" | "TRAINER" | "PLAYER" =
      member?.role === Role.CAPTAIN ? "CAPTAIN" : member?.role === Role.TRAINER ? "TRAINER" : "PLAYER";
    const memberStatus: "ACTIVE" | "INJURED" | "RESERVE" | "VACATION" =
      member?.status === PlayerStatus.INJURED
        ? "INJURED"
        : member?.status === PlayerStatus.RESERVE
          ? "RESERVE"
          : member?.status === PlayerStatus.VACATION
            ? "VACATION"
            : "ACTIVE";
    return {
      userId: item.userId,
      name: item.name,
      nickname: item.nickname,
      avatar: item.avatar,
      role,
      memberStatus,
      rsvpStatus: "CONFIRMED" as const,
    };
  });

  return {
    eventId,
    attendees,
  };
}

export function getLocalDevIcs(storage: StorageLike, teamId?: string) {
  const state = readState(storage);
  if (!state) return null;
  const resolvedTeamId = teamId || state.team.id;
  return {
    url: `http://127.0.0.1:3000/dev-calendar/${resolvedTeamId}.ics`,
    subscriptionUrl: `webcal://127.0.0.1:3000/dev-calendar/${resolvedTeamId}.ics`,
    downloadUrl: `http://127.0.0.1:3000/dev-calendar/${resolvedTeamId}.ics`,
    hasToken: true,
  };
}
