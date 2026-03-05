import { EventType, RSVPStatus, Role, PlayerStatus } from './types';
import { Trophy, Target, Wrench, Users, Calendar, Flag, Zap } from 'lucide-react';

export const EVENT_COLORS: Record<EventType, string> = {
  [EventType.TRAINING]: '#00E676',
  [EventType.TOURNAMENT]: '#FF1744',
  [EventType.CHAMPIONSHIP]: '#FFEA00', // Using Highlight for ease
  [EventType.FRIENDLY_MATCH]: '#2979FF',
  [EventType.MEETING]: '#FF6D00',
  [EventType.MAINTENANCE]: '#78909C',
  [EventType.OTHER]: '#AB47BC',
};

export const EVENT_LABELS: Record<EventType, string> = {
  [EventType.TRAINING]: 'Тренировка',
  [EventType.TOURNAMENT]: 'Турнир',
  [EventType.CHAMPIONSHIP]: 'Чемпионат',
  [EventType.FRIENDLY_MATCH]: 'Спарринг',
  [EventType.MEETING]: 'Сбор',
  [EventType.MAINTENANCE]: 'ТО маркеров',
  [EventType.OTHER]: 'Другое',
};

export const RSVP_COLORS: Record<RSVPStatus, string> = {
  [RSVPStatus.UNANSWERED]: 'text-pb-subtext border-white/30',
  [RSVPStatus.PENDING]: 'text-pb-warning border-pb-warning',
  [RSVPStatus.CONFIRMED]: 'text-pb-primary border-pb-primary',
  [RSVPStatus.DECLINED]: 'text-pb-danger border-pb-danger',
};

export const ROLE_LABELS: Record<Role, string> = {
  [Role.ADMIN]: 'Админ',
  [Role.CAPTAIN]: 'Капитан',
  [Role.TRAINER]: 'Тренер',
  [Role.PLAYER]: 'Игрок',
};

export const STATUS_LABELS: Record<PlayerStatus, string> = {
  [PlayerStatus.ACTIVE]: 'В строю',
  [PlayerStatus.INJURED]: 'Травма',
  [PlayerStatus.RESERVE]: 'Запас',
  [PlayerStatus.VACATION]: 'Отпуск',
};

export const STATUS_COLORS: Record<PlayerStatus, string> = {
  [PlayerStatus.ACTIVE]: 'bg-pb-primary',
  [PlayerStatus.INJURED]: 'bg-pb-danger',
  [PlayerStatus.RESERVE]: 'bg-pb-warning',
  [PlayerStatus.VACATION]: 'bg-blue-400',
};

export const getEventIcon = (type: EventType) => {
  switch (type) {
    case EventType.TRAINING: return Target;
    case EventType.TOURNAMENT: return Trophy;
    case EventType.CHAMPIONSHIP: return Flag;
    case EventType.FRIENDLY_MATCH: return Zap;
    case EventType.MEETING: return Users;
    case EventType.MAINTENANCE: return Wrench;
    default: return Calendar;
  }
};
