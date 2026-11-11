import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Event, Game, RSVPStatus, Role, Transaction, TransactionType, PlayerStatus } from '../types';
import { EVENT_LABELS } from '../constants';
import { api, type FinanceEventDetailResponse, type SeriesContextResponse } from '../api';
import { EventCollectionSheet } from '../components/EventCollectionSheet';
import { EventExpensesSheet } from '../components/EventExpensesSheet';
import { FinanceTransactionModal } from '../components/FinanceTransactionModal';
import { TransferConfirmationModal } from '../components/TransferConfirmationModal';
import { GamePointsModal } from '../components/GamePointsModal';
import { EventTableModal } from '../components/EventTableModal';
import { buildEventExpensesViewModel } from '../lib/event-expenses-view-model';
import { buildEventFinanceViewModel } from '../lib/event-finance-view-model';
import { canShowEventCollection } from '../lib/event-collection-access';
import { EventExtBlocks } from '../shell/EventExtBlocks';
import { shellExtensions } from '../shell/extensions';
import { announceRemindersSent, sendEventReminder as sendTrack2Reminder, type ReminderAudience as Track2Audience } from '../api/track2';
import { summarizeReminderResult } from '../components/track2/reminder-result';
import { groupAttendance } from '../lib/attendance';
import { confirmAction, errorText, notify } from '../lib/notify';
import { answerAndRefresh, applyRsvpToAttendees, canAnswerRsvp, createLatestOnly } from '../lib/rsvp';
import {
  buildRoster,
  canManageSlots,
  eventDateLabel,
  eventPermissions,
  eventPhase,
  eventTypeIcon,
  eventUntilLabel,
  hasGameSchedule,
  isGameReminderTemplate,
  ownAnswer,
  reminderErrorText,
  resolveEnd,
  silentLabel,
  sortSchedule,
  timeLabel,
  type EditPatch,
  type EventAttendee,
  type ReminderAudience,
  type ReminderTemplate,
} from '../lib/event-view';
import { Glass, Screen, ScreenBar, TeamMark, teamPaint } from '../ui';
import { CaptainPanel, type PanelTile } from '../components/event/CaptainPanel';
import { EventHero, type SeriesState } from '../components/event/EventHero';
import { RosterBlock } from '../components/event/RosterBlock';
import { EventMoney, type CollectionSummary } from '../components/event/EventMoney';
import { EventPlace } from '../components/event/EventPlace';
import { GameSchedule } from '../components/event/GameSchedule';
import { AddGameSheet, EditEventSheet, GameCardSheet } from '../components/event/EventSheets';
import { AttendanceSheet } from '../components/event/AttendanceSheet';
import { ReminderSheet } from '../components/event/ReminderSheet';
import { MoreSheet, type MoreItem } from '../components/event/MoreSheet';
import { ChargeSheet, type ChargeAudience, type ChargeMode } from '../components/event/ChargeSheet';
import '../components/event/event.css';

