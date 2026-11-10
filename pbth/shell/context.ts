import { createContext, useContext } from 'react';
import type { Event, Game, PlayerStatus, RSVPStatus, Team, TeamContext, TeamMember, Transaction, User } from '../types';

// Общее состояние приложения для экранов, оболочки и треков второй волны.
// Экран трека берёт команду, роль и данные отсюда: `const shell = useShell()`.

export type TeamLoadState = 'idle' | 'loading' | 'ready' | 'forbidden' | 'error';

export type EventReminderPayload = {
  eventId: string;
  audience: 'ALL' | 'RESPONDED' | 'UNANSWERED' | 'CONFIRMED' | 'PENDING' | 'DECLINED';
  template: 'EVENT_REMINDER' | 'WARMUP_REMINDER' | 'ROLE_REMINDER' | 'GAME_GATHERING' | 'GAME_WARMUP';
  gameId?: string;
};

export type EventEditPatch = {
  title: string;
  location?: string;
  locationUrl?: string;
  locationAddress?: string;
  startISO: string;
  endISO: string;
  cost?: number;
  description?: string;
};

export type GamePatch = {
  time: string;
  opponent: string;
  score?: string;
  pitZone?: 'NEAR' | 'FAR';
  gamePair?: 'FIRST' | 'SECOND';
};

export type ShellActions = {
  /** true — ответ принят сервером (или ушёл в очередь без сети); false — отказ, он уже показан. */
  rsvp: (eventId: string, status: RSVPStatus) => Promise<boolean>;
  commitSeries: (seriesId: string) => Promise<void>;
  deleteEvent: (eventId: string, scope: 'single' | 'future') => Promise<void>;
  editEventTime: (eventId: string, startISO: string, endISO: string) => Promise<void>;
  editEvent: (eventId: string, patch: EventEditPatch) => Promise<void>;
  /** true — событие создано. */
  createEvent: (eventData: any) => Promise<boolean>;
  addGame: (eventId: string, game: Omit<Game, 'id'>) => Promise<void>;
  updateGame: (eventId: string, gameId: string, patch: GamePatch) => Promise<void>;
  sendEventReminder: (payload: EventReminderPayload) => Promise<void>;
  updateMemberStatus: (member: TeamMember, status: PlayerStatus) => Promise<void>;
  removeMember: (member: TeamMember) => Promise<void>;
  addTransaction: (t: Omit<Transaction, 'id' | 'date'>) => Promise<void>;
  remindDebtor: (userId: string, userName: string) => Promise<void>;
  remindAllDebtors: () => Promise<void>;
  copyIcsLink: () => Promise<void>;
  shareIcsLink: () => Promise<void>;
  downloadIcs: () => Promise<void>;
  logout: () => Promise<void>;
  login: (target?: string) => Promise<void>;
  joinedTeam: () => Promise<void>;
  openRsvpModal: (event: Event) => void;
};

export type ShellState = {
  authStep: 'LOGIN' | 'ROLE_SELECT' | 'APP';
  authBootstrapDone: boolean;
  appGate: 'READY' | 'NO_TEAM';
  onboardingRequired: boolean;
  /** Владелец платформы: консоль `/admin` и все команды в переключателе. */
  canEnterAdmin: boolean;
  offlineSnapshotAt: number | null;
  outboxState: { pending: number; blocked: number };

  user: User | null;
  /** Команда, чьи данные сейчас загружены. */
  team: Team | null;
  /** Код загруженной команды, как в адресе (нижний регистр). */
  teamCode: string | null;
  teamLoad: TeamLoadState;
  teams: TeamContext[];
  events: Event[];
  members: TeamMember[];
  transactions: Transaction[];
  calendarLink: string;

  /** Загрузить команду из адреса. Повторный вызов с той же командой — no-op. */
  ensureTeam: (code: string) => void;
  /** Перечитать данные текущей команды без спиннера. */
  reload: () => Promise<void>;
  actions: ShellActions;
};

export const ShellContext = createContext<ShellState | null>(null);

export function useShell(): ShellState {
  const value = useContext(ShellContext);
  if (!value) throw new Error('useShell вызван вне оболочки приложения');
  return value;
}
