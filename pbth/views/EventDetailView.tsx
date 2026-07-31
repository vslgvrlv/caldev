import React, { useCallback, useEffect, useState } from 'react';
import { Event, RSVPStatus, EventType, Role, Game, PlayerStatus, Transaction, TransactionType } from '../types';
import { EVENT_COLORS, EVENT_LABELS, getEventIcon } from '../constants';
import { ChevronLeft, MapPin, Clock, Users, Check, X, HelpCircle, Swords, Plus, Repeat, Trash2, Pencil, ClipboardList } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { api, type FinanceEventDetailResponse, type SeriesContextResponse } from '../api';
import { EventCollectionSheet } from '../components/EventCollectionSheet';
import { EventExpensesSheet } from '../components/EventExpensesSheet';
import { FinanceTransactionModal } from '../components/FinanceTransactionModal';
import { TransferConfirmationModal } from '../components/TransferConfirmationModal';
import { buildEventExpensesViewModel } from '../lib/event-expenses-view-model';
import { buildEventFinanceViewModel } from '../lib/event-finance-view-model';
import { buildEventChargeModalState } from '../lib/event-charge-modal';
import { AttendanceMap } from '../components/AttendanceMap';
import { LocationAutocompleteInput } from '../components/LocationAutocompleteInput';
import { GamePointsModal } from '../components/GamePointsModal';
import { GameScoreLine } from '../components/GameScoreLine';
import { EventTableModal } from '../components/EventTableModal';

interface EventDetailAttendee {
  userId: string;
  name: string;
  nickname: string;
  avatar?: string;
  role: 'CAPTAIN' | 'TRAINER' | 'PLAYER';
  memberStatus: 'ACTIVE' | 'INJURED' | 'RESERVE' | 'VACATION';
  rsvpStatus: 'UNANSWERED' | 'PENDING' | 'CONFIRMED' | 'DECLINED';
}

interface EventDetailViewProps {
  event: Event;
  currentUserRole: Role;
  /** Имя своей команды — в расписании счёт показывается как «мы N:N соперник». */
  teamName: string;
  onBack: () => void;
  onRsvp: (id: string, status: RSVPStatus) => void;
  onAddGame: (eventId: string, game: Omit<Game, 'id'>) => void;
  onUpdateGame: (eventId: string, gameId: string, game: Omit<Game, 'id'>) => Promise<void> | void;
  onSendEventReminder: (payload: {
    eventId: string;
    audience: 'ALL' | 'RESPONDED' | 'UNANSWERED' | 'CONFIRMED' | 'PENDING' | 'DECLINED';
    template: 'EVENT_REMINDER' | 'WARMUP_REMINDER' | 'ROLE_REMINDER' | 'GAME_GATHERING' | 'GAME_WARMUP';
    gameId?: string;
  }) => Promise<void>;
  onAttendeeClick: (
    userId: string,
    seed?: { name: string; nickname: string; avatar?: string; role?: 'CAPTAIN' | 'TRAINER' | 'PLAYER' }
  ) => void;
  /** #61: удалить это занятие (scope single — серия сохраняется). Капитан/штаб. */
  onDeleteEvent?: (eventId: string, scope: 'single' | 'future') => Promise<void>;
  /** Изменить дату/время события (scope single). Капитан/штаб (тренер — тренировки/собрания). */
  onEditTime?: (eventId: string, startISO: string, endISO: string) => Promise<void>;
  /** Полное редактирование события (scope single): название, место, время, стоимость, описание. */
  onEditEvent?: (
    eventId: string,
    patch: {
      title: string;
      location?: string;
      locationUrl?: string;
      locationAddress?: string;
      startISO: string;
      endISO: string;
      cost?: number;
      description?: string;
    }
  ) => Promise<void>;
}

const PIT_ZONE_LABELS: Record<'NEAR' | 'FAR', string> = {
  NEAR: 'Ближняя пит-зона',
  FAR: 'Дальняя пит-зона',
};

const PIT_ZONE_BADGE: Record<'NEAR' | 'FAR', string> = {
  NEAR: 'Ближняя',
  FAR: 'Дальняя',
};

const GAME_PAIR_LABELS: Record<'FIRST' | 'SECOND', string> = {
  FIRST: 'Первая пара',
  SECOND: 'Вторая пара',
};

// Русская плюрализация «занятие» для баннера серии (#60): 1 занятие, 2 занятия, 5 занятий.
const pluralizeOccurrence = (count: number): string => {
  const mod100 = Math.abs(count) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return 'занятий';
  if (mod10 === 1) return 'занятие';
  if (mod10 >= 2 && mod10 <= 4) return 'занятия';
  return 'занятий';
};