interface EventDetailViewProps {
  event: Event;
  currentUserRole: Role;
  /** Имя своей команды — в расписании счёт показывается как «мы N:N соперник». */
  teamName: string;
  onBack: () => void;
  /** Свой ответ на явку. Промис завершается, когда запрос завершился (ошибку показывает оболочка). */
  onRsvp: (id: string, status: RSVPStatus) => Promise<unknown> | void;
  /** Кто смотрит: его строка в списке явки меняется сразу после ответа. */
  currentUserId?: string;
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

export const EventDetailView: React.FC<EventDetailViewProps> = ({
  event,
  currentUserRole,
  teamName,
  onBack,
  onRsvp,
  currentUserId,
  onAddGame,
  onUpdateGame,
  onAttendeeClick,
  onDeleteEvent,
  onEditTime,
  onEditEvent,
}) => {
  const [attendees, setAttendees] = useState<EventAttendee[]>([]);
  const [isAttendeesLoading, setIsAttendeesLoading] = useState(false);
  const [seriesContext, setSeriesContext] = useState<SeriesContextResponse | null>(null);
  const [isSeriesBusy, setIsSeriesBusy] = useState(false);
  const [isReminding, setIsReminding] = useState(false);

  // Какое окно открыто. Окна монтируются только открытыми и держат свои поля сами.
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isAddingGame, setIsAddingGame] = useState(false);
  const [editingGame, setEditingGame] = useState<Game | null>(null);
  const [pointsGame, setPointsGame] = useState<Game | null>(null);
  const [isTableOpen, setIsTableOpen] = useState(false);
  const [isAttendanceOpen, setIsAttendanceOpen] = useState(false);
  const [isReminderOpen, setIsReminderOpen] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);

  // «Сбор по событию» (выключен флагом, код и данные на месте).
  const [financeDetail, setFinanceDetail] = useState<FinanceEventDetailResponse | null>(null);
  const [isFinanceLoading, setIsFinanceLoading] = useState(false);
  const [isExpensesSheetOpen, setIsExpensesSheetOpen] = useState(false);
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<(Partial<Transaction> & { id?: string }) | null>(null);
  const [isChargeModalOpen, setIsChargeModalOpen] = useState(false);
  const [isCollectionSheetOpen, setIsCollectionSheetOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferDefaultUserId, setTransferDefaultUserId] = useState<string | undefined>(undefined);
  const [isSubmittingCharges, setIsSubmittingCharges] = useState(false);
  const [isRemindingDebtors, setIsRemindingDebtors] = useState(false);

  const extRef = useRef<HTMLDivElement>(null);

  const perms = eventPermissions({
    role: currentUserRole,
    type: event.type,
    hasDeleteHandler: Boolean(onDeleteEvent),
    hasEditHandler: Boolean(onEditTime),
  });
  const isSeriesOccurrence = Boolean(event.seriesId);
  const end = resolveEnd(event);
  const phase = eventPhase(event.startDate, end);
  const hasEventStarted = phase !== 'upcoming';
  // «Сбор по событию» спрятан у всех, пока его не переделают (решение Василия
  // 10.11.2026, п. 9). Тем же условием выключены загрузка данных и листы ниже:
  // код и данные остаются, не показывается только то, что не работает.
  const canReadEventFinance = canShowEventCollection(currentUserRole);
  const showSchedule = hasGameSchedule(event.type);
  const sortedSchedule = sortSchedule(event.schedule);
  const paint = teamPaint(event.teamId);

  // Карта явки (#48): держим ВСЕХ участников со статусами, а не только
  // CONFIRMED — иначе капитан не видит молчунов.
  //
  // Своё «Иду / Не иду / Думаю» меняет список сразу, а после запроса список
  // перечитывается (`answerAndRefresh`). Чтения нумеруются: ответ более
  // раннего чтения, пришедший позже, не затирает новый ответ.
  const attendeesGate = useRef(createLatestOnly()).current;
  const refreshAttendees = useCallback(async () => {
    const token = attendeesGate.next();
    try {
      const response = await api.getEventAttendees(event.id);
      if (attendeesGate.isLatest(token)) setAttendees(response.attendees);
    } catch (error) {
      if (!attendeesGate.isLatest(token)) return;
      setAttendees(
        (event.attendeePreview || []).map((item) => ({
          userId: item.userId,
          name: item.name,
          nickname: item.nickname,
          avatar: item.avatar,
          role: 'PLAYER' as const,
          memberStatus: 'ACTIVE' as const,
          rsvpStatus: 'CONFIRMED' as const,
        }))
      );
    }
  }, [attendeesGate, event.id, event.attendeePreview]);

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
    void api
      .getSeriesContext(event.seriesId)
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
    const load = async () => {
      setIsFinanceLoading(true);
      try {
        const response = await api.getFinanceEventDetail(event.id);
        if (!cancelled) setFinanceDetail(response);
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load event finance detail', error);
          setFinanceDetail(null);
        }
      } finally {
        if (!cancelled) setIsFinanceLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [canReadEventFinance, event.id]);

  // Свой ответ на явку есть только у того, кто в составе команды события.
  const canAnswer = canAnswerRsvp(event);
  const answer = ownAnswer(event.rsvpStatus);

  const handleStatusChange = (status: RSVPStatus) => {
    if (!canAnswer) return;
    void answerAndRefresh({
      latest: attendeesGate,
      applyLocal: () => setAttendees((prev) => applyRsvpToAttendees(prev, currentUserId, status)),
      send: () => onRsvp(event.id, status),
      load: () => api.getEventAttendees(event.id),
      commit: (response) => setAttendees(response.attendees),
    });
  };

  // #60: «Иду на все» — согласие на серию. После — перезагружаем карту явки,
  // чтобы статус игрока перетёк в «Идут» (дефолт от серии).
  const changeSeries = async (commit: boolean) => {
    if (!event.seriesId) return;
    const seriesId = event.seriesId;
    setIsSeriesBusy(true);
    try {
      if (commit) await api.commitSeries(seriesId);
      else await api.leaveSeries(seriesId);
      setSeriesContext((prev) => (prev ? { ...prev, committed: commit } : prev));
      await refreshAttendees();
    } catch (error) {
      console.error('Failed to change series commitment', error);
      notify.error(errorText(error, commit ? 'Не удалось записаться на серию.' : 'Не удалось выйти из серии.'));
    } finally {
      setIsSeriesBusy(false);
    }
  };

  // #61: удалить только это занятие (scope single). Серия сохраняется.
  const handleDelete = async () => {
    if (!onDeleteEvent) return;
    const ok = await confirmAction(
      isSeriesOccurrence
        ? 'Удалить это занятие? Остальные занятия серии останутся на месте.'
        : `Удалить «${event.title}»? Событие исчезнет из календаря у всей команды.`,
      { confirmLabel: 'Удалить', danger: true }
    );
    if (!ok) return;
    try {
      await onDeleteEvent(event.id, 'single');
    } catch (error) {
      console.error('Failed to delete event', error);
      notify.error(errorText(error, 'Не удалось удалить событие.'));
    }
  };

  const handleSaveEvent = async (patch: EditPatch) => {
    if (onEditEvent) await onEditEvent(event.id, patch);
    else if (onEditTime) await onEditTime(event.id, patch.startISO, patch.endISO);
  };

  // Трек 2: рассылка идёт своей ручкой, итог — через notify с именами тех,
  // кому не ушло, и с пушами наравне с Telegram (раньше «Отправлено: 0»).
  const sendReminder = async (
    payload: { audience: Track2Audience; template: ReminderTemplate; gameId?: string },
    expected?: number
  ): Promise<boolean> => {
    setIsReminding(true);
    try {
      const result = await sendTrack2Reminder({ eventId: event.id, ...payload });
      const summary = summarizeReminderResult(result, expected);
      notify[summary.kind](summary.text);
      announceRemindersSent(event.id);
      return true;
    } catch (error) {
      const status = (error as { status?: number } | null)?.status;
      notify.error(reminderErrorText(status, isGameReminderTemplate(payload.template)));
      return false;
    } finally {
      setIsReminding(false);
    }
  };

  // «Напомнить» тем, кто не ответил: без ответа и «думаю»; согласие на серию считается ответом.
  const handleRemindSilent = () =>
    void sendReminder({ audience: 'SILENT', template: 'EVENT_REMINDER' }, groupAttendance(attendees).counts.silent);

  const reloadEventFinance = async () => {
    if (!canReadEventFinance) return;
    setIsFinanceLoading(true);
    try {
      setFinanceDetail(await api.getFinanceEventDetail(event.id));
    } finally {
      setIsFinanceLoading(false);
    }
  };

  const financeViewModel = financeDetail ? buildEventFinanceViewModel({ currentUserRole, detail: financeDetail }) : null;
  const eventExpensesViewModel = financeDetail ? buildEventExpensesViewModel({ currentUserRole, detail: financeDetail }) : null;
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
  const suggestedChargeAmount = financeDetail?.participants.find((item) => Number(item.amountDue || 0) > 0)?.amountDue;

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

  const handleGenerateCharges = async (payload: { audience: ChargeAudience; mode: ChargeMode; amount: string }) => {
    setIsSubmittingCharges(true);
    try {
      await api.generateEventCharges({
        eventId: event.id,
        mode: payload.audience,
        amountType: payload.mode,
        totalAmount: undefined,
        fixedAmount: payload.mode === 'FIXED_PER_PERSON' ? Number(payload.amount) : undefined,
        overwriteExisting: false,
      });
      setIsChargeModalOpen(false);
      await reloadEventFinance();
    } catch (error) {
      console.error('Failed to generate event charges', error);
      notify.error(errorText(error, 'Не удалось начислить участникам.'));
    } finally {
      setIsSubmittingCharges(false);
    }
  };

  const handleRemindEventDebtors = async () => {
    if (!financeDetail) return;
    const debtorIds = financeDetail.participants.filter((item) => item.amountOutstanding > 0).map((item) => item.userId);
    if (debtorIds.length === 0) {
      notify.info('По событию нет должников.');
      return;
    }
    setIsRemindingDebtors(true);
    try {
      await api.remindEventDebtors({ eventId: event.id, userIds: debtorIds });
    } catch (error) {
      console.error('Failed to remind event debtors', error);
      notify.error(errorText(error, 'Не удалось напомнить должникам.'));
    } finally {
      setIsRemindingDebtors(false);
    }
  };

  const openEditExpenseModal = (transactionId: string) => {
    const sourceExpense = financeDetail?.payments.find(
      (item) => item.transactionId === transactionId && item.type === TransactionType.EXPENSE
    );
    if (!sourceExpense) {
      notify.error('Не удалось найти расход для редактирования.');
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

  // ───────── вид ─────────

  const roster = buildRoster({
    attendees,
    selfId: currentUserId,
    maxAttendees: event.maxAttendees,
    fallbackGoing: event.attendeesCount,
  });
  const typeLabel = EVENT_LABELS[event.type];
  const showTitle = event.title && event.title.trim().toLowerCase() !== typeLabel.toLowerCase() ? event.title : undefined;

  const seriesState: SeriesState | null =
    isSeriesOccurrence && seriesContext
      ? {
          committed: seriesContext.committed,
          upcomingCount: seriesContext.upcomingCount,
          busy: isSeriesBusy,
          onCommit: () => void changeSeries(true),
          onLeave: () => void changeSeries(false),
        }
      : null;

  const slotsAvailable =
    canManageSlots(currentUserRole) && shellExtensions.eventBlocks.some((block) => block.id === 'free-slots');
  const scrollToSlots = () =>
    extRef.current?.querySelector('[data-testid="slots-block"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  const tiles: PanelTile[] = [];
  if (perms.canRemind) {
    tiles.push({
      key: 'remind',
      icon: 'bell',
      title: 'Напомнить',
      sub: 'не ответившим',
      disabled: isReminding || roster.silent.length === 0,
      onClick: handleRemindSilent,
    });
  }
  if (slotsAvailable) {
    tiles.push({ key: 'slots', icon: 'users', title: 'Слоты', sub: 'места и цена', onClick: scrollToSlots });
  }
  if (perms.canManageAttendance) {
    tiles.push({
      key: 'attendance',
      icon: 'clipboard-check',
      title: 'Явка',
      sub: hasEventStarted ? 'отметить' : 'после начала',
      disabled: !hasEventStarted || attendees.length === 0,
      onClick: () => setIsAttendanceOpen(true),
    });
  }
  if (perms.canEdit) {
    tiles.push({ key: 'edit', icon: 'pencil', title: 'Изменить', sub: 'время и место', onClick: () => setIsEditOpen(true) });
  }

  const moreItems: MoreItem[] = [];
  if (perms.canRemind) {
    moreItems.push({ key: 'reminder', icon: 'send', label: 'Напоминание по выбору', onClick: () => setIsReminderOpen(true) });
  }
  if (canReadEventFinance && financeViewModel?.canManage) {
    moreItems.push({ key: 'expenses', icon: 'receipt', label: 'Расходы события', onClick: () => setIsExpensesSheetOpen(true) });
  }
  if (perms.canDelete) {
    moreItems.push({
      key: 'delete',
      icon: 'trash-2',
      label: isSeriesOccurrence ? 'Удалить это занятие' : 'Удалить событие',
      danger: true,
      onClick: () => void handleDelete(),
    });
  }
  const showPanel = tiles.length > 0 || moreItems.length > 0;

  const collection: CollectionSummary | null =
    canReadEventFinance && (isFinanceLoading || financeViewModel)
      ? {
          statusLabel: financeViewModel?.collectionStatusLabel || 'Сбор не создан',
          cards: financeViewModel?.summaryCards || [],
          loading: isFinanceLoading,
          canManage: Boolean(financeViewModel?.canManage),
          onAddExpense: () => setIsExpensesSheetOpen(true),
        }
      : null;

  return (
    <Screen paints={[paint]}>
      <div className="pbth-event" style={{ ['--pbth-event-paint' as string]: paint }}>
        <Glass layer={1} className="pbth-event__bar">
          <ScreenBar
            onBack={onBack}
            mark={<TeamMark teamId={event.teamId} name={teamName} code={event.teamShortCode} size={40} />}
            title={teamName}
            subtitle={typeLabel}
          />
        </Glass>

        <EventHero
          dateLabel={eventDateLabel(event.startDate)}
          clock={timeLabel(event.startDate)}
          until={eventUntilLabel(event.startDate, end)}
          title={showTitle}
          location={event.location}
          typeIcon={eventTypeIcon(event.type)}
          isSeries={isSeriesOccurrence}
          canAnswer={canAnswer}
          answer={answer}
          onAnswer={handleStatusChange}
          series={seriesState}
        />

        {showPanel ? (
          <CaptainPanel
            title={currentUserRole === Role.TRAINER ? 'Тренер' : 'Капитан'}
            aside={perms.canRemind && roster.silent.length > 0 ? silentLabel(roster.silent.length) : undefined}
            tiles={tiles}
            onMore={moreItems.length > 0 ? () => setIsMoreOpen(true) : undefined}
          />
        ) : null}

        <RosterBlock
          roster={roster}
          loading={isAttendeesLoading}
          onPerson={(p) =>
            onAttendeeClick(p.userId, { name: p.name, nickname: p.nickname, avatar: p.avatar, role: p.role })
          }
          onJoin={canAnswer && answer === 'none' ? () => handleStatusChange(RSVPStatus.CONFIRMED) : undefined}
          onRemindSilent={perms.canRemind ? handleRemindSilent : undefined}
          reminding={isReminding}
        />

        <EventMoney cost={event.cost} collection={collection} />

        <EventPlace location={event.location} locationUrl={event.locationUrl} description={event.description} />

        {showSchedule ? (
          <GameSchedule
            games={sortedSchedule}
            teamName={teamName}
            canTable={perms.canSeeTable}
            canAdd={perms.canAddGame}
            onTable={() => setIsTableOpen(true)}
            onAdd={() => setIsAddingGame(true)}
            onOpenGame={setEditingGame}
            onPoints={setPointsGame}
          />
        ) : null}

        <div className="pbth-event__ext" ref={extRef}>
          <EventExtBlocks event={event} viewerRole={currentUserRole} />
        </div>
      </div>

      {isEditOpen ? (
        <EditEventSheet event={event} isSeries={isSeriesOccurrence} onClose={() => setIsEditOpen(false)} onSave={handleSaveEvent} />
      ) : null}
      {isAddingGame ? (
        <AddGameSheet onClose={() => setIsAddingGame(false)} onAdd={(game) => onAddGame(event.id, game)} />
      ) : null}
      {editingGame ? (
        <GameCardSheet
          game={editingGame}
          canEdit={perms.isAdminOrCaptain}
          onClose={() => setEditingGame(null)}
          onSave={(game) => onUpdateGame(event.id, editingGame.id, game)}
        />
      ) : null}
      {pointsGame ? <GamePointsModal isOpen game={pointsGame} teamName={teamName} onClose={() => setPointsGame(null)} /> : null}
      {isTableOpen ? <EventTableModal isOpen eventId={event.id} onClose={() => setIsTableOpen(false)} /> : null}
      {isAttendanceOpen ? (
        <AttendanceSheet eventId={event.id} attendees={attendees} onClose={() => setIsAttendanceOpen(false)} />
      ) : null}
      {isReminderOpen ? (
        <ReminderSheet
          games={sortedSchedule}
          busy={isReminding}
          onClose={() => setIsReminderOpen(false)}
          onSend={(payload: { audience: ReminderAudience; template: ReminderTemplate; gameId?: string }) => sendReminder(payload)}
        />
      ) : null}
      {isMoreOpen ? <MoreSheet items={moreItems} onClose={() => setIsMoreOpen(false)} /> : null}

      {eventExpensesViewModel ? (
        <EventExpensesSheet
          isOpen={isExpensesSheetOpen}
          title={`Расходы · ${event.title}`}
          subtitle={`${eventDateLabel(event.startDate)}, ${timeLabel(event.startDate)}`}
          statusLabel={eventExpensesViewModel.collectionStatusLabel}
          totalSpentLabel={eventExpensesViewModel.totalSpentLabel}
          expenseCountLabel={eventExpensesViewModel.expenseCountLabel}
          deltaHint={eventExpensesViewModel.deltaHint}
          expenses={eventExpensesViewModel.expenses}
          canManage={eventExpensesViewModel.canManage}
          canOpenCollection={eventExpensesViewModel.canOpenCollection}
          collectionActionLabel={eventExpensesViewModel.collectionActionLabel}
          onClose={() => setIsExpensesSheetOpen(false)}
          onAddExpense={() => {
            setEditingExpense(null);
            setIsExpensesSheetOpen(false);
            setIsExpenseModalOpen(true);
          }}
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
        eventOptions={[{ eventId: event.id, title: event.title, startDate: event.startAt }]}
        initialEventId={event.id}
        initialTransaction={editingExpense ?? undefined}
        lockEventId
        onClose={() => {
          setIsExpenseModalOpen(false);
          setEditingExpense(null);
          setIsExpensesSheetOpen(true);
        }}
        onSubmit={handleSubmitEventExpense}
      />

      {financeViewModel && financeDetail ? (
        <EventCollectionSheet
          isOpen={isCollectionSheetOpen}
          title={event.title}
          subtitle={`${eventDateLabel(event.startDate)}, ${timeLabel(event.startDate)} · ${financeDetail.participants.filter((item) => item.amountDue > 0).length} в сборе`}
          statusLabel={financeViewModel.collectionStatusLabel}
          summaryCards={financeViewModel.collectionCards}
          participants={financeDetail.participants}
          expenses={financeViewModel.expenses}
          recentOperations={financeViewModel.recentOperations}
          canManage={financeViewModel.canManage}
          onClose={() => setIsCollectionSheetOpen(false)}
          onSettleTransfer={(userId) => {
            setTransferDefaultUserId(userId);
            setIsTransferModalOpen(true);
          }}
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
            notify.error(errorText(error, 'Не удалось зачесть перевод.'));
          }
        }}
      />

      {isChargeModalOpen ? (
        <ChargeSheet
          participants={(financeDetail?.participants || []).map((item) => ({
            userId: item.userId,
            role: item.role || 'PLAYER',
            rsvpStatus: item.rsvpStatus || 'UNANSWERED',
            amountDue: Number(item.amountDue || 0),
          }))}
          undistributed={undistributedChargeAmount}
          hasExisting={hasExistingCharges}
          suggestedAmount={suggestedChargeAmount}
          busy={isSubmittingCharges}
          onClose={() => setIsChargeModalOpen(false)}
          onSubmit={(payload) => void handleGenerateCharges(payload)}
        />
      ) : null}
    </Screen>
  );
};
