import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { LandingView } from './views/LandingView';
import { ViewState, Role, User, Team, Event, RSVPStatus, TeamMember, AuthStep, UserRoleOption, Transaction, TransactionType, PlayerStatus, Game } from './types';
import { BottomNav } from './components/BottomNav';
import { Dashboard } from './views/Dashboard';
import { CalendarView } from './views/CalendarView';
import { TeamView } from './views/TeamView';
import { EventDetailView } from './views/EventDetailView';
import { CreateEventView } from './views/CreateEventView';
import { LoginView } from './views/LoginView';
import { ProfileView } from './views/ProfileView';
import { FinanceView } from './views/FinanceView';
import { PrivacyView } from './views/PrivacyView';
import { TermsView } from './views/TermsView';
import { SupportView } from './views/SupportView';
import { PlayerProfileView } from './views/PlayerProfileView';
import { InviteView } from './views/InviteView';
import { RSVPModal } from './components/RSVPModal';
import { Plus, Loader2 } from 'lucide-react';
import { api, type NotificationDeliveryResponse } from './api'; // Import API

type InitLoadResult = 'ok' | 'no_team' | 'admin_mode' | 'invalid_shape' | 'error';

const App: React.FC = () => {
  const navigate = useNavigate();
  const [authStep, setAuthStep] = useState<AuthStep>('LOGIN');
  const [isLoading, setIsLoading] = useState(false);
  const [authBootstrapDone, setAuthBootstrapDone] = useState(false);
  const [appGate, setAppGate] = useState<'READY' | 'NO_TEAM' | 'ADMIN_MODE'>('READY');
  
  // Data State
  const [user, setUser] = useState<User | null>(null);
  const [activeTeam, setActiveTeam] = useState<Team | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [calendarLink, setCalendarLink] = useState<string>('');
  
  const [currentView, setCurrentView] = useState<ViewState>('DASHBOARD');

  // Interaction State
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [isRSVPModalOpen, setIsRSVPModalOpen] = useState(false);
  const [rsvpModalEvent, setRsvpModalEvent] = useState<Event | null>(null);

  const isTelegramMiniApp = () =>
    typeof window !== 'undefined' && Boolean((window as any).Telegram?.WebApp);

  // Initial Fetch
  const loadData = async (options?: { silent?: boolean }): Promise<InitLoadResult> => {
    setIsLoading(true);
    try {
        const data = await api.getInitData();

        if (data?.noTeamYet) {
          throw new Error('INIT_NO_TEAM');
        }
        if (data?.admin) {
          throw new Error('INIT_ADMIN_MODE');
        }
        if (!data?.user || !data?.team) {
          throw new Error('INIT_INVALID_SHAPE');
        }

        setUser(data.user);
        setActiveTeam(data.team);
        setEvents(data.events || []);
        setMembers(data.members || []);
        setTransactions(data.transactions || []);

        try {
          const [financeOverview, financeMembers] = await Promise.all([
            api.getFinanceOverview(data.team.id),
            api.getFinanceMembers(data.team.id),
          ]);

          const financeBalance = financeOverview?.summary?.balance;
          if (financeBalance !== undefined) {
            setActiveTeam((prev) =>
              prev ? { ...prev, budget: Number(financeBalance) } : prev
            );
          }

          if (Array.isArray(financeMembers?.items)) {
            const financeByUserId = new Map<string, { outstanding: number; overpaid: number }>();
            for (const item of financeMembers.items) {
              financeByUserId.set(String(item.userId), {
                outstanding: Number(item.outstanding || 0),
                overpaid: Number(item.overpaid || 0),
              });
            }
            setMembers((prev) =>
              prev.map((m) => {
                const s = financeByUserId.get(m.id);
                if (!s) return m;
                return { ...m, balance: s.overpaid - s.outstanding };
              })
            );
          }

          if (Array.isArray(financeOverview?.recentTransactions) && financeOverview.recentTransactions.length > 0) {
            setTransactions(
              financeOverview.recentTransactions.map((t: any) => ({
                id: String(t.id),
                type: t.type as TransactionType,
                amount: Number(t.amount),
                title: String(t.title),
                date: new Date(t.date),
                userId: t.userId || undefined,
                userName: t.userName || undefined,
                status: (t.status as 'PENDING' | 'COMPLETED') || 'COMPLETED',
              }))
            );
          }
        } catch (financeErr) {
          console.warn('Finance bootstrap fallback to init payload', financeErr);
        }

        try {
          const ics = await api.getIcs(data.team.id);
          setCalendarLink(ics.url);
        } catch (icsErr) {
          console.warn('ICS bootstrap failed', icsErr);
          setCalendarLink('');
        }
        setAppGate('READY');
        return 'ok';
    } catch (e) {
        console.error("Error loading data", e);
        if (!options?.silent) {
          const message = e instanceof Error ? e.message : '';
          if (message.includes('INIT_NO_TEAM')) {
            alert('Вход выполнен, но вы пока не состоите ни в одной команде. Попросите капитана прислать инвайт.');
            setAppGate('NO_TEAM');
            return 'no_team';
          } else if (message.includes('INIT_ADMIN_MODE')) {
            alert('Вход выполнен в админ-режиме. Этот экран пока не поддерживается в мобильном приложении.');
            setAppGate('ADMIN_MODE');
            return 'admin_mode';
          } else {
            alert("Не удалось открыть приложение после входа. Проверьте авторизацию и попробуйте еще раз.");
          }
        } else {
          const message = e instanceof Error ? e.message : '';
          if (message.includes('INIT_NO_TEAM')) {
            setAppGate('NO_TEAM');
            return 'no_team';
          }
          if (message.includes('INIT_ADMIN_MODE')) {
            setAppGate('ADMIN_MODE');
            return 'admin_mode';
          }
        }
        return e instanceof Error && e.message.includes('INIT_INVALID_SHAPE')
          ? 'invalid_shape'
          : 'error';
    } finally {
        setIsLoading(false);
    }
  };

  const tryEnterUserApp = async (options?: { silent?: boolean }) => {
    const result = await loadData(options);
    if (result === 'ok' || result === 'no_team') return true;

    try {
      const meRes = await fetch('/api/v1/auth/me', { credentials: 'include' });
      if (!meRes.ok) return false;
      const me = await meRes.json();
      if (!me?.authenticated) return false;

      if (me?.roleSelectionRequired || me?.accountRole === 'ADMIN') {
        const selectRes = await fetch('/api/v1/auth/select-role', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ accountRole: 'USER' }),
        });
        if (!selectRes.ok) return false;
        const retry = await loadData(options);
        return retry === 'ok' || retry === 'no_team';
      }
    } catch (error) {
      console.error('Failed to switch account role to USER', error);
    }

    return result === 'admin_mode';
  };

  useEffect(() => {
    let cancelled = false;

    const restoreSession = async () => {
      try {
        let res = await fetch('/api/v1/auth/me', { credentials: 'include' });
        if (!res.ok) return;
        let payload = await res.json();

        if (!payload?.authenticated && isTelegramMiniApp()) {
          const initData = String((window as any).Telegram?.WebApp?.initData || '').trim();
          if (initData) {
            try {
              await api.authTelegramWebApp(initData);
              res = await fetch('/api/v1/auth/me', { credentials: 'include' });
              payload = res.ok ? await res.json() : payload;
            } catch (err) {
              console.warn('Telegram Mini App auto-auth failed', err);
            }
          }
        }

        if (!payload?.authenticated || cancelled) return;

        if (payload?.user) {
          setUser((prev) => {
            if (prev?.id === payload.user.id) return prev;
            return {
              id: String(payload.user.id),
              name: String(payload.user.name || ''),
              nickname: String(payload.user.nickname || ''),
              avatar: payload.user.avatar ? String(payload.user.avatar) : undefined,
            };
          });
        }

        const ok = await tryEnterUserApp({ silent: true });
        if (cancelled) return;
        if (!ok) {
          setAuthStep('LOGIN');
          return;
        }

        setAuthStep('APP');

        const postAuthRequested = sessionStorage.getItem('pbth:post-auth-app') === '1';
        const currentPath = window.location.pathname;
        const isPublicEntryPath = currentPath === '/' || currentPath === '/login';
        const isInvitePath = currentPath.startsWith('/invite/');
        const shouldOpenApp =
          !isInvitePath &&
          (postAuthRequested || isTelegramMiniApp() || isPublicEntryPath);

        if (postAuthRequested) {
          sessionStorage.removeItem('pbth:post-auth-app');
        }

        if (shouldOpenApp) {
          navigate('/app', { replace: true });
        }
      } catch (error) {
        console.error('Failed to restore auth session', error);
      } finally {
        if (!cancelled) {
          setAuthBootstrapDone(true);
        }
      }
    };

    restoreSession();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  // --- AUTH HANDLERS ---
  const handleLogin = async () => {
    const ok = await tryEnterUserApp();
    if (ok) {
      sessionStorage.removeItem('pbth:post-auth-app');
      setAuthStep('APP');
      navigate('/app');
    }
  };

  const handleRoleSelect = (_option: UserRoleOption) => {
    // In real app, this would fetch context for that specific team
    handleLogin();
  };

  const handleLogout = () => {
    setAuthStep('LOGIN');
    setAppGate('READY');
    setCurrentView('DASHBOARD');
    setUser(null);
    setActiveTeam(null);
    setSelectedMember(null);
    setSelectedEvent(null);
    setCalendarLink('');
    navigate('/');
  };

  const handleCopyIcsLink = async () => {
    if (!calendarLink) {
      alert('Ссылка календаря недоступна. Обновите профиль.');
      return;
    }
    try {
      await navigator.clipboard.writeText(calendarLink);
      alert('Ссылка скопирована');
    } catch (err) {
      console.error('Failed to copy ICS link', err);
      alert('Не удалось скопировать ссылку');
    }
  };

  const handleShareIcsLink = async () => {
    if (!calendarLink) {
      alert('Ссылка календаря недоступна. Обновите профиль.');
      return;
    }
    try {
      if ((navigator as any).share) {
        await (navigator as any).share({ url: calendarLink, title: 'PBTH calendar' });
      } else {
        await navigator.clipboard.writeText(calendarLink);
        alert('Ссылка скопирована');
      }
    } catch (err) {
      console.error('Failed to share ICS link', err);
    }
  };

  const handleDownloadIcs = async () => {
    if (!activeTeam) return;
    try {
      const ics = await api.getIcs(activeTeam.id);
      window.location.assign(ics.downloadUrl);
    } catch (err) {
      console.error('Failed to download ICS', err);
      alert('Не удалось скачать ICS');
    }
  };

  const parseReminderResult = (result: NotificationDeliveryResponse) => {
    return {
      attempted: Number(result?.attempted || 0),
      sent: Number(result?.sent || 0),
      queued: Number(result?.queued || 0),
      skippedNoTelegram: Number(result?.skippedNoTelegram || 0),
      failed: Array.isArray(result?.failed) ? result.failed.length : 0,
    };
  };

  const handleSendEventReminder = async (payload: {
    eventId: string;
    audience: 'ALL' | 'RESPONDED' | 'UNANSWERED' | 'CONFIRMED' | 'PENDING' | 'DECLINED';
    template: 'EVENT_REMINDER' | 'WARMUP_REMINDER' | 'ROLE_REMINDER' | 'GAME_GATHERING' | 'GAME_WARMUP';
    gameId?: string;
  }) => {
    try {
      const result = await api.sendEventReminder(payload);
      const summary = parseReminderResult(result);
      if (summary.attempted === 0) {
        alert('Нет получателей для выбранного фильтра напоминания.');
        return;
      }
      alert(
        `Напоминания отправлены.\n` +
          `К отправке: ${summary.attempted}\n` +
          `Отправлено: ${summary.sent}\n` +
          `В очереди: ${summary.queued}\n` +
          `Без Telegram: ${summary.skippedNoTelegram}\n` +
          `Ошибок: ${summary.failed}`
      );
    } catch (err) {
      console.error('Failed to remind unanswered attendees', err);
      alert(`Не удалось отправить напоминания: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  };

  const handleRemindDebtor = async (userId: string, userName: string) => {
    try {
      const result = await api.remindFinanceMemberDebt({ userId });
      const summary = parseReminderResult(result);
      if (summary.sent + summary.queued > 0) {
        alert(
          `Напоминание для ${userName} отправлено.\n` +
            `Отправлено: ${summary.sent}\n` +
            `В очереди: ${summary.queued}`
        );
        return;
      }
      if (summary.skippedNoTelegram > 0) {
        alert(`Не удалось отправить ${userName}: у пользователя не привязан Telegram.`);
        return;
      }
      alert(`Не удалось отправить напоминание ${userName}. Проверьте логи уведомлений.`);
    } catch (err) {
      console.error('Failed to remind debtor', err);
      alert(`Не удалось отправить напоминание: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  };

  const handleRemindAllDebtors = async () => {
    try {
      const result = await api.remindFinanceDebtors();
      const summary = parseReminderResult(result);
      if (summary.attempted === 0) {
        alert('В команде нет должников для напоминания.');
        return;
      }
      alert(
        `Массовое напоминание отправлено.\n` +
          `К отправке: ${summary.attempted}\n` +
          `Отправлено: ${summary.sent}\n` +
          `В очереди: ${summary.queued}\n` +
          `Без Telegram: ${summary.skippedNoTelegram}\n` +
          `Ошибок: ${summary.failed}`
      );
    } catch (err) {
      console.error('Failed to remind all debtors', err);
      alert(`Не удалось отправить напоминания должникам: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  };

  // --- FINANCE HANDLER ---
  const handleAddTransaction = async (t: Omit<Transaction, 'id' | 'date'>) => {
    if (!activeTeam) return;
    const newTx: Transaction = {
        id: `tx${Date.now()}`,
        date: new Date(),
        ...t
    };
    
    // Optimistic Update
    setTransactions(prev => [newTx, ...prev]);
    if (t.type === TransactionType.EXPENSE && activeTeam) {
        setActiveTeam(prev => prev ? ({ ...prev, budget: prev.budget - t.amount }) : null);
    } else if (t.type === TransactionType.DEPOSIT && activeTeam) {
        setActiveTeam(prev => prev ? ({ ...prev, budget: prev.budget + t.amount }) : null);
    }

    // Server Call
    if (t.type === TransactionType.DEPOSIT) {
      await api.createFinancePayment({
        teamId: activeTeam.id,
        amount: t.amount,
        title: t.title,
        payerUserId: t.userId,
        status: t.status,
      });
      return;
    }
    await api.addTransaction(newTx);
  };

  // --- APP HANDLERS ---
  const handleRsvp = async (id: string, status: RSVPStatus) => {
    if (!user) return;
    
    // Optimistic Update
    setEvents(prev => prev.map(e => {
        if (e.id === id) {
            // Update counts loosely
            const diff = status === RSVPStatus.CONFIRMED ? 1 : (e.rsvpStatus === RSVPStatus.CONFIRMED ? -1 : 0);
            return { ...e, rsvpStatus: status, attendeesCount: e.attendeesCount + diff };
        }
        return e;
    }));
    
    if (selectedEvent && selectedEvent.id === id) {
        setSelectedEvent(prev => prev ? ({...prev, rsvpStatus: status}) : null);
    }

    // Server Call
    await api.rsvp(id, user.id, status);
  };

  const handleCreateEvent = async (eventData: any) => {
    if (!activeTeam) return;

    const startDate = eventData?.startDate instanceof Date ? eventData.startDate : new Date(eventData?.startDate);
    if (Number.isNaN(startDate.getTime())) {
      alert('Некорректная дата события');
      return;
    }

    const normalizedTitle = String(eventData?.title || '').trim();
    if (!normalizedTitle) {
      alert('Введите название события');
      return;
    }

    const normalizedDescription = String(eventData?.description || '').trim();
    const normalizedLocation = String(eventData?.location || '').trim();
    const normalizedCost =
      typeof eventData?.cost === 'number' && Number.isFinite(eventData.cost) && eventData.cost > 0
        ? eventData.cost
        : undefined;

    try {
      const response: any = await api.createEvent({
        teamId: activeTeam.id,
        type: eventData.type,
        title: normalizedTitle,
        description: normalizedDescription || undefined,
        startDate,
        location: normalizedLocation || undefined,
        cost: normalizedCost,
      });

      if (response?.event) {
        const dto = response.event;
        const rawStart = dto.startAt || dto.startDate;
        const rawEnd = dto.endAt || dto.endDate;
        const createdEvent: Event = {
          id: String(dto.id),
          teamId: String(dto.teamId || activeTeam.id),
          teamTimezone: dto.teamTimezone || activeTeam.timezone,
          financeState: dto.financeState,
          type: dto.type,
          title: dto.title,
          description: dto.description ?? undefined,
          startAt: rawStart,
          endAt: rawEnd,
          startDate: new Date(rawStart),
          endDate: rawEnd ? new Date(rawEnd) : undefined,
          location: dto.location ?? undefined,
          cost: dto.cost === null || dto.cost === undefined ? undefined : Number(dto.cost),
          rsvpStatus: dto.rsvpStatus || RSVPStatus.UNANSWERED,
          attendeesCount: Number(dto.attendeesCount || 0),
          schedule: dto.schedule || undefined,
        };

        setEvents((prev) =>
          [createdEvent, ...prev.filter((event) => event.id !== createdEvent.id)].sort(
            (a, b) => a.startDate.getTime() - b.startDate.getTime()
          )
        );
      } else {
        await loadData({ silent: true });
      }

      setCurrentView('DASHBOARD');
    } catch (error) {
      console.error('Failed to create event', error);
      alert(`Не удалось создать событие: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  };

  const handleEventClick = (event: Event) => setSelectedEvent(event);
  const handleEventLongPress = (event: Event) => {
    setRsvpModalEvent(event);
    setIsRSVPModalOpen(true);
  };

  const handleAddGame = async (eventId: string, game: Omit<Game, 'id'>) => {
    const createdGame: Game = {
      id: `g-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      time: game.time,
      opponent: game.opponent,
      score: game.score,
      pitZone: game.pitZone,
      gamePair: game.gamePair,
    };

    let nextScheduleForApi: Array<{ time: string; opponent: string; score?: string; pitZone?: 'NEAR' | 'FAR'; gamePair?: 'FIRST' | 'SECOND' }> = [];

    const applyAddGame = (sourceEvent: Event): Event => {
      const nextSchedule = [...(sourceEvent.schedule || []), createdGame].sort((a, b) =>
        a.time.localeCompare(b.time)
      );
      nextScheduleForApi = nextSchedule.map((item) => ({
        time: item.time,
        opponent: item.opponent,
        score: item.score,
        pitZone: item.pitZone,
        gamePair: item.gamePair,
      }));
      return { ...sourceEvent, schedule: nextSchedule };
    };

    setEvents((prev) =>
      prev.map((event) => (event.id === eventId ? applyAddGame(event) : event))
    );

    setSelectedEvent((prev) => {
      if (!prev || prev.id !== eventId) return prev;
      return applyAddGame(prev);
    });

    await api.updateEventSchedule(eventId, nextScheduleForApi);
  };

  const handleUpdateGame = async (
    eventId: string,
    gameId: string,
    patch: { time: string; opponent: string; score?: string; pitZone?: 'NEAR' | 'FAR'; gamePair?: 'FIRST' | 'SECOND' }
  ) => {
    let nextScheduleForApi: Array<{ time: string; opponent: string; score?: string; pitZone?: 'NEAR' | 'FAR'; gamePair?: 'FIRST' | 'SECOND' }> = [];

    const applyGamePatch = (sourceEvent: Event): Event => {
      const nextSchedule = (sourceEvent.schedule || []).map((game) =>
        game.id === gameId
          ? { ...game, time: patch.time, opponent: patch.opponent, score: patch.score, pitZone: patch.pitZone, gamePair: patch.gamePair }
          : game
      );
      nextScheduleForApi = nextSchedule.map((game) => ({
        time: game.time,
        opponent: game.opponent,
        score: game.score,
        pitZone: game.pitZone,
        gamePair: game.gamePair,
      }));
      return { ...sourceEvent, schedule: nextSchedule };
    };

    setEvents((prev) =>
      prev.map((event) => (event.id === eventId ? applyGamePatch(event) : event))
    );

    setSelectedEvent((prev) => {
      if (!prev || prev.id !== eventId) return prev;
      return applyGamePatch(prev);
    });

    await api.updateEventSchedule(eventId, nextScheduleForApi);
  };

  const handleMemberClick = (member: TeamMember) => {
    setSelectedMember(member);
  };

  const handleAttendeeClick = (
    userId: string,
    seed?: { name: string; nickname: string; avatar?: string; role?: 'CAPTAIN' | 'TRAINER' | 'PLAYER' }
  ) => {
    const fullMember = members.find((member) => member.id === userId);
    if (fullMember) {
      setSelectedMember(fullMember);
      return;
    }

    const preview = selectedEvent?.attendeePreview?.find((item) => item.userId === userId);
    const fallback = seed || (preview ? { name: preview.name, nickname: preview.nickname, avatar: preview.avatar } : undefined);
    if (!fallback) return;

    setSelectedMember({
      id: userId,
      name: fallback.name,
      nickname: fallback.nickname,
      avatar: fallback.avatar,
      role:
        fallback.role === 'CAPTAIN'
          ? Role.CAPTAIN
          : fallback.role === 'TRAINER'
            ? Role.TRAINER
            : Role.PLAYER,
      status: PlayerStatus.ACTIVE,
      balance: 0,
    });
  };

  const renderContent = () => {
    if (selectedMember) {
      return (
        <PlayerProfileView
          member={selectedMember}
          teamName={activeTeam!.name}
          onBack={() => setSelectedMember(null)}
        />
      );
    }

    if (selectedEvent) {
      return (
        <EventDetailView 
          event={selectedEvent} 
          currentUserRole={selectedEvent.viewerRole || activeTeam!.role}
          onBack={() => setSelectedEvent(null)}
          onRsvp={handleRsvp}
          onAddGame={handleAddGame}
          onUpdateGame={handleUpdateGame}
          onAttendeeClick={handleAttendeeClick}
          onSendEventReminder={handleSendEventReminder}
        />
      );
    }

    switch (currentView) {
      case 'DASHBOARD':
        return (
          <Dashboard 
            user={user!}
            activeTeam={activeTeam!}
            events={events}
            onRsvp={handleRsvp}
            onEventClick={handleEventClick}
            onEventLongPress={handleEventLongPress}
          />
        );
      case 'CALENDAR':
        return (
          <CalendarView 
            events={events} 
            onEventClick={handleEventClick}
            onEventLongPress={handleEventLongPress}
          />
        );
      case 'FINANCE':
        return (
          <FinanceView 
            team={activeTeam!}
            transactions={transactions}
            members={members}
            currentUserRole={activeTeam!.role}
            onAddTransaction={handleAddTransaction}
            onRemindDebtor={handleRemindDebtor}
            onRemindAllDebtors={handleRemindAllDebtors}
          />
        );
      case 'TEAM':
        return (
          <TeamView 
            team={activeTeam!}
            members={members}
            currentUserRole={activeTeam!.role}
            onMemberClick={handleMemberClick}
          />
        );
      case 'PROFILE':
        return (
          <ProfileView 
            user={user!}
            onUpdateUser={() => {}}
            onLogout={handleLogout}
            calendarLink={calendarLink || 'Ссылка пока недоступна'}
            onCopyLink={handleCopyIcsLink}
            onShareLink={handleShareIcsLink}
            onDownloadICS={handleDownloadIcs}
          />
        );
      case 'CREATE':
        return (
            <CreateEventView 
              onBack={() => setCurrentView('DASHBOARD')}
              onCreate={handleCreateEvent}
            />
        );
      default:
        return <div>View not found</div>;
    }
  };

  const renderAppLayout = () => {
    if (appGate === 'NO_TEAM') {
      return (
        <div className="min-h-screen bg-pb-background flex items-center justify-center text-white px-6">
          <div className="text-center max-w-sm">
            <div className="text-2xl font-bold mb-3">Вы авторизованы</div>
            <p className="text-pb-subtext mb-3">
              {user?.name ? `${user.name},` : 'Пользователь,'} вы пока не состоите ни в одной команде.
            </p>
            <p className="text-pb-subtext mb-6">
              Попросите капитана прислать инвайт-ссылку и откройте её в Telegram.
            </p>
            <button
              onClick={handleLogout}
              className="bg-pb-primary text-pb-background px-5 py-3 rounded-xl font-bold"
            >
              Выйти
            </button>
          </div>
        </div>
      );
    }

    if (appGate === 'ADMIN_MODE') {
      return (
        <div className="min-h-screen bg-pb-background flex items-center justify-center text-white px-6">
          <div className="text-center max-w-sm">
            <div className="text-xl font-bold mb-3">Активен админ-режим</div>
            <p className="text-pb-subtext mb-6">
              Мобильный интерфейс для Product Admin пока не реализован.
            </p>
            <button
              onClick={handleLogout}
              className="bg-pb-primary text-pb-background px-5 py-3 rounded-xl font-bold"
            >
              Выйти
            </button>
          </div>
        </div>
      );
    }

    if (!user || !activeTeam) {
      return (
        <div className="min-h-screen bg-pb-background flex items-center justify-center text-white px-6">
          <div className="text-center max-w-sm">
            <div className="text-xl font-bold mb-3">Данные команды недоступны</div>
            <p className="text-pb-subtext mb-6">
              Сессия активна, но профиль команды не загрузился. Попробуйте войти еще раз.
            </p>
            <button
              onClick={() => navigate('/login', { replace: true })}
              className="bg-pb-primary text-pb-background px-5 py-3 rounded-xl font-bold"
            >
              Перейти ко входу
            </button>
          </div>
        </div>
      );
    }
    
    const isAdmin = activeTeam.role === Role.ADMIN || activeTeam.role === Role.CAPTAIN;

    return (
      <div className="min-h-screen bg-pb-background bg-splatter bg-fixed bg-no-repeat bg-center bg-cover text-white font-sans selection:bg-pb-primary selection:text-pb-background">
        <div className="fixed inset-0 bg-pb-background/72 -z-10 pointer-events-none"></div>

        <main className="max-w-md mx-auto min-h-screen relative shadow-2xl shadow-black overflow-hidden flex flex-col">
          <div className="flex-1">
               {renderContent()}
          </div>
          
          {isAdmin && !selectedEvent && !selectedMember && currentView !== 'CREATE' && (
              <div className="absolute bottom-24 right-4 z-50">
                  <button 
                    onClick={() => setCurrentView('CREATE')}
                    className="w-14 h-14 bg-pb-primary rounded-full flex items-center justify-center shadow-[0_0_20px_rgba(0,230,118,0.5)] active:scale-95 transition-transform hover:bg-white text-pb-background"
                  >
                      <Plus size={32} strokeWidth={3} />
                  </button>
              </div>
          )}
        </main>

        <RSVPModal 
          event={rsvpModalEvent}
          isOpen={isRSVPModalOpen}
          onClose={() => setIsRSVPModalOpen(false)}
          onRsvp={handleRsvp}
        />

        {!selectedEvent && !selectedMember && currentView !== 'CREATE' && (
          <BottomNav 
            currentView={currentView}
            onChangeView={setCurrentView}
          />
        )}
      </div>
    );
  };

  if (isLoading) {
      return (
          <div className="min-h-screen bg-pb-background flex items-center justify-center text-white">
              <Loader2 className="animate-spin text-pb-primary" size={48} />
          </div>
      )
  }

  return (
    <Routes>
      <Route path="/" element={<LandingView />} />
      <Route path="/privacy" element={<PrivacyView />} />
      <Route path="/terms" element={<TermsView />} />
      <Route path="/support" element={<SupportView />} />
      <Route path="/invite/:inviteId" element={<InviteView />} />
      <Route path="/login" element={
        authStep === 'APP'
          ? <Navigate to="/app" replace />
          : (
            <LoginView 
              onLogin={handleLogin}
              onSelectRole={handleRoleSelect}
              availableRoles={[{ teamId: 't1', teamName: 'Headshot Gladiators', role: Role.CAPTAIN }]}
            />
          )
      } />
      <Route
        path="/app/*"
        element={
          authStep === 'APP'
            ? renderAppLayout()
            : authBootstrapDone
              ? <Navigate to="/login" replace />
              : (
                <div className="min-h-screen bg-pb-background flex items-center justify-center text-white">
                  <Loader2 className="animate-spin text-pb-primary" size={48} />
                </div>
              )
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export default App;
