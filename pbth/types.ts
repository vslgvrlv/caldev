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
  rsvpStatus: RSVPStatus;
  attendeesCount: number;
  maxAttendees?: number;
  cost?: number;
  isConflict?: boolean;
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
  type: TransactionType;
  amount: number;
  title: string;
  date: Date;
  userId?: string; // Who paid or was charged
  userName?: string;
  status: 'PENDING' | 'COMPLETED';
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
