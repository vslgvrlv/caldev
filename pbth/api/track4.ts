import { request } from '../api';

// Трек 4 «Открытые слоты»: запросы к модулю `/slots` (backend/src/modules/slots).
// Команда в этих ручках — в адресе или в самом событии, заголовок экрана не
// нужен: подписчик приходит с экрана другой команды или вовсе без команды.

export type SlotTeamCard = {
  id: string;
  name: string;
  logo: string | null;
  following: boolean;
  openSchedule: boolean;
  openEvents: number;
};

export type SlotOffer = {
  eventId: string;
  teamId: string;
  teamName: string;
  timezone: string | null;
  title: string;
  type: string;
  startAt: string;
  endAt: string | null;
  location: string | null;
  price: number;
  capacity: number;
  free: number;
  open: boolean;
  booked: boolean;
  myBooking: { paid: boolean; price: number } | null;
};

export type SlotState = {
  status: 'OPEN' | 'CLOSED';
  open: boolean;
  capacity: number;
  price: number;
  booked: number;
  free: number;
};

export type SlotGuest = {
  userId: string;
  name: string;
  nickname: string;
  avatar: string | null;
  paid: boolean;
  price: number;
  bookedAt: string;
};

export type SlotManageView = {
  openSchedule: boolean;
  followers: number;
  slot: SlotState | null;
  guests: SlotGuest[];
};

export type SlotEventView = {
  viewer: 'MANAGER' | 'MEMBER' | 'GUEST' | 'FOLLOWER';
  eventId: string;
  teamId: string;
  teamName: string;
  teamLogo: string | null;
  timezone: string | null;
  title: string;
  type: string;
  startAt: string;
  endAt: string | null;
  location: string | null;
  started: boolean;
  ended: boolean;
  slot: SlotState | null;
  myBooking: { paid: boolean; price: number } | null;
  // Только гостю:
  description?: string | null;
  locationUrl?: string | null;
  schedule?: Array<{ id: string; time: string; opponent: string; score: string | null }>;
  going?: Array<{ name: string; nickname: string; avatar: string | null; guest: boolean }>;
};

export type SlotFeed = { following: SlotTeamCard[]; slots: SlotOffer[]; bookings: SlotOffer[] };

export type SlotTeamPage = {
  team: SlotTeamCard | null;
  member: boolean;
  role: string | null;
  canManage: boolean;
  followers?: number;
  slots: SlotOffer[];
};

const enc = encodeURIComponent;

export const slotsApi = {
  openTeams: () => request<{ teams: SlotTeamCard[] }>('/slots/teams'),
  team: (teamId: string) => request<SlotTeamPage>(`/slots/teams/${enc(teamId)}`),
  setOpenSchedule: (teamId: string, enabled: boolean) =>
    request<{ openSchedule: boolean; followers: number }>(`/slots/teams/${enc(teamId)}/open-schedule`, {
      method: 'PUT',
      body: { enabled },
    }),
  follow: (teamId: string) => request<{ following: boolean }>(`/slots/teams/${enc(teamId)}/follow`, { method: 'POST' }),
  unfollow: (teamId: string) =>
    request<{ following: boolean }>(`/slots/teams/${enc(teamId)}/follow`, { method: 'DELETE' }),
  feed: () => request<SlotFeed>('/slots/feed'),
  summary: () => request<{ free: number; bookings: number }>('/slots/summary'),
  event: (eventId: string) => request<SlotEventView>(`/slots/events/${enc(eventId)}`),
  manage: (eventId: string) => request<SlotManageView>(`/slots/events/${enc(eventId)}/manage`),
  open: (eventId: string, capacity: number, price: number) =>
    request<SlotManageView>(`/slots/events/${enc(eventId)}`, { method: 'PUT', body: { capacity, price } }),
  close: (eventId: string) => request<SlotManageView>(`/slots/events/${enc(eventId)}`, { method: 'DELETE' }),
  book: (eventId: string) => request<SlotEventView>(`/slots/events/${enc(eventId)}/book`, { method: 'POST' }),
  leave: (eventId: string) =>
    request<{ cancelled: boolean }>(`/slots/events/${enc(eventId)}/book`, { method: 'DELETE' }),
  removeGuest: (eventId: string, userId: string) =>
    request<SlotManageView>(`/slots/events/${enc(eventId)}/guests/${enc(userId)}`, { method: 'DELETE' }),
  setPaid: (eventId: string, userId: string, paid: boolean) =>
    request<SlotManageView>(`/slots/events/${enc(eventId)}/guests/${enc(userId)}`, { method: 'PATCH', body: { paid } }),
};

/** Адреса экрана `/teams`: список, страница команды, событие. */
export const slotsPath = {
  list: () => '/teams',
  team: (teamId: string) => `/teams?team=${enc(teamId)}`,
  event: (eventId: string) => `/teams?event=${enc(eventId)}`,
};
