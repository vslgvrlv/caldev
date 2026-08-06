export enum Role {
  ADMIN = 'ADMIN',
  CAPTAIN = 'CAPTAIN',
  TRAINER = 'TRAINER',
  PLAYER = 'PLAYER'
}

export enum EventType {
  TRAINING = 'TRAINING',
  TOURNAMENT = 'TOURNAMENT',
  CHAMPIONSHIP = 'CHAMPIONSHIP',
  FRIENDLY_MATCH = 'FRIENDLY_MATCH',
  MEETING = 'MEETING',
  MAINTENANCE = 'MAINTENANCE',
  OTHER = 'OTHER'
}

export enum RSVPStatus {
  UNANSWERED = 'UNANSWERED',
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  DECLINED = 'DECLINED'
}

export enum PlayerStatus {
  ACTIVE = 'ACTIVE',
  INJURED = 'INJURED',
  RESERVE = 'RESERVE',
  VACATION = 'VACATION'
}

export interface User {
  id: string;
  name: string;
  avatar?: string;
  nickname: string;
  telegramUsername?: string;
  telegramId?: string;
  password?: string;
}

export interface TeamMember extends User {
  membershipId?: string;
  role: Role;
  status: PlayerStatus;
  phone?: string;
  stats?: PlayerStats; // New: Linked stats
  balance?: number; // New: Positive = overpaid, Negative = debt
}

export interface Team {
  id: string;
  name: string;
  shortCode: string;
  logo?: string;
  timezone?: string;
  role: Role;
  budget: number; // New: Team treasury
}

export interface Game {
  id: string;
  time: string;
  opponent: string;
  score?: string;
  pitZone?: "NEAR" | "FAR";
  gamePair?: "FIRST" | "SECOND";
}

// Каталог укрытий на поле (#89). Максимальная конфигурация, 51 позиция;
// поле конкретного турнира — подмножество по флагу active.
export interface FieldPosition {
  id: string;
  group: 'grid' | 'snake' | 'envelope';
  index: string;
  side: 'NEAR' | 'FAR' | 'CENTER';
  code: string;
  // Подпись на кнопке схемы, без суффикса половины: половины подписаны
  // заголовками, дублировать Б/Д на каждой кнопке — шум.
  shortCode: string;
  depth: number;
  label: string;
  active: boolean;
}

export type PointResult = 'WIN' | 'LOSS';

// Пойнт — единица рефлексии. Гейм со счётом 4:3 состоит из семи пойнтов.
export interface GamePoint {
  id: string;
  ordinal: number;
  // null = пойнт ещё не размечен капитаном (из счёта известно только количество побед).
  result: PointResult | null;
  filledCount: number;
  mineFilled: boolean;
  captainFilled: boolean;
  // Кто из наших выходил на этот пойнт. Пустой массив = состав не записан
  // (старые события), и тогда пойнт открыт всем — см. mineInRoster.
  roster: string[];
  opponentRosterSize: number | null;
  mineInRoster: boolean;
}

// Кандидат в состав пойнта: член команды с отметкой явки на событие.
// present = null — явку на событии не отмечали.
export interface RosterCandidate {
  userId: string;
  name: string;
  nickname: string;
  present: boolean | null;
}

export interface GamePointsResponse {
  gameId: string;
  score: string | null;
  canMarkResults: boolean;
  canEditRoster: boolean;
  candidates: RosterCandidate[];
  expected: { wins: number; losses: number; total: number } | null;
  resultsMatchScore: boolean | null;
  points: GamePoint[];
}

// Фаза — когда это произошло. Одна шкала для поражения и для килла.
export type ReflectionPhase = 'BREAK' | 'COVER' | 'ROTATION';

export interface ReflectionKill {
  phase: ReflectionPhase;
  positionId: string | null;
}

// Как игрок покинул поле. Штрафной вывод — отдельный исход, а не разновидность
// смерти: иначе тепловая карта показывает укрытие, на котором игрока никто не
// выбивал, а соперник получает фраг, которого не было (#104).
export type ExitReason = 'SURVIVED' | 'HIT' | 'PENALTY';
// Чей штраф на игроке. Ось независима от exitReason: «сняли за мой штраф» =
// (PENALTY, OWN), «сняли в довесок по 2-за-1» = (PENALTY, TEAMMATE).
export type PenaltyKind = 'OWN' | 'TEAMMATE';

export interface GameReflection {
  exitReason: ExitReason;
  penaltyKind: PenaltyKind | null;
  exitPhase: ReflectionPhase | null;
  exitPositionId: string | null;
  kills: ReflectionKill[];
  // Самооценка 1–5. null = экран пропущен, это не ноль.
  selfRating: number | null;
  note: string | null;
}

// Комбинация — план на пойнт (§3.2 спеки).
export type GameCombination = 'ENVELOPE_ATTACK' | 'SNAKE_ATTACK' | 'ACTIVE_SNAKE' | 'ACTIVE_ENVELOPE';
export type BreakWidth = 'NARROW' | 'WIDE';

// Капитанский отчёт: верхнеуровневый взгляд на тот же пойнт. Существует ровно
// один на пойнт, редактируют капитан и тренер. Результата пойнта здесь нет —
// он объективен и живёт в самом пойнте.
export interface CaptainReport {
  combination: GameCombination | null;
  breakWidth: BreakWidth | null;
  opponentBreakWidth: BreakWidth | null;
  // Инициатива по трём линиям: -1 у них, 0 поровну, +1 у нас (§2.2).
  initiative: { snake: number | null; center: number | null; envelope: number | null };
  deltaOtb: number | null;
  note: string | null;
}