export const EventDetailView: React.FC<EventDetailViewProps> = ({
  event,
  currentUserRole,
  teamName,
  onBack,
  onRsvp,
  onAddGame,
  onUpdateGame,
  onSendEventReminder,
  onAttendeeClick,
  onDeleteEvent,
  onEditTime,
  onEditEvent,
}) => {
  const Icon = getEventIcon(event.type);
  const color = EVENT_COLORS[event.type];

  const [isAddingGame, setIsAddingGame] = useState(false);
  const [newGameTime, setNewGameTime] = useState('');
  const [newGameOpponent, setNewGameOpponent] = useState('');
  const [newGamePitZone, setNewGamePitZone] = useState<'NEAR' | 'FAR'>('NEAR');
  const [newGamePair, setNewGamePair] = useState<'FIRST' | 'SECOND'>('FIRST');

  const [pointsGame, setPointsGame] = useState<Game | null>(null);
  const [isTableOpen, setIsTableOpen] = useState(false);
  const [editingGame, setEditingGame] = useState<Game | null>(null);
  const [editGameTime, setEditGameTime] = useState('');
  const [editGameOpponent, setEditGameOpponent] = useState('');
  const [editGameScore, setEditGameScore] = useState('');
  const [editGamePitZone, setEditGamePitZone] = useState<'NEAR' | 'FAR'>('NEAR');
  const [editGamePair, setEditGamePair] = useState<'FIRST' | 'SECOND'>('FIRST');
  const [isSavingGame, setIsSavingGame] = useState(false);
  const [isRemindingUnanswered, setIsRemindingUnanswered] = useState(false);
  const [reminderAudience, setReminderAudience] = useState<'ALL' | 'RESPONDED' | 'UNANSWERED' | 'CONFIRMED' | 'PENDING' | 'DECLINED'>('UNANSWERED');
  const [reminderTemplate, setReminderTemplate] = useState<'EVENT_REMINDER' | 'WARMUP_REMINDER' | 'ROLE_REMINDER' | 'GAME_GATHERING' | 'GAME_WARMUP'>('EVENT_REMINDER');
  const [reminderGameId, setReminderGameId] = useState<string>('');

  const [attendees, setAttendees] = useState<EventDetailAttendee[]>([]);
  const [isAttendeesLoading, setIsAttendeesLoading] = useState(false);
  const [seriesContext, setSeriesContext] = useState<SeriesContextResponse | null>(null);
  const [isSeriesBusy, setIsSeriesBusy] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isDeletingEvent, setIsDeletingEvent] = useState(false);
  // Редактирование события: модалка с названием/местом/датой/временем/стоимостью/описанием.
  const [isEditTimeOpen, setIsEditTimeOpen] = useState(false);
  const [isSavingTime, setIsSavingTime] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editLocationUrl, setEditLocationUrl] = useState('');
  const [editLocationAddress, setEditLocationAddress] = useState('');
  const [editCost, setEditCost] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editStartTime, setEditStartTime] = useState('');
  const [editEndTime, setEditEndTime] = useState('');
  // #62: фактическая явка (был/не был). draft = текущее состояние тумблеров.
  const [isAttendanceOpen, setIsAttendanceOpen] = useState(false);
  const [attendanceDraft, setAttendanceDraft] = useState<Record<string, boolean>>({});
  const [isAttendanceLoading, setIsAttendanceLoading] = useState(false);
  const [isSavingAttendance, setIsSavingAttendance] = useState(false);
  const [financeDetail, setFinanceDetail] = useState<FinanceEventDetailResponse | null>(null);
  const [isFinanceLoading, setIsFinanceLoading] = useState(false);
  const [isExpensesSheetOpen, setIsExpensesSheetOpen] = useState(false);
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<(Partial<Transaction> & { id?: string }) | null>(null);
  const [isChargeModalOpen, setIsChargeModalOpen] = useState(false);
  const [isCollectionSheetOpen, setIsCollectionSheetOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferDefaultUserId, setTransferDefaultUserId] = useState<string | undefined>(undefined);
  const [chargeAmountMode, setChargeAmountMode] = useState<'UNDISTRIBUTED_SPLIT' | 'FIXED_PER_PERSON'>('UNDISTRIBUTED_SPLIT');
  const [chargeAudience, setChargeAudience] = useState<'CONFIRMED_ONLY' | 'CONFIRMED_AND_PENDING'>('CONFIRMED_ONLY');
  const [chargeAmount, setChargeAmount] = useState('');
  const [isSubmittingCharges, setIsSubmittingCharges] = useState(false);
  const [isRemindingDebtors, setIsRemindingDebtors] = useState(false);

  const isAdminOrCaptain = currentUserRole === Role.ADMIN || currentUserRole === Role.CAPTAIN;
  // #61: ответ на занятие серии = оверрайд только этого занятия (серия в целом сохраняется).
  const isSeriesOccurrence = Boolean(event.seriesId);
  // #61: тренер управляет только тренировками/собраниями (зеркалит правило бэкенда).
  const isTrainerManageableType = event.type === EventType.TRAINING || event.type === EventType.MEETING;
  const canDeleteEvent =
    Boolean(onDeleteEvent) &&
    (isAdminOrCaptain || (currentUserRole === Role.TRAINER && isTrainerManageableType));
  const canEditEvent =
    Boolean(onEditTime) &&
    (isAdminOrCaptain || (currentUserRole === Role.TRAINER && isTrainerManageableType));
  // #62: явку отмечает капитан/штаб; тренер — только тренировки/собрания (как на бэкенде).
  const canManageAttendance = isAdminOrCaptain || (currentUserRole === Role.TRAINER && isTrainerManageableType);
  // #89: таблица разбора — рабочая поверхность тренера и штаба. Игроку она не
  // нужна: он видит свои пойнты. Право на чтение всё равно проверяет бэкенд.
  const canSeeEventTable = isAdminOrCaptain || currentUserRole === Role.TRAINER;
  // Явка имеет смысл только когда событие уже началось/прошло.
  const hasEventStarted = event.startDate.getTime() <= Date.now();
  const canSendEventReminder = currentUserRole !== Role.PLAYER;
  const canReadEventFinance = currentUserRole !== Role.PLAYER;
  // Расписание игр и рефлексия нужны везде, где команда выходит на поле и может
  // посмотреть на себя со стороны, — не только на турнире (Василий, 2026-07-31).
  const hasGameSchedule =
    event.type === EventType.TOURNAMENT ||
    event.type === EventType.CHAMPIONSHIP ||
    event.type === EventType.FRIENDLY_MATCH ||
    event.type === EventType.TRAINING;
  const isGameReminderTemplate = reminderTemplate === 'GAME_GATHERING' || reminderTemplate === 'GAME_WARMUP';

  // Карта явки (#48): держим ВСЕХ участников со статусами, а не только
  // CONFIRMED — иначе капитан не видит молчунов. Confirmed-списки ниже
  // фильтруются отдельно из этого же массива. Вынесено в callback, чтобы
  // перезагружать карту после согласия на серию (#60).
  const refreshAttendees = useCallback(async () => {
    try {
      const response = await api.getEventAttendees(event.id);
      setAttendees(response.attendees);
    } catch (error) {
      const fallback = (event.attendeePreview || []).map((item) => ({
        userId: item.userId,
        name: item.name,
        nickname: item.nickname,
        avatar: item.avatar,
        role: 'PLAYER' as const,
        memberStatus: 'ACTIVE' as const,
        rsvpStatus: 'CONFIRMED' as const,
      }));
      setAttendees(fallback);
    }
  }, [event.id, event.attendeePreview]);

  useEffect(() => {
    let cancelled = false;
    setIsAttendeesLoading(true);
    void refreshAttendees().finally(() => {
      if (!cancelled) setIsAttendeesLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshAttendees]);

  // #60: контекст серии — сколько занятий впереди и ходит ли игрок на серию.
  useEffect(() => {
    if (!event.seriesId) {
      setSeriesContext(null);
      return;
    }
    let cancelled = false;
    const seriesId = event.seriesId;
    void api
      .getSeriesContext(seriesId)
      .then((ctx) => {
        if (!cancelled) setSeriesContext(ctx);
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Failed to load series context', error);
          setSeriesContext(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [event.seriesId]);

  useEffect(() => {
    if (!canReadEventFinance) {
      setFinanceDetail(null);
      return;
    }

    let cancelled = false;
    const loadFinance = async () => {
      setIsFinanceLoading(true);
      try {
        const response = await api.getFinanceEventDetail(event.id);
        if (!cancelled) {
          setFinanceDetail(response);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load event finance detail', error);
          setFinanceDetail(null);
        }
      } finally {
        if (!cancelled) setIsFinanceLoading(false);
      }
    };

    void loadFinance();
    return () => {
      cancelled = true;
    };
  }, [canReadEventFinance, event.id]);

  const confirmedAttendees = attendees.filter((item) => item.rsvpStatus === 'CONFIRMED');
  const trainerAttendees = confirmedAttendees.filter((item) => item.role === 'TRAINER');
  const playerAttendees = confirmedAttendees.filter((item) => item.role !== 'TRAINER');
  const attendeesCount = confirmedAttendees.length || event.attendeesCount;

  const handleStatusChange = (status: RSVPStatus) => {
    onRsvp(event.id, status);
  };

  // #60: «Иду на все» — согласие на серию. После — перезагружаем карту явки,
  // чтобы статус игрока перетёк в «Идут» (дефолт от серии).
  const handleCommitSeries = async () => {
    if (!event.seriesId) return;
    const seriesId = event.seriesId;
    setIsSeriesBusy(true);
    try {
      await api.commitSeries(seriesId);
      setSeriesContext((prev) => (prev ? { ...prev, committed: true } : prev));
      await refreshAttendees();
    } catch (error) {
      console.error('Failed to commit to series', error);
      alert(`Не удалось записаться на серию: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      setIsSeriesBusy(false);
    }
  };

  const handleLeaveSeries = async () => {
    if (!event.seriesId) return;
    const seriesId = event.seriesId;
    setIsSeriesBusy(true);
    try {
      await api.leaveSeries(seriesId);
      setSeriesContext((prev) => (prev ? { ...prev, committed: false } : prev));
      await refreshAttendees();
    } catch (error) {
      console.error('Failed to leave series', error);
      alert(`Не удалось выйти из серии: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      setIsSeriesBusy(false);
    }
  };

  // #61: удалить только это занятие (scope single). Серия сохраняется.
  const handleDeleteThisOccurrence = async () => {
    if (!onDeleteEvent) return;
    setIsDeletingEvent(true);
    try {
      await onDeleteEvent(event.id, 'single');
      setIsDeleteConfirmOpen(false);
    } catch (error) {
      console.error('Failed to delete event', error);
      alert(`Не удалось удалить событие: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      setIsDeletingEvent(false);
    }
  };

  // Открыть модалку редактирования: префилл всеми полями события.
  const openEditTime = () => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const start = event.startDate;
    const end = event.endDate instanceof Date ? event.endDate : event.endAt ? new Date(event.endAt) : null;
    setEditTitle(event.title || '');
    setEditLocation(event.location || '');
    setEditLocationUrl(event.locationUrl || '');
    setEditLocationAddress('');
    setEditCost(event.cost !== undefined && event.cost !== null ? String(event.cost) : '');
    setEditDescription(event.description || '');
    setEditDate(`${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`);
    setEditStartTime(`${pad(start.getHours())}:${pad(start.getMinutes())}`);
    // Конца нет — по умолчанию +2 часа от старта (как в backend default).
    const endRef = end ?? new Date(start.getTime() + 2 * 60 * 60 * 1000);
    setEditEndTime(`${pad(endRef.getHours())}:${pad(endRef.getMinutes())}`);
    setIsEditTimeOpen(true);
  };

  const handleSaveTime = async () => {
    if (!editTitle.trim()) {
      alert('Введите название события');
      return;
    }
    if (!editDate || !editStartTime || !editEndTime) {
      alert('Заполните дату, время начала и окончания');
      return;
    }
    const start = new Date(`${editDate}T${editStartTime}`);
    const end = new Date(`${editDate}T${editEndTime}`);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      alert('Некорректные дата или время');
      return;
    }
    if (end.getTime() <= start.getTime()) {
      alert('Окончание должно быть позже начала');
      return;
    }
    const costRaw = editCost.trim();
    const costValue = costRaw ? Number(costRaw) : undefined;
    if (costRaw && (Number.isNaN(costValue) || (costValue as number) < 0)) {
      alert('Некорректная стоимость');
      return;
    }
    setIsSavingTime(true);
    try {
      if (onEditEvent) {
        await onEditEvent(event.id, {
          title: editTitle.trim(),
          location: editLocation.trim() || undefined,
          locationUrl: editLocationUrl.trim() || undefined,
          locationAddress: editLocationAddress.trim() || undefined,
          startISO: start.toISOString(),
          endISO: end.toISOString(),
          cost: costValue,
          description: editDescription.trim() || undefined,
        });
      } else if (onEditTime) {
        await onEditTime(event.id, start.toISOString(), end.toISOString());
      }
      setIsEditTimeOpen(false);
    } catch (error) {
      console.error('Failed to update event', error);
      alert(`Не удалось сохранить событие: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      setIsSavingTime(false);
    }
  };

  // #62: открыть отметку явки. Стартуем от уже сохранённой явки, а где её нет —
  // от намерения (CONFIRMED → «был» по умолчанию, остальные → «не был»).
  const handleOpenAttendance = async () => {
    setIsAttendanceOpen(true);
    setIsAttendanceLoading(true);
    try {
      const response = await api.getAttendance(event.id);
      const saved = new Map(response.attendance.map((row) => [row.userId, row.present]));
      const draft: Record<string, boolean> = {};
      for (const attendee of attendees) {
        draft[attendee.userId] = saved.has(attendee.userId)
          ? Boolean(saved.get(attendee.userId))
          : attendee.rsvpStatus === 'CONFIRMED';
      }
      setAttendanceDraft(draft);
    } catch (error) {
      console.error('Failed to load attendance', error);
      const draft: Record<string, boolean> = {};
      for (const attendee of attendees) {
        draft[attendee.userId] = attendee.rsvpStatus === 'CONFIRMED';
      }
      setAttendanceDraft(draft);
    } finally {
      setIsAttendanceLoading(false);
    }
  };

  const toggleAttendancePresent = (userId: string) => {
    setAttendanceDraft((prev) => ({ ...prev, [userId]: !prev[userId] }));
  };

  const handleSaveAttendance = async () => {
    const entries = attendees.map((attendee) => ({
      userId: attendee.userId,
      present: Boolean(attendanceDraft[attendee.userId]),
    }));
    if (entries.length === 0) return;
    setIsSavingAttendance(true);
    try {
      await api.markAttendance(event.id, entries);
      setIsAttendanceOpen(false);
    } catch (error) {
      console.error('Failed to save attendance', error);
      alert(`Не удалось сохранить явку: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      setIsSavingAttendance(false);
    }
  };

  const handleSendReminder = async () => {
    if (isGameReminderTemplate && !reminderGameId) {
      alert('Для игрового напоминания выберите игру из расписания.');
      return;
    }
    setIsRemindingUnanswered(true);
    try {
      await onSendEventReminder({
        eventId: event.id,
        audience: reminderAudience,
        template: reminderTemplate,
        gameId: isGameReminderTemplate ? reminderGameId : undefined,
      });
    } finally {
      setIsRemindingUnanswered(false);
    }
  };

  const handleRemindSilent = async () => {
    setIsRemindingUnanswered(true);
    try {
      await onSendEventReminder({ eventId: event.id, audience: 'UNANSWERED', template: 'EVENT_REMINDER' });
    } finally {
      setIsRemindingUnanswered(false);
    }
  };

  const handleAddGameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newGameTime && newGameOpponent) {
      onAddGame(event.id, {
        time: newGameTime,
        opponent: newGameOpponent.trim(),
        pitZone: newGamePitZone,
        gamePair: newGamePair,
      });
      setNewGameTime('');
      setNewGameOpponent('');
      setNewGamePitZone('NEAR');
      setNewGamePair('FIRST');
      setIsAddingGame(false);
    }
  };

  const normalizeTimeForInput = (time: string) => {
    const match = String(time).match(/^(\d{1,2}):(\d{2})/);
    if (!match) return '';
    return `${match[1].padStart(2, '0')}:${match[2]}`;
  };

  const openGameCard = (game: Game) => {
    setEditingGame(game);
    setEditGameTime(normalizeTimeForInput(game.time));
    setEditGameOpponent(game.opponent);
    setEditGameScore(game.score || '');
    setEditGamePitZone(game.pitZone || 'NEAR');
    setEditGamePair(game.gamePair || 'FIRST');
  };

  const handleUpdateGameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingGame || !editGameTime || !editGameOpponent) return;
    try {
      setIsSavingGame(true);
      await onUpdateGame(event.id, editingGame.id, {
        time: editGameTime,
        opponent: editGameOpponent.trim(),
        score: editGameScore.trim() || undefined,
        pitZone: editGamePitZone,
        gamePair: editGamePair,
      });
      setEditingGame(null);
    } finally {
      setIsSavingGame(false);
    }
  };

  // Хронологический порядок: time_label — свободный текст («8:00», «12:00»),
  // localeCompare сортировал лексикографически и «8:00» уходил в конец после «16:00».
  const timeToMinutes = (time: string) => {
    const m = String(time).match(/^(\d{1,2}):(\d{2})/);
    if (!m) return Number.MAX_SAFE_INTEGER;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  };
  const sortedSchedule = [...(event.schedule || [])].sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
  const financeViewModel = financeDetail
    ? buildEventFinanceViewModel({
        currentUserRole,
        detail: financeDetail,
      })
    : null;
  const eventExpensesViewModel = financeDetail
    ? buildEventExpensesViewModel({
        currentUserRole,
        detail: financeDetail,
      })
    : null;
  const collectionParticipants =
    financeDetail?.participants
      .filter((item) => Number(item.amountDue || 0) > 0)
      .map((item) => ({
        id: item.userId,
        name: item.name,
        nickname: item.nickname,
        avatar: item.avatar || undefined,
        role: item.role === 'TRAINER' ? Role.TRAINER : item.role === 'CAPTAIN' ? Role.CAPTAIN : Role.PLAYER,
        status:
          item.memberStatus === 'INJURED'
            ? PlayerStatus.INJURED
            : item.memberStatus === 'RESERVE'
              ? PlayerStatus.RESERVE
              : item.memberStatus === 'VACATION'
                ? PlayerStatus.VACATION
                : PlayerStatus.ACTIVE,
        balance: -Number(item.amountOutstanding || 0),
      })) || [];
  const hasExistingCharges = !!financeDetail?.participants.some((item) => item.amountDue > 0);
  const undistributedChargeAmount = Number(financeDetail?.collection?.undistributedTotal || 0);
  const chargeModalState = buildEventChargeModalState({
    participants: (financeDetail?.participants || []).map((item) => ({
      userId: item.userId,
      role: item.role || 'PLAYER',
      rsvpStatus: item.rsvpStatus || 'UNANSWERED',
      amountDue: Number(item.amountDue || 0),
    })),
    audience: chargeAudience,
    amountMode: chargeAmountMode,
    undistributedAmount: undistributedChargeAmount,
    fixedAmount: chargeAmount,
  });
  const suggestedChargeAmount = financeDetail?.participants.find((item) => Number(item.amountDue || 0) > 0)?.amountDue;

  useEffect(() => {
    if (!isChargeModalOpen) return;
    if (undistributedChargeAmount > 0) {
      setChargeAmountMode('UNDISTRIBUTED_SPLIT');
      setChargeAmount('');
      return;
    }
    if (hasExistingCharges) {
      setChargeAmountMode('FIXED_PER_PERSON');
      if (suggestedChargeAmount !== undefined) {
        setChargeAmount(String(suggestedChargeAmount));
      }
      return;
    }
    setChargeAmountMode('UNDISTRIBUTED_SPLIT');
    setChargeAmount('');
  }, [hasExistingCharges, isChargeModalOpen, suggestedChargeAmount, undistributedChargeAmount]);

  const chargePreview = chargeModalState.preview;

  const reloadEventFinance = async () => {
    if (!canReadEventFinance) return;
    setIsFinanceLoading(true);
    try {
      const response = await api.getFinanceEventDetail(event.id);
      setFinanceDetail(response);
    } finally {
      setIsFinanceLoading(false);
    }
  };

  const handleSubmitEventExpense = async (payload: Omit<Transaction, 'id' | 'date'>) => {
    if (editingExpense?.id) {
      await api.updateTransaction({
        transactionId: editingExpense.id,
        title: payload.title,
        amount: payload.amount,
        eventId: payload.eventId ?? null,
      });
    } else {
      await api.addTransaction({
        id: `event-tx-${Date.now()}`,
        teamId: event.teamId,
        date: new Date(),
        ...payload,
        eventId: event.id,
      });
    }
    await reloadEventFinance();
  };

  const handleGenerateCharges = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chargeModalState.canSubmit) {
      alert(chargeModalState.blockingReason || 'Нет подходящих участников для начисления.');
      return;
    }
    setIsSubmittingCharges(true);
    try {
      await api.generateEventCharges({
        eventId: event.id,
        mode: chargeAudience,
        amountType: chargeAmountMode,
        totalAmount: undefined,
        fixedAmount: chargeAmountMode === 'FIXED_PER_PERSON' ? Number(chargeAmount) : undefined,
        overwriteExisting: false,
      });
      setIsChargeModalOpen(false);
      setChargeAmount('');
      await reloadEventFinance();
    } catch (error) {
      console.error('Failed to generate event charges', error);
      alert(`Не удалось начислить участникам: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      setIsSubmittingCharges(false);
    }
  };

  const handleRemindEventDebtors = async () => {
    if (!financeDetail) return;
    const debtorIds = financeDetail.participants
      .filter((item) => item.amountOutstanding > 0)
      .map((item) => item.userId);
    if (debtorIds.length === 0) {
      alert('По событию нет должников.');
      return;
    }
    setIsRemindingDebtors(true);
    try {
      await api.remindEventDebtors({ eventId: event.id, userIds: debtorIds });
    } catch (error) {
      console.error('Failed to remind event debtors', error);
      alert(`Не удалось напомнить должникам: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      setIsRemindingDebtors(false);
    }
  };

  const openTransferModal = (userId?: string) => {
    setTransferDefaultUserId(userId);
    setIsTransferModalOpen(true);
  };

  const openCreateExpenseModal = () => {
    setEditingExpense(null);
    setIsExpensesSheetOpen(false);
    setIsExpenseModalOpen(true);
  };

  const openEditExpenseModal = (transactionId: string) => {
    const sourceExpense = financeDetail?.payments.find(
      (item) => item.transactionId === transactionId && item.type === TransactionType.EXPENSE
    );
    if (!sourceExpense) {
      alert('Не удалось найти расход для редактирования.');
      return;
    }
    setEditingExpense({
      id: sourceExpense.transactionId,
      title: sourceExpense.title,
      amount: sourceExpense.amount,
      eventId: event.id,
      type: TransactionType.EXPENSE,
      status: sourceExpense.status,
      date: new Date(sourceExpense.date),
    });
    setIsExpensesSheetOpen(false);
    setIsExpenseModalOpen(true);
  };

  const handleCloseExpenseModal = () => {
    setIsExpenseModalOpen(false);
    setEditingExpense(null);
    setIsExpensesSheetOpen(true);
  };

  const handleCreateEventTransferConfirmation = async (payload: {
    userId?: string;
    amount: number;
    screenshotDataUrl: string;
    note?: string;
    autoApprove?: boolean;
    preferredEventId?: string;
  }) => {
    const created = await api.createTransferConfirmation({
      teamId: event.teamId,
      userId: payload.userId,
      amount: payload.amount,
      screenshotDataUrl: payload.screenshotDataUrl,
      note: payload.note,
      submittedAt: new Date().toISOString(),
    });

    if (payload.autoApprove && created.confirmation?.id) {
      await api.reviewTransferConfirmation({
        confirmationId: created.confirmation.id,
        decision: 'APPROVE',
        preferredEventId: payload.preferredEventId,
      });
    }

    await reloadEventFinance();
  };

  useEffect(() => {
    if (!isGameReminderTemplate) return;
    if (sortedSchedule.length === 0) {
      setReminderGameId('');
      return;
    }
    if (!reminderGameId || !sortedSchedule.some((game) => game.id === reminderGameId)) {
      setReminderGameId(sortedSchedule[0].id);
    }
  }, [isGameReminderTemplate, sortedSchedule, reminderGameId]);

  const renderAttendeeList = (title: string, data: EventDetailAttendee[]) => {
    if (data.length === 0) return null;
    return (
      <div className="mb-3 last:mb-0">
        <div className="text-xs text-pb-subtext uppercase tracking-wider font-bold mb-2">{title}</div>
        <div className="max-h-52 overflow-y-auto space-y-2 pr-1">
          {data.map((attendee) => (
            <button
              key={attendee.userId}
              type="button"
              onClick={() =>
                onAttendeeClick(attendee.userId, {
                  name: attendee.name,
                  nickname: attendee.nickname,
                  avatar: attendee.avatar,
                  role: attendee.role,
                })
              }
              className="w-full bg-white/5 hover:bg-white/10 border border-white/5 hover:border-pb-primary/40 rounded-xl px-3 py-2 flex items-center gap-3 text-left transition-colors"
            >
              <img
                src={attendee.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(attendee.name)}&background=0F0F0F&color=fff`}
                alt={attendee.name}
                className="w-8 h-8 rounded-full object-cover"
              />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white truncate">{attendee.name}</div>
                <div className="text-xs text-pb-primary truncate">@{attendee.nickname}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-pb-background flex flex-col pb-safe animate-fade-in relative z-50">
      <div
        className="sticky top-0 z-10 flex items-center border-b border-white/5 bg-pb-background/80 px-4 pb-3 backdrop-blur-md"
        style={{ paddingTop: 'calc(var(--pb-safe-top) + 0.75rem)' }}
      >
        <button onClick={onBack} className="p-2 -ml-2 text-white hover:bg-white/10 rounded-full">
          <ChevronLeft size={24} />
        </button>
        <span className="ml-2 font-bold text-lg text-white">Событие</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="h-32 relative overflow-hidden flex items-end p-6" style={{ backgroundColor: `${color}20` }}>
          <div className="absolute top-0 left-0 w-full h-1" style={{ backgroundColor: color }}></div>
          <Icon size={120} className="absolute -right-6 -top-6 opacity-10" color={color} />

          <div className="flex items-center gap-2">
            <span
              className="inline-block px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-wider bg-black/40 backdrop-blur-md text-white border border-white/10 shadow-lg"
              style={{ borderColor: `${color}50`, color: color }}
            >
              {EVENT_LABELS[event.type]}
            </span>
            {event.seriesId && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wider bg-black/40 backdrop-blur-md text-pb-primary border border-pb-primary/40 shadow-lg">
                <Repeat size={12} />
                Серия
              </span>
            )}
          </div>
        </div>

        <div className="px-6 py-6 pb-8 space-y-6">
          <div>
            <h1 className="text-2xl font-black text-white leading-tight mb-2">{event.title}</h1>
            <div className="flex items-center text-pb-subtext">
              <Clock size={16} className="mr-2 text-pb-primary" />
              <span className="text-lg">
                {format(event.startDate, 'd MMMM yyyy, HH:mm', { locale: ru })}
                {(() => {
                  const end = event.endDate instanceof Date ? event.endDate : event.endAt ? new Date(event.endAt) : null;
                  if (!end || isNaN(end.getTime())) return null;
                  const sameDay =
                    end.getFullYear() === event.startDate.getFullYear() &&
                    end.getMonth() === event.startDate.getMonth() &&
                    end.getDate() === event.startDate.getDate();
                  return ` – ${format(end, sameDay ? 'HH:mm' : 'd MMM, HH:mm', { locale: ru })}`;
                })()}
              </span>
              {canEditEvent && (
                <button
                  onClick={openEditTime}
                  className="ml-2 p-1.5 -my-1 rounded-lg text-pb-subtext hover:text-pb-primary hover:bg-white/5 transition-colors"
                  aria-label="Изменить событие"
                >
                  <Pencil size={16} />
                </button>
              )}
            </div>
            {event.teamTimezone && (
              <div className="mt-2 inline-flex items-center rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-pb-subtext">
                TZ команды: {event.teamTimezone}
              </div>
            )}
          </div>

          {/* RSVP-решение — главное на экране, поэтому сверху и компактно (#UI-иерархия). */}
          <div className="rounded-2xl border border-white/5 bg-pb-surface p-3">
            <div className="mb-2 text-xs font-bold uppercase tracking-widest text-pb-subtext">
              {isSeriesOccurrence ? 'Только это занятие' : 'Ваше решение'}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handleStatusChange(RSVPStatus.CONFIRMED)}
                className={`flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl text-sm font-bold transition-all ${
                  event.rsvpStatus === RSVPStatus.CONFIRMED
                    ? 'bg-pb-primary text-pb-background shadow-[0_0_15px_rgba(0,230,118,0.4)]'
                    : 'bg-white/5 text-gray-400 hover:bg-white/10'
                }`}
              >
                <Check size={16} />
                <span>Иду</span>
              </button>

              <button
                onClick={() => handleStatusChange(RSVPStatus.DECLINED)}
                className={`flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl text-sm font-bold transition-all ${
                  event.rsvpStatus === RSVPStatus.DECLINED
                    ? 'bg-pb-danger text-white shadow-[0_0_15px_rgba(255,23,68,0.4)]'
                    : 'bg-white/5 text-gray-400 hover:bg-white/10'
                }`}
              >
                <X size={16} />
                <span>{isSeriesOccurrence ? 'Не приду' : 'Не иду'}</span>
              </button>

              <button
                onClick={() => handleStatusChange(RSVPStatus.PENDING)}
                className={`flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl text-sm font-bold transition-all ${
                  event.rsvpStatus === RSVPStatus.PENDING
                    ? 'bg-pb-warning text-white shadow-[0_0_15px_rgba(255,109,0,0.4)]'
                    : 'bg-white/5 text-gray-400 hover:bg-white/10'
                }`}
              >
                <HelpCircle size={16} />
                <span>Думаю</span>
              </button>
            </div>
            {isSeriesOccurrence && seriesContext?.committed && (
              <div className="mt-2 text-center text-[11px] text-pb-subtext">
                Это меняет только сегодняшнее занятие. На серию вы по-прежнему записаны.
              </div>
            )}
          </div>

          {event.seriesId && seriesContext && (
            <div className="rounded-2xl border border-pb-primary/30 bg-pb-primary/5 p-4">
              {seriesContext.committed ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-white font-bold">
                      <Repeat size={16} className="text-pb-primary shrink-0" />
                      Вы ходите на серию
                    </div>
                    <div className="mt-1 text-xs text-pb-subtext">
                      По умолчанию вы идёте на каждое занятие. На любом из них можно отметить «сегодня не приду».
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleLeaveSeries}
                    disabled={isSeriesBusy}
                    className="shrink-0 text-xs font-semibold text-pb-subtext border border-white/10 rounded-lg px-3 py-2 hover:text-white hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSeriesBusy ? 'Сохраняем…' : 'Выйти'}
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-white font-bold">
                      <Repeat size={16} className="text-pb-primary shrink-0" />
                      Это серия занятий
                    </div>
                    <div className="mt-1 text-xs text-pb-subtext">
                      {seriesContext.upcomingCount > 0
                        ? `Впереди ещё ${seriesContext.upcomingCount} ${pluralizeOccurrence(seriesContext.upcomingCount)}. Запишитесь сразу на все.`
                        : 'Запишитесь сразу на все занятия серии.'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleCommitSeries}
                    disabled={isSeriesBusy}
                    className="shrink-0 text-xs font-bold text-pb-background bg-pb-primary rounded-lg px-3 py-2 hover:bg-opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSeriesBusy ? 'Записываем…' : 'Иду на все'}
                  </button>
                </div>
              )}
            </div>
          )}

          {event.description && (
            <div className="bg-pb-surface rounded-2xl p-4 border border-white/5">
              <p className="text-gray-300 leading-relaxed text-sm whitespace-pre-wrap">{event.description}</p>
            </div>
          )}

          {hasGameSchedule && (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <div className="flex items-center text-white font-bold uppercase text-sm tracking-wider">
                  <Swords size={16} className="mr-2 text-pb-primary" /> Расписание игр
                </div>
                <div className="flex items-center gap-2">
                  {canSeeEventTable && (
                    <button
                      onClick={() => setIsTableOpen(true)}
                      className="text-xs bg-white/10 hover:bg-white/20 text-pb-primary px-3 py-1.5 rounded-lg transition-colors flex items-center"
                    >
                      <ClipboardList size={12} className="mr-1" /> Разбор
                    </button>
                  )}
                  {isAdminOrCaptain && (
                    <button
                      onClick={() => setIsAddingGame(true)}
                      className="text-xs bg-white/10 hover:bg-white/20 text-pb-primary px-3 py-1.5 rounded-lg transition-colors flex items-center"
                    >
                      <Plus size={12} className="mr-1" /> Добавить
                    </button>
                  )}
                </div>
              </div>

              <div className="bg-pb-surface rounded-2xl p-4 border border-white/5 relative overflow-hidden">
                <div className="absolute top-4 bottom-4 left-[5.5rem] w-px bg-white/10"></div>

                <div className="space-y-6 relative">
                  {sortedSchedule.length === 0 && (
                    <div className="text-center py-4 text-pb-subtext text-sm italic">Расписание пока не добавлено</div>
                  )}

                  {sortedSchedule.map((game) => (
                    <div key={game.id} className="w-full flex items-start relative z-0 group">
                      <div className="w-16 font-mono font-bold text-pb-primary text-lg text-right pr-4 shrink-0 pt-2">
                        {normalizeTimeForInput(game.time) || game.time}
                      </div>

                      <div className="w-2.5 h-2.5 rounded-full bg-pb-background border-2 border-pb-primary shrink-0 mr-4 z-10 mt-4 shadow-[0_0_10px_rgba(0,230,118,0.5)]"></div>

                      {/* Строка читается как на regevent.ru, откуда капитан переносит
                          результаты: «наша команда [очки][очки] соперник». Имена берут
                          всю ширину карточки и переносятся по словам — раньше пит-зона
                          стояла рядом как shrink-0 и съедала соперника до «Ш…»
                          (Василий, 2026-07-31). Пара и пит-зона — метаданными ниже. */}
                      <div className="flex-1 min-w-0 bg-white/5 p-3 rounded-xl border border-white/5 group-hover:border-pb-primary/40 transition-colors">
                        <button type="button" onClick={() => openGameCard(game)} className="w-full text-left">
                          <GameScoreLine teamName={teamName} opponent={game.opponent} score={game.score} />
                        </button>

                        <div className="mt-2 flex items-center justify-between gap-2">
                          <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-pb-subtext">
                            <span>{game.gamePair ? GAME_PAIR_LABELS[game.gamePair] : 'Пара не указана'}</span>
                            {game.pitZone && (
                              <span title={PIT_ZONE_LABELS[game.pitZone]}>
                                · {PIT_ZONE_BADGE[game.pitZone]} пит-зона
                              </span>
                            )}
                          </div>

                          {/* Один вход на гейм — список его пойнтов. Рефлексия и разбор
                              капитана живут внутри, за конкретным пойнтом. Иконка без
                              подписи не читалась — поэтому кнопка с текстом. */}
                          <button
                            type="button"
                            onClick={() => setPointsGame(game)}
                            className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[11px] font-semibold text-pb-subtext hover:text-pb-primary hover:border-pb-primary/40 transition-colors"
                          >
                            <Swords size={12} /> Пойнты
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-pb-surface rounded-2xl p-4 border border-white/5">
              <div className="flex items-center text-pb-subtext mb-1">
                <MapPin size={14} className="mr-1.5" /> Место
              </div>
              {event.location && event.locationUrl ? (
                <a
                  href={event.locationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-pb-primary hover:underline break-words"
                >
                  {event.location}
                </a>
              ) : (
                <div className="font-semibold text-white">{event.location || 'Не указано'}</div>
              )}
            </div>

            <div className="bg-pb-surface rounded-2xl p-4 border border-white/5">
              <div className="flex items-center text-pb-subtext mb-1">
                <Users size={14} className="mr-1.5" /> Участники
              </div>
              <div className="font-semibold text-white">{attendeesCount}</div>
              <div className="mt-1 text-[11px] text-pb-subtext">Подтвержденные игроки и штаб</div>
            </div>
          </div>

          <div className="bg-pb-surface rounded-2xl p-4 border border-white/5">
            <div className="mb-4 space-y-3">
              <div className="flex justify-between items-center gap-3">
                <div className="flex items-center text-white font-bold min-w-0">
                  <Users size={18} className="mr-2 text-pb-primary" />
                  Участники ({attendeesCount})
                </div>
                {event.maxAttendees && <span className="text-xs text-pb-subtext shrink-0">из {event.maxAttendees}</span>}
              </div>
              {canSendEventReminder && (
                <div className="bg-black/20 border border-white/10 rounded-xl p-3 space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <select
                      value={reminderAudience}
                      onChange={(e) => setReminderAudience(e.target.value as typeof reminderAudience)}
                      className="w-full bg-black/30 border border-white/10 rounded-lg px-2.5 py-2 text-xs text-white focus:border-pb-primary focus:outline-none"
                    >
                      <option value="ALL">Напомнить всем</option>
                      <option value="RESPONDED">Напомнить ответившим</option>
                      <option value="UNANSWERED">Напомнить неответившим</option>
                      <option value="CONFIRMED">Только подтвердившим</option>
                      <option value="PENDING">Только думающим</option>
                      <option value="DECLINED">Только отказавшимся</option>
                    </select>
                    <select
                      value={reminderTemplate}
                      onChange={(e) =>
                        setReminderTemplate(
                          e.target.value as 'EVENT_REMINDER' | 'WARMUP_REMINDER' | 'ROLE_REMINDER' | 'GAME_GATHERING' | 'GAME_WARMUP'
                        )
                      }
                      className="w-full bg-black/30 border border-white/10 rounded-lg px-2.5 py-2 text-xs text-white focus:border-pb-primary focus:outline-none"
                    >
                      <option value="EVENT_REMINDER">Обычное напоминание</option>
                      <option value="WARMUP_REMINDER">Разминка по событию</option>
                      <option value="ROLE_REMINDER">Роли и задачи</option>
                      <option value="GAME_GATHERING">Сбор перед игрой</option>
                      <option value="GAME_WARMUP">Начало разминки (игра)</option>
                    </select>
                  </div>
                  {isGameReminderTemplate && (
                    <select
                      value={reminderGameId}
                      onChange={(e) => setReminderGameId(e.target.value)}
                      disabled={sortedSchedule.length === 0}
                      className="w-full bg-black/30 border border-white/10 rounded-lg px-2.5 py-2 text-xs text-white focus:border-pb-primary focus:outline-none disabled:opacity-60"
                    >
                      {sortedSchedule.length === 0 && <option value="">Нет игр в расписании</option>}
                      {sortedSchedule.map((game) => (
                        <option key={game.id} value={game.id}>
                          {`${game.time} • ${game.opponent} • ${game.pitZone ? `${PIT_ZONE_BADGE[game.pitZone]} пит` : 'пит ?'} • ${game.gamePair ? GAME_PAIR_LABELS[game.gamePair] : 'пара ?'}`}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    onClick={handleSendReminder}
                    disabled={isRemindingUnanswered || (isGameReminderTemplate && sortedSchedule.length === 0)}
                    className="w-full text-[12px] font-semibold text-pb-primary border border-pb-primary/30 rounded-lg px-2.5 py-2 hover:bg-pb-primary/10 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isRemindingUnanswered ? 'Отправляем...' : 'Отправить напоминание'}
                  </button>
                </div>
              )}
            </div>

            {!isAttendeesLoading && (
              <AttendanceMap
                attendees={attendees}
                onRemindSilent={canSendEventReminder ? handleRemindSilent : undefined}
                remindingSilent={isRemindingUnanswered}
              />
            )}

            {/* #62: фактическая явка (был/не был) — второй слой, факт vs намерение. */}
            {!isAttendeesLoading && canManageAttendance && hasEventStarted && attendees.length > 0 && (
              <div className="mb-4 rounded-2xl border border-white/10 bg-black/20 p-3">
                {!isAttendanceOpen ? (
                  <button
                    type="button"
                    onClick={handleOpenAttendance}
                    className="w-full flex items-center justify-between gap-3 text-left"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-white">Отметить явку</div>
                      <div className="text-[11px] text-pb-subtext mt-0.5">Кто реально был на занятии — факт, не планы.</div>
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-pb-primary border border-pb-primary/30 rounded-lg px-3 py-1.5">
                      Открыть
                    </span>
                  </button>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-bold text-white">Кто был на занятии</div>
                      <button
                        type="button"
                        onClick={() => setIsAttendanceOpen(false)}
                        className="text-[11px] text-pb-subtext hover:text-white"
                      >
                        Свернуть
                      </button>
                    </div>

                    {isAttendanceLoading ? (
                      <div className="text-sm text-pb-subtext py-2">Загрузка явки…</div>
                    ) : (
                      <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1">
                        {attendees.map((attendee) => {
                          const present = Boolean(attendanceDraft[attendee.userId]);
                          return (
                            <div
                              key={attendee.userId}
                              className="flex items-center gap-2 rounded-xl bg-white/5 border border-white/5 px-2.5 py-2"
                            >
                              <img
                                src={attendee.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(attendee.name)}&background=0F0F0F&color=fff`}
                                alt={attendee.name}
                                className="w-7 h-7 rounded-full object-cover shrink-0"
                              />
                              <span className="text-sm text-white truncate flex-1 min-w-0">{attendee.name}</span>
                              <div className="shrink-0 flex gap-1">
                                <button
                                  type="button"
                                  onClick={() => !present && toggleAttendancePresent(attendee.userId)}
                                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                                    present
                                      ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40'
                                      : 'bg-white/5 text-pb-subtext border border-white/10 hover:text-white'
                                  }`}
                                >
                                  Был
                                </button>
                                <button
                                  type="button"
                                  onClick={() => present && toggleAttendancePresent(attendee.userId)}
                                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                                    !present
                                      ? 'bg-rose-500/20 text-rose-200 border border-rose-500/40'
                                      : 'bg-white/5 text-pb-subtext border border-white/10 hover:text-white'
                                  }`}
                                >
                                  Не был
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {!isAttendanceLoading && (
                      <button
                        type="button"
                        onClick={handleSaveAttendance}
                        disabled={isSavingAttendance}
                        className="w-full py-2.5 rounded-xl bg-pb-primary text-pb-background font-bold hover:bg-opacity-90 transition-colors disabled:opacity-60"
                      >
                        {isSavingAttendance ? 'Сохраняем…' : 'Сохранить явку'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {isAttendeesLoading && (
              <div className="text-sm text-pb-subtext py-2">Загрузка списка участников...</div>
            )}

            {!isAttendeesLoading && confirmedAttendees.length === 0 && (
              <div className="text-sm text-pb-subtext py-2">Подтвержденных участников пока нет</div>
            )}

            {!isAttendeesLoading && confirmedAttendees.length > 0 && (
              <div className="mt-1 border-t border-white/5 pt-3">
                {renderAttendeeList('Тренерский штаб', trainerAttendees)}
                {renderAttendeeList('Игроки', playerAttendees)}
              </div>
            )}
          </div>

          {/* Сбор по событию — финансы вторичны, поэтому ниже явки (#UI-иерархия). */}
          {canReadEventFinance && (
            <div className="bg-pb-surface rounded-2xl p-4 border border-white/5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-white font-bold uppercase text-sm tracking-wider">Сбор по событию</div>
                  <div className="mt-1 text-xs text-pb-subtext">Итог по расходам, собранным деньгам и текущему сбору.</div>
                </div>
                <div className="rounded-full bg-white/5 px-3 py-1 text-[11px] font-bold text-pb-subtext">
                  {financeViewModel?.collectionStatusLabel || 'Сбор не создан'}
                </div>
              </div>

              {isFinanceLoading && <div className="text-sm text-pb-subtext">Загрузка финансов события...</div>}

              {!isFinanceLoading && financeViewModel && financeDetail && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    {financeViewModel.summaryCards.map((card) => (
                      <div key={card.label} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                        <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-pb-subtext">{card.label}</div>
                        <div className="mt-2 text-lg font-black text-white">{card.value}</div>
                      </div>
                    ))}
                  </div>

                  {financeViewModel.canManage && (
                    <div className="grid grid-cols-1 gap-2">
                      <button
                        type="button"
                        onClick={() => setIsExpensesSheetOpen(true)}
                        className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm font-bold text-white"
                      >
                        Добавить расход
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {canDeleteEvent && (
            <button
              type="button"
              onClick={() => setIsDeleteConfirmOpen(true)}
              className="w-full flex items-center justify-center gap-2 rounded-2xl border border-pb-danger/30 bg-pb-danger/5 px-4 py-3 text-sm font-semibold text-pb-danger hover:bg-pb-danger/10 transition-colors"
            >
              <Trash2 size={16} />
              {isSeriesOccurrence ? 'Удалить это занятие' : 'Удалить событие'}
            </button>
          )}
        </div>
      </div>

      {eventExpensesViewModel ? (
        <EventExpensesSheet
          isOpen={isExpensesSheetOpen}
          title={`Расходы · ${event.title}`}
          subtitle={format(event.startDate, 'd MMMM, HH:mm', { locale: ru })}
          statusLabel={eventExpensesViewModel.collectionStatusLabel}
          totalSpentLabel={eventExpensesViewModel.totalSpentLabel}
          expenseCountLabel={eventExpensesViewModel.expenseCountLabel}
          deltaHint={eventExpensesViewModel.deltaHint}
          expenses={eventExpensesViewModel.expenses}
          canManage={eventExpensesViewModel.canManage}
          canOpenCollection={eventExpensesViewModel.canOpenCollection}
          collectionActionLabel={eventExpensesViewModel.collectionActionLabel}
          onClose={() => setIsExpensesSheetOpen(false)}
          onAddExpense={openCreateExpenseModal}
          onOpenCollection={() => {
            setIsExpensesSheetOpen(false);
            setIsCollectionSheetOpen(true);
          }}
          onEditExpense={openEditExpenseModal}
        />
      ) : null}

      <FinanceTransactionModal
        isOpen={isExpenseModalOpen}
        type={TransactionType.EXPENSE}
        members={[]}
        eventOptions={[
          {
            eventId: event.id,
            title: event.title,
            startDate: event.startAt,
          },
        ]}
        initialEventId={event.id}
        initialTransaction={editingExpense ?? undefined}
        lockEventId
        onClose={handleCloseExpenseModal}
        onSubmit={handleSubmitEventExpense}
      />

      {financeViewModel && financeDetail ? (
        <EventCollectionSheet
          isOpen={isCollectionSheetOpen}
          title={event.title}
          subtitle={`${format(event.startDate, 'd MMMM, HH:mm', { locale: ru })} · ${financeDetail.participants.filter((item) => item.amountDue > 0).length} в сборе`}
          statusLabel={financeViewModel.collectionStatusLabel}
          summaryCards={financeViewModel.collectionCards}
          participants={financeDetail.participants}
          expenses={financeViewModel.expenses}
          recentOperations={financeViewModel.recentOperations}
          canManage={financeViewModel.canManage}
          onClose={() => setIsCollectionSheetOpen(false)}
          onSettleTransfer={(userId) => openTransferModal(userId)}
          onAddExpense={() => {
            setIsCollectionSheetOpen(false);
            setIsExpensesSheetOpen(true);
          }}
          onChargeParticipants={() => setIsChargeModalOpen(true)}
          chargeActionLabel={undistributedChargeAmount > 0 || !hasExistingCharges ? 'Распределить' : 'Доначислить'}
          onRemindDebtors={() => void handleRemindEventDebtors()}
          isRemindingDebtors={isRemindingDebtors}
        />
      ) : null}

      <TransferConfirmationModal
        isOpen={isTransferModalOpen}
        mode="CAPTAIN_SETTLE"
        members={collectionParticipants}
        defaultUserId={transferDefaultUserId}
        preferredEventId={event.id}
        loadMemberFinance={(userId) => api.getFinanceMember(event.teamId, userId)}
        onClose={() => setIsTransferModalOpen(false)}
        onSubmit={async (payload) => {
          try {
            await handleCreateEventTransferConfirmation(payload);
            setIsTransferModalOpen(false);
          } catch (error) {
            console.error('Failed to settle transfer from event collection', error);
            alert(`Не удалось зачесть перевод: ${error instanceof Error ? error.message : 'unknown error'}`);
          }
        }}
      />

      {isChargeModalOpen && (
        <div className="fixed inset-0 z-[111] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setIsChargeModalOpen(false)}></div>
          <div className="relative w-full max-w-sm bg-pb-surface rounded-2xl border border-white/10 shadow-2xl p-6 animate-fade-in">
            <h3 className="text-lg font-bold text-white mb-1">
              {chargeAmountMode === 'UNDISTRIBUTED_SPLIT' ? 'Распределить расходы' : 'Доначислить участникам'}
            </h3>
            <p className="text-xs text-pb-subtext mb-4">
              {chargeAmountMode === 'UNDISTRIBUTED_SPLIT'
                ? 'Система возьмет нераспределенный остаток из расходов события и разнесет его по выбранным участникам.'
                : 'Добавляем фиксированную сумму новым участникам, не переписывая уже идущий сбор.'}
            </p>

            <form onSubmit={handleGenerateCharges} className="space-y-4">
              <div>
                <label className="text-pb-subtext text-xs uppercase font-bold mb-1 block">Кого включить в сбор</label>
                <select
                  value={chargeAudience}
                  onChange={(e) => setChargeAudience(e.target.value as 'CONFIRMED_ONLY' | 'CONFIRMED_AND_PENDING')}
                  className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-pb-primary focus:outline-none"
                >
                  <option value="CONFIRMED_ONLY">Только подтвердившие участие</option>
                  <option value="CONFIRMED_AND_PENDING">Подтвердившие и думающие</option>
                </select>
              </div>

              <div>
                <label className="text-pb-subtext text-xs uppercase font-bold mb-1 block">Как начислить</label>
                <select
                  value={chargeAmountMode}
                  onChange={(e) => setChargeAmountMode(e.target.value as 'UNDISTRIBUTED_SPLIT' | 'FIXED_PER_PERSON')}
                  className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-pb-primary focus:outline-none"
                >
                  <option value="UNDISTRIBUTED_SPLIT" disabled={undistributedChargeAmount <= 0}>
                    {undistributedChargeAmount > 0 ? 'Распределить нераскиданное' : 'Нераспределенных расходов нет'}
                  </option>
                  <option value="FIXED_PER_PERSON">Фиксированная сумма на игрока</option>
                </select>
              </div>

              {hasExistingCharges && chargeAmountMode === 'FIXED_PER_PERSON' && (
                <div className="rounded-xl border border-pb-warning/30 bg-pb-warning/10 px-3 py-3 text-xs text-pb-subtext">
                  Сбор уже идет. Чтобы не сломать текущие начисления, новым участникам можно добавить только фиксированную сумму.
                  {suggestedChargeAmount !== undefined ? ` Сейчас у существующих начислений ориентир ${suggestedChargeAmount.toLocaleString('ru-RU')} ₽.` : ''}
                </div>
              )}

              {chargeAmountMode === 'FIXED_PER_PERSON' ? (
                <div>
                  <label className="text-pb-subtext text-xs uppercase font-bold mb-1 block">Сумма на игрока</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={chargeAmount}
                    onChange={(e) => setChargeAmount(e.target.value)}
                    className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-pb-primary focus:outline-none"
                  />
                </div>
              ) : (
                <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3">
                  <div className="text-pb-subtext text-xs uppercase font-bold mb-1">Нераспределенный остаток</div>
                  <div className="text-base font-black text-white">{undistributedChargeAmount.toLocaleString('ru-RU')} ₽</div>
                </div>
              )}

              <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-pb-subtext">{chargePreview}</div>
              {chargeModalState.blockingReason ? (
                <div className="rounded-xl border border-pb-warning/30 bg-pb-warning/10 px-3 py-3 text-xs text-pb-subtext">
                  {chargeModalState.blockingReason}
                </div>
              ) : null}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsChargeModalOpen(false)}
                  className="flex-1 py-3 rounded-xl bg-white/5 text-pb-subtext hover:text-white transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingCharges || !chargeModalState.canSubmit}
                  className="flex-1 py-3 rounded-xl bg-pb-primary text-pb-background font-bold hover:bg-opacity-90 transition-colors disabled:opacity-60"
                >
                  {isSubmittingCharges ? 'Сохраняем...' : chargeAmountMode === 'UNDISTRIBUTED_SPLIT' ? 'Распределить' : 'Доначислить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isDeleteConfirmOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setIsDeleteConfirmOpen(false)}></div>
          <div className="relative w-full max-w-sm bg-pb-surface rounded-2xl border border-white/10 shadow-2xl p-6 animate-fade-in">
            <h3 className="text-lg font-bold text-white mb-1">
              {isSeriesOccurrence ? 'Удалить это занятие?' : 'Удалить событие?'}
            </h3>
            <p className="text-sm text-pb-subtext mb-5">
              {isSeriesOccurrence
                ? 'Удалится только это занятие. Остальные занятия серии останутся на месте.'
                : `«${event.title}» исчезнет из календаря у всей команды.`}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIsDeleteConfirmOpen(false)}
                disabled={isDeletingEvent}
                className="flex-1 py-3 rounded-xl bg-white/5 text-pb-subtext hover:text-white transition-colors disabled:opacity-60"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleDeleteThisOccurrence}
                disabled={isDeletingEvent}
                className="flex-1 py-3 rounded-xl bg-pb-danger text-white font-bold hover:bg-opacity-90 transition-colors disabled:opacity-60"
              >
                {isDeletingEvent ? 'Удаляем…' : 'Удалить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isEditTimeOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setIsEditTimeOpen(false)}></div>
          <div className="relative w-full max-w-sm max-h-[88vh] overflow-y-auto bg-pb-surface rounded-2xl border border-white/10 shadow-2xl p-6 animate-fade-in">
            <h3 className="text-lg font-bold text-white mb-1">Изменить событие</h3>
            <p className="text-sm text-pb-subtext mb-5">
              {isSeriesOccurrence
                ? 'Изменится только это занятие серии.'
                : 'Изменения увидит вся команда.'}
            </p>
            <div className="space-y-4">
              <div>
                <label className="text-pb-subtext text-xs uppercase font-bold mb-1 block">Название</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="Название события"
                  className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-pb-primary focus:outline-none placeholder:text-white/20"
                />
              </div>

              <LocationAutocompleteInput
                name={editLocation}
                address={editLocationAddress}
                url={editLocationUrl}
                onChange={({ name, address, url }) => {
                  setEditLocation(name);
                  setEditLocationAddress(address);
                  setEditLocationUrl(url);
                }}
              />

              <div>
                <label className="text-pb-subtext text-xs uppercase font-bold mb-1 block">Дата</label>
                <input
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-pb-primary focus:outline-none [color-scheme:dark]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="min-w-0">
                  <label className="text-pb-subtext text-xs uppercase font-bold mb-1 block">Начало</label>
                  <input
                    type="time"
                    value={editStartTime}
                    onChange={(e) => setEditStartTime(e.target.value)}
                    className="w-full min-w-0 bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-pb-primary focus:outline-none [color-scheme:dark]"
                  />
                </div>
                <div className="min-w-0">
                  <label className="text-pb-subtext text-xs uppercase font-bold mb-1 block">Окончание</label>
                  <input
                    type="time"
                    value={editEndTime}
                    onChange={(e) => setEditEndTime(e.target.value)}
                    className="w-full min-w-0 bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-pb-primary focus:outline-none [color-scheme:dark]"
                  />
                </div>
              </div>

              <div>
                <label className="text-pb-subtext text-xs uppercase font-bold mb-1 block">Стоимость (₽)</label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={editCost}
                  onChange={(e) => setEditCost(e.target.value)}
                  placeholder="0"
                  className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-pb-primary focus:outline-none placeholder:text-white/20"
                />
              </div>

              <div>
                <label className="text-pb-subtext text-xs uppercase font-bold mb-1 block">Описание</label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={3}
                  placeholder="План, снаряжение, заметки…"
                  className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-pb-primary focus:outline-none placeholder:text-white/20 resize-none"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button
                type="button"
                onClick={() => setIsEditTimeOpen(false)}
                disabled={isSavingTime}
                className="flex-1 py-3 rounded-xl bg-white/5 text-pb-subtext hover:text-white transition-colors disabled:opacity-60"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleSaveTime}
                disabled={isSavingTime}
                className="flex-1 py-3 rounded-xl bg-pb-primary text-pb-background font-bold hover:bg-opacity-90 transition-colors disabled:opacity-60"
              >
                {isSavingTime ? 'Сохраняем…' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {pointsGame && (
        <GamePointsModal isOpen game={pointsGame} teamName={teamName} onClose={() => setPointsGame(null)} />
      )}

      {isTableOpen && <EventTableModal isOpen eventId={event.id} onClose={() => setIsTableOpen(false)} />}

      {isAddingGame && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setIsAddingGame(false)}></div>
          <div className="relative w-full max-w-sm bg-pb-surface rounded-2xl border border-white/10 shadow-2xl p-6 animate-fade-in">
            <h3 className="text-lg font-bold text-white mb-4">Добавить игру</h3>
            <form onSubmit={handleAddGameSubmit} className="space-y-4">
              <div>
                <label className="text-pb-subtext text-xs uppercase font-bold mb-1 block">Время начала</label>
                <input
                  type="time"
                  value={newGameTime}
                  onChange={(e) => setNewGameTime(e.target.value)}
                  className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-pb-primary focus:outline-none [color-scheme:dark]"
                  required
                />
              </div>
              <div>
                <label className="text-pb-subtext text-xs uppercase font-bold mb-1 block">Соперник</label>
                <input
                  type="text"
                  placeholder="Название команды"
                  value={newGameOpponent}
                  onChange={(e) => setNewGameOpponent(e.target.value)}
                  className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-pb-primary focus:outline-none"
                  required
                />
              </div>
              <div>
                <label className="text-pb-subtext text-xs uppercase font-bold mb-1 block">Пит-зона</label>
                <select
                  value={newGamePitZone}
                  onChange={(e) => setNewGamePitZone(e.target.value as 'NEAR' | 'FAR')}
                  className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-pb-primary focus:outline-none"
                >
                  <option value="NEAR">Ближняя пит-зона</option>
                  <option value="FAR">Дальняя пит-зона</option>
                </select>
              </div>
              <div>
                <label className="text-pb-subtext text-xs uppercase font-bold mb-1 block">Пара</label>
                <select
                  value={newGamePair}
                  onChange={(e) => setNewGamePair(e.target.value as 'FIRST' | 'SECOND')}
                  className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-pb-primary focus:outline-none"
                >
                  <option value="FIRST">Первая пара</option>
                  <option value="SECOND">Вторая пара</option>
                </select>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddingGame(false)}
                  className="flex-1 py-3 rounded-xl bg-white/5 text-pb-subtext hover:text-white transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 rounded-xl bg-pb-primary text-pb-background font-bold hover:bg-opacity-90 transition-colors"
                >
                  Сохранить
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingGame && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setEditingGame(null)}></div>
          <div className="relative w-full max-w-sm bg-pb-surface rounded-2xl border border-white/10 shadow-2xl p-6 animate-fade-in">
            <h3 className="text-lg font-bold text-white mb-1">Карточка игры</h3>
            <p className="text-xs text-pb-subtext mb-4">Соперник: {editingGame.opponent}</p>

            <form onSubmit={handleUpdateGameSubmit} className="space-y-4">
              <div>
                <label className="text-pb-subtext text-xs uppercase font-bold mb-1 block">Время игры</label>
                <input
                  type="time"
                  value={editGameTime}
                  onChange={(e) => setEditGameTime(e.target.value)}
                  disabled={!isAdminOrCaptain || isSavingGame}
                  className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-pb-primary focus:outline-none disabled:opacity-60 [color-scheme:dark]"
                  required
                />
              </div>
              <div>
                <label className="text-pb-subtext text-xs uppercase font-bold mb-1 block">Соперник</label>
                <input
                  type="text"
                  value={editGameOpponent}
                  onChange={(e) => setEditGameOpponent(e.target.value)}
                  disabled={!isAdminOrCaptain || isSavingGame}
                  className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-pb-primary focus:outline-none disabled:opacity-60"
                  required
                />
              </div>
              <div>
                <label className="text-pb-subtext text-xs uppercase font-bold mb-1 block">Пит-зона</label>
                <select
                  value={editGamePitZone}
                  onChange={(e) => setEditGamePitZone(e.target.value as 'NEAR' | 'FAR')}
                  disabled={!isAdminOrCaptain || isSavingGame}
                  className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-pb-primary focus:outline-none disabled:opacity-60"
                >
                  <option value="NEAR">Ближняя пит-зона</option>
                  <option value="FAR">Дальняя пит-зона</option>
                </select>
              </div>
              <div>
                <label className="text-pb-subtext text-xs uppercase font-bold mb-1 block">Пара</label>
                <select
                  value={editGamePair}
                  onChange={(e) => setEditGamePair(e.target.value as 'FIRST' | 'SECOND')}
                  disabled={!isAdminOrCaptain || isSavingGame}
                  className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-pb-primary focus:outline-none disabled:opacity-60"
                >
                  <option value="FIRST">Первая пара</option>
                  <option value="SECOND">Вторая пара</option>
                </select>
              </div>
              <div>
                <label className="text-pb-subtext text-xs uppercase font-bold mb-1 block">Счет (необязательно)</label>
                <input
                  type="text"
                  placeholder="например 4:2"
                  value={editGameScore}
                  onChange={(e) => setEditGameScore(e.target.value)}
                  disabled={!isAdminOrCaptain || isSavingGame}
                  className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-pb-primary focus:outline-none disabled:opacity-60"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingGame(null)}
                  className="flex-1 py-3 rounded-xl bg-white/5 text-pb-subtext hover:text-white transition-colors"
                >
                  Закрыть
                </button>
                {isAdminOrCaptain && (
                  <button
                    type="submit"
                    disabled={isSavingGame}
                    className="flex-1 py-3 rounded-xl bg-pb-primary text-pb-background font-bold hover:bg-opacity-90 transition-colors disabled:opacity-60"
                  >
                    {isSavingGame ? 'Сохранение...' : 'Сохранить'}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