// Таблица разбора по событию — рабочая поверхность тренера и источник выгрузки.
export interface EventTablePoint {
  pointId: string;
  ordinal: number;
  result: PointResult | null;
  submitted: number;
  ourOtbLosses: number;
  opponentOtbLosses: number;
  deltaOtb: number;
  captainReport: CaptainReport | null;
  // null = капитан дельту не проставил. Отсутствие ответа это не согласие.
  deltaOtbMismatch: boolean | null;
  reflections: Array<GameReflection & { userId: string; name: string; nickname: string }>;
}

// Winrate всегда ходит с размером выборки: «85%» из трёх пойнтов выглядит как
// знание, но это гадание. total обязателен к показу рядом с процентом.
export interface Rate {
  wins: number;
  losses: number;
  total: number;
  winRate: number | null;
}

export interface InitiativeLineSummary {
  line: 'snake' | 'center' | 'envelope';
  ours: Rate;
  theirs: Rate;
  even: Rate;
}

export interface PlayerSummary {
  userId: string;
  name: string;
  nickname: string;
  points: number;
  // Только выбивания. Штрафные выводы считаются отдельно.
  eliminated: number;
  penalties: number;
  ownPenalties: number;
  deathPhases: Record<string, number>;
  kills: number;
  killPhases: Record<string, number>;
  avgSelfRating: number | null;
  avgSelfRatingInLosses: number | null;
}

export type FieldZone = 'snake' | 'center' | 'envelope';

// Выбивания по зоне поля: это часть-от-целого, а не сравнение winrate.
export interface ZoneDeaths {
  zone: FieldZone;
  total: number;
  byPhase: Record<string, number>;
}

// Сводка по событию — ответы на вопросы спеки, а не показ данных.
export interface EventSummary {
  coverage: {
    points: number;
    marked: number;
    withReflections: number;
    withCaptainReport: number;
    // Обычный состав на пойнте, выведенный из самих данных (мода числа форм).
    squadSize: number;
    withFullSquad: number;
  };
  // Winrate турнира целиком — якорь, с которым сравниваются проценты блоков.
  overall: Rate;
  deltaOtb: Array<{ delta: number } & Rate>;
  equalSquads: { points: number; lines: InitiativeLineSummary[] };
  combinations: Array<{ combination: GameCombination } & Rate>;
  breakWidth: Array<{ ours: BreakWidth; theirs: BreakWidth } & Rate>;
  deaths: { total: number; byPhase: Record<string, number>; zones: ZoneDeaths[] };
  players: PlayerSummary[];
  captainMismatch: { compared: number; mismatched: number };
}

export interface EventTable {
  eventId: string;
  eventTitle: string;
  // id укрытия -> код для чтения человеком («grid.300.far» -> «300Д»).
  positions: Record<string, string>;
  // id укрытия -> зона поля. Нужна сводке, чтобы свести 51 фигуру к трём зонам.
  positionZones: Record<string, FieldZone>;
  summary: EventSummary;
  games: Array<{
    gameId: string;
    time: string;
    opponent: string;
    score: string | null;
    points: EventTablePoint[];
  }>;
}

export interface AttendeePreview {
  userId: string;
  name: string;
  nickname: string;
  avatar?: string;
}

export interface Event {
  id: string;
  teamId: string;
  viewerRole?: Role;
  teamTimezone?: string;
  financeState?: 'NOT_CALCULATED' | 'COLLECTING' | 'CLOSED';
  type: EventType;
  title: string;
  description?: string;
  startAt?: string;
  endAt?: string;
  startDate: Date;
  endDate?: Date;
  location?: string;
  locationUrl?: string;
  rsvpStatus: RSVPStatus;
  attendeesCount: number;
  maxAttendees?: number;
  cost?: number;
  isConflict?: boolean;
  seriesId?: string;
  seriesCommitted?: boolean;
  schedule?: Game[];
  attendeePreview?: AttendeePreview[];
}

// --- NEW FINANCE TYPES ---
export enum TransactionType {
  DEPOSIT = 'DEPOSIT', // Player pays to team
  EXPENSE = 'EXPENSE', // Team pays for something
  FEE = 'FEE'          // Charge applied to player (creates debt)
}

export interface Transaction {
  id: string;
  teamId?: string;
  type: TransactionType;
  amount: number;
  title: string;
  date: Date;
  userId?: string; // Who paid or was charged
  userName?: string;
  eventId?: string;
  status: 'PENDING' | 'COMPLETED';
}

export interface TeamContext {
  membershipId: string;
  teamId: string;
  teamName: string;
  shortCode?: string;
  role: Role;
}

export type TransferConfirmationStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';

export interface TransferConfirmation {
  id: string;
  teamId: string;
  teamName?: string;
  userId: string;
  userName: string;
  userNickname?: string;
  amount: number;
  screenshotDataUrl: string;
  note?: string;
  reviewNote?: string;
  status: TransferConfirmationStatus;
  submittedAt: string;
  reviewedAt?: string;
  submittedBy: {
    userId: string;
    name?: string;
  };
  reviewedBy?: {
    userId: string;
    name?: string;
  };
  transactionId?: string;
}

// --- NEW STATS TYPES ---
export interface PlayerStats {
  attendanceRate: number; // %
  eventsAttended: number;
  totalEvents: number;
  mvpCount: number;
  matchesPlayed: number;
}

export type ViewState = 'DASHBOARD' | 'CALENDAR' | 'CREATE' | 'TEAM' | 'PROFILE' | 'FINANCE' | 'EVENT_DETAILS';

export type AuthStep = 'LOGIN' | 'ROLE_SELECT' | 'APP';

export interface UserRoleOption {
  teamId: string;
  teamName: string;
  role: Role;
}
