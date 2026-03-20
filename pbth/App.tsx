import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { LandingView } from './views/LandingView';
import { ViewState, Role, User, Team, Event, RSVPStatus, TeamMember, TeamContext, AuthStep, UserRoleOption, Transaction, TransactionType, TransferConfirmation, PlayerStatus, Game } from './types';
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
import { AdminLoginView } from './views/admin/AdminLoginView';
import { AdminConsoleView } from './views/admin/AdminConsoleView';
import { RSVPModal } from './components/RSVPModal';
import { Plus, Loader2 } from 'lucide-react';
import {
  api,
  type FinanceEventsResponse,
  type FinanceMembersResponse,
  type FinanceMemberDetailResponse,
  type FinanceOverviewResponse,
  type NotificationDeliveryResponse,
} from './api';
import { ALL_TEAMS_FINANCE_FILTER, mergePlayerFinanceSnapshots } from './lib/finance-view-model';

type InitLoadResult = 'ok' | 'no_team' | 'admin_mode' | 'role_selection_required' | 'invalid_shape' | 'error';

const App: React.FC = () => {
  const logoutGuardKey = 'pbth:skip-auto-auth-after-logout';
  const logoutGuardCookie = 'pbth_logout_guard';
  const navigate = useNavigate();
  const [authStep, setAuthStep] = useState<AuthStep>('LOGIN');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [authBootstrapDone, setAuthBootstrapDone] = useState(false);
  const [appGate, setAppGate] = useState<'READY' | 'NO_TEAM' | 'ADMIN_MODE'>('READY');
  
  // Data State
  const [user, setUser] = useState<User | null>(null);
  const [activeTeam, setActiveTeam] = useState<Team | null>(null);
  const [teamContexts, setTeamContexts] = useState<TeamContext[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [financeSelectedTeamId, setFinanceSelectedTeamId] = useState<string>('');
  const [financeMembers, setFinanceMembers] = useState<TeamMember[]>([]);
  const [financeOverview, setFinanceOverview] = useState<FinanceOverviewResponse | null>(null);
  const [financeEvents, setFinanceEvents] = useState<FinanceEventsResponse['items']>([]);
  const [financeConfirmations, setFinanceConfirmations] = useState<TransferConfirmation[]>([]);
  const [playerFinanceDetail, setPlayerFinanceDetail] = useState<FinanceMemberDetailResponse | null>(null);
  const [calendarLink, setCalendarLink] = useState<string>('');
  const [isSwitchingTeam, setIsSwitchingTeam] = useState(false);
  
  const [currentView, setCurrentView] = useState<ViewState>('DASHBOARD');

  // Interaction State
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [isRSVPModalOpen, setIsRSVPModalOpen] = useState(false);
  const [rsvpModalEvent, setRsvpModalEvent] = useState<Event | null>(null);

  const isTelegramMiniApp = () =>
    typeof window !== 'undefined' && Boolean((window as any).Telegram?.WebApp);

  const hasLogoutGuard = () => {
    try {
      const cookieGuard =
        typeof document !== 'undefined' &&
        document.cookie
          .split(';')
          .map((part) => part.trim())
          .some((part) => part.startsWith(`${logoutGuardCookie}=1`));
      return (
        cookieGuard ||
        sessionStorage.getItem(logoutGuardKey) === '1' ||
        localStorage.getItem(logoutGuardKey) === '1'
      );
    } catch {
      return false;
    }
  };

  const clearLogoutGuard = () => {
    try {
      sessionStorage.removeItem(logoutGuardKey);
      localStorage.removeItem(logoutGuardKey);
      if (typeof document !== 'undefined') {
        document.cookie = `${logoutGuardCookie}=; Max-Age=0; Path=/; SameSite=Lax`;
        document.cookie = `${logoutGuardCookie}=; Max-Age=0; Path=/; SameSite=Lax; Secure`;
        const host = window.location.hostname;
        if (host && host.includes('.')) {
          document.cookie = `${logoutGuardCookie}=; Max-Age=0; Path=/; Domain=.${host}; SameSite=Lax`;
          document.cookie = `${logoutGuardCookie}=; Max-Age=0; Path=/; Domain=.${host}; SameSite=Lax; Secure`;
        }
      }
    } catch {
      // ignore storage errors
    }
  };

  const enableLogoutGuard = () => {
    try {
      sessionStorage.setItem(logoutGuardKey, '1');
      localStorage.setItem(logoutGuardKey, '1');
      if (typeof document !== 'undefined') {
        const secure = window.location.protocol === 'https:' ? '; Secure' : '';
        document.cookie = `${logoutGuardCookie}=1; Max-Age=1209600; Path=/; SameSite=Lax${secure}`;
      }
    } catch {
      // ignore storage errors
    }
  };

  const canUseAllTeamsFinance = (contexts: TeamContext[]) =>
    contexts.length > 1 && contexts.every((item) => item.role === Role.PLAYER);

  const normalizeFinanceSelection = (contexts: TeamContext[], activeTeamId: string, requestedSelection?: string) => {
    const allowAllTeams = canUseAllTeamsFinance(contexts);
    if (allowAllTeams && requestedSelection === ALL_TEAMS_FINANCE_FILTER) {
      return ALL_TEAMS_FINANCE_FILTER;
    }
    if (requestedSelection && contexts.some((item) => item.teamId === requestedSelection)) {
      return requestedSelection;
    }
    return allowAllTeams ? ALL_TEAMS_FINANCE_FILTER : activeTeamId;
  };

  const mapTransactionsFromOverview = (overview: FinanceOverviewResponse | null): Transaction[] =>
    Array.isArray(overview?.recentTransactions)
      ? overview.recentTransactions.map((t: any) => ({
          id: String(t.id),
          type: t.type as TransactionType,
          amount: Number(t.amount),
          title: String(t.title),
          date: new Date(t.date),
          userId: t.userId || undefined,
          userName: t.userName || undefined,
          eventId: t.eventId || undefined,
          status: (t.status as 'PENDING' | 'COMPLETED') || 'COMPLETED',
        }))
      : [];

  const mapFinanceMembers = (items: FinanceMembersResponse['items'] | undefined): TeamMember[] =>
    (items || []).map((item) => ({
      id: String(item.userId),
      name: String(item.name || ''),
      nickname: String(item.nickname || ''),
      avatar: item.avatar ? String(item.avatar) : undefined,
      role: (item.role as Role) || Role.PLAYER,
      status: (item.memberStatus as PlayerStatus) || PlayerStatus.ACTIVE,
      balance: Number(item.overpaid || 0) - Number(item.outstanding || 0),
    }));

  const loadFinanceData = async (params: {
    user: User;
    activeTeam: Team;
    teamContexts: TeamContext[];
    selection: string;
  }) => {
    const selection = normalizeFinanceSelection(params.teamContexts, params.activeTeam.id, params.selection);
    const selectedContext = params.teamContexts.find((item) => item.teamId === selection) || null;

    if (selection === ALL_TEAMS_FINANCE_FILTER) {
      const snapshots = await Promise.all(
        params.teamContexts.map(async (context) => {
          const [detail, confirmations] = await Promise.all([
            api.getFinanceMember(context.teamId, params.user.id),
            api.getFinanceConfirmations(context.teamId),
          ]);

          return {
            teamId: context.teamId,
            teamName: context.teamName,
            summary: detail.summary || {
              totalDue: 0,
              totalPaid: 0,
              outstanding: 0,
              eventsWithDebt: 0,
            },
            eventDebts: (detail.eventDebts || []).map((item) => ({
              ...item,
              teamId: context.teamId,
              teamName: context.teamName,
            })),
            confirmations: (confirmations.items || []).map((item) => ({
              ...item,
              teamName: context.teamName,
            })),
          };
        })
      );

      const merged = mergePlayerFinanceSnapshots(snapshots);
      setFinanceSelectedTeamId(selection);
      setFinanceMembers([]);
      setFinanceOverview({
        summary: {
          totalOutstanding: merged.summary.outstanding,
          overdueCount: merged.summary.eventsWithDebt,
          pendingConfirmations: merged.summary.pendingConfirmations,
        },
        recentTransactions: [],
        topDebtors: [],
      });
      setFinanceEvents([]);
      setFinanceConfirmations(merged.confirmations as TransferConfirmation[]);
      setPlayerFinanceDetail({
        summary: {
          totalDue: merged.summary.totalDue,
          totalPaid: merged.summary.totalPaid,
          outstanding: merged.summary.outstanding,
          eventsWithDebt: merged.summary.eventsWithDebt,
        },
        eventDebts: merged.eventDebts,
        payments: [],
      });
      setTransactions([]);
      return;
    }

    if (!selectedContext) {
      throw new Error('Selected finance team is not available');
    }

    if (selectedContext.role === Role.CAPTAIN || selectedContext.role === Role.ADMIN || selectedContext.role === Role.TRAINER) {
      const [overview, financeMembersResult, confirmations, eventsResult] = await Promise.all([
        api.getFinanceOverview(selectedContext.teamId),
        api.getFinanceMembers(selectedContext.teamId),
        api.getFinanceConfirmations(selectedContext.teamId),
        api.getFinanceEvents(selectedContext.teamId),
      ]);

      setFinanceSelectedTeamId(selection);
      setFinanceOverview(overview);
      setFinanceMembers(mapFinanceMembers(financeMembersResult.items));
      setFinanceConfirmations((confirmations.items || []).map((item) => ({ ...item, teamName: selectedContext.teamName })));
      setFinanceEvents(eventsResult.items || []);
      setPlayerFinanceDetail(null);
      setTransactions(mapTransactionsFromOverview(overview));
      return;
    }

    const [overview, detail, confirmations] = await Promise.all([
      api.getFinanceOverview(selectedContext.teamId),
      api.getFinanceMember(selectedContext.teamId, params.user.id),
      api.getFinanceConfirmations(selectedContext.teamId),
    ]);

    setFinanceSelectedTeamId(selection);
    setFinanceOverview(overview);
    setFinanceMembers([]);
    setFinanceEvents([]);
    setFinanceConfirmations((confirmations.items || []).map((item) => ({ ...item, teamName: selectedContext.teamName })));
    setPlayerFinanceDetail({
      ...detail,
      eventDebts: (detail.eventDebts || []).map((item) => ({
        ...item,
        teamId: selectedContext.teamId,
        teamName: selectedContext.teamName,
      })),
    });
    setTransactions(mapTransactionsFromOverview(overview));
  };

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
        setTeamContexts(Array.isArray(data.teams) ? data.teams : []);
        setEvents(data.events || []);
        setMembers(data.members || []);
        setFinanceOverview(null);
        setFinanceMembers([]);
        setFinanceEvents([]);
        setFinanceConfirmations([]);
        setPlayerFinanceDetail(null);

        try {
          const nextSelection = normalizeFinanceSelection(
            Array.isArray(data.teams) ? data.teams : [],
            data.team.id,
            financeSelectedTeamId
          );
          await loadFinanceData({
            user: data.user,
            activeTeam: data.team,
            teamContexts: Array.isArray(data.teams) ? data.teams : [],
            selection: nextSelection,
          });
        } catch (financeErr) {
          console.warn('Finance bootstrap fallback to init payload', financeErr);
          setFinanceOverview(null);
          setFinanceMembers([]);
          setFinanceEvents([]);
          setFinanceConfirmations([]);
          setPlayerFinanceDetail(null);
          setTransactions(data.transactions || []);
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
          } else if (message.includes('ROLE_SELECTION_REQUIRED')) {
            return 'role_selection_required';
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
          if (message.includes('ROLE_SELECTION_REQUIRED')) {
            return 'role_selection_required';
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
      const me = await api.getAuthMe();
      if (!me?.authenticated) return false;

      const shouldSwitchToUser =
        me?.roleSelectionRequired ||
        (result === 'admin_mode' && me.canChooseAdminRole && me.accountRole === 'ADMIN');

      if (shouldSwitchToUser) {
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

    return false;
  };

  const handleSwitchToUserMode = async () => {
    try {
      await api.selectAccountRole('USER');
      setAppGate('READY');
      const ok = await tryEnterUserApp();
      if (ok) {
        setAuthStep('APP');
        navigate('/app', { replace: true });
      } else {
        navigate('/login', { replace: true });
      }
    } catch (error) {
      console.error('Failed to switch to USER mode', error);
      navigate('/login', { replace: true });
    }
  };

  const handleSwitchTeamContext = async (membershipId: string) => {
    const nextContext = teamContexts.find((item) => item.membershipId === membershipId);
    if (!nextContext || nextContext.teamId === activeTeam?.id) return;

    setIsSwitchingTeam(true);
    try {
      await api.switchTeamContext(membershipId);
      await loadData({ silent: true });
    } catch (error) {
      console.error('Failed to switch team context', error);
      alert(`Не удалось переключить команду: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      setIsSwitchingTeam(false);
    }
  };

  const handleSwitchFinanceTeam = async (teamId: string) => {
    if (!activeTeam || !user) return;

    setIsSwitchingTeam(true);
    try {
      await loadFinanceData({
        user,
        activeTeam,
        teamContexts,
        selection: teamId,
      });
    } catch (error) {
      console.error('Failed to switch finance team', error);
      alert(`Не удалось переключить финансовый фильтр: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      setIsSwitchingTeam(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const restoreSession = async () => {
      try {
        if (hasLogoutGuard()) {
          setAuthStep('LOGIN');
          return;
        }

        let payload = await api.getAuthMe();

        if (!payload?.authenticated && isTelegramMiniApp()) {
          const initData = String((window as any).Telegram?.WebApp?.initData || '').trim();
          if (initData) {
            try {
              await api.authTelegramWebApp(initData);
              payload = await api.getAuthMe();
            } catch (err) {
              console.warn('Telegram Mini App auto-auth failed', err);
            }
          }
        }

        if (!payload?.authenticated || cancelled) return;
        clearLogoutGuard();

        if (payload?.user) {
          setUser((prev) => {
            if (prev?.id === payload.user.id) return prev;
            return {
              id: String(payload.user.id),
              name: String(payload.user.name || ''),
              nickname: String(payload.user.nickname || ''),
              telegramUsername: payload.user.telegramUsername
                ? String(payload.user.telegramUsername)
                : undefined,
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
    clearLogoutGuard();
    sessionStorage.removeItem('pbth:tg-webapp-fallback-direct');
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

  const handleLogout = async () => {
    setIsLoggingOut(true);
    const redirectTo = '/login';

    // Apply local guard first to prevent immediate auto re-login after app reopen.
    sessionStorage.removeItem('pbth:post-auth-app');
    sessionStorage.removeItem('pbth:tg-webapp-fallback-direct');
    enableLogoutGuard();

    setAuthStep('LOGIN');
    setAppGate('READY');
    setAuthBootstrapDone(true);
    setCurrentView('DASHBOARD');
    setUser(null);
    setActiveTeam(null);
    setTeamContexts([]);
    setEvents([]);
    setMembers([]);
    setTransactions([]);
    setFinanceOverview(null);
    setFinanceEvents([]);
    setFinanceConfirmations([]);
    setPlayerFinanceDetail(null);
    setSelectedMember(null);
    setSelectedEvent(null);
    setCalendarLink('');
    navigate(redirectTo, { replace: true });

    void fetch('/api/v1/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      keepalive: true,
    }).catch((error) => {
      console.error('Failed to terminate server session', error);
    });

    setIsLoggingOut(false);
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
    if (!activeTeam) return;
    if (financeSelectedTeamId === ALL_TEAMS_FINANCE_FILTER) {
      alert('Для напоминания выберите конкретную команду в фильтре Казны.');
      return;
    }
    try {
      const result = await api.remindFinanceMemberDebt({
        userId,
        teamId: financeSelectedTeamId || activeTeam.id,
      });
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
    if (!activeTeam) return;
    if (financeSelectedTeamId === ALL_TEAMS_FINANCE_FILTER) {
      alert('Для массового напоминания выберите конкретную команду в фильтре Казны.');
      return;
    }
    try {
      const result = await api.remindFinanceDebtors({
        teamId: financeSelectedTeamId || activeTeam.id,
      });
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
    if (financeSelectedTeamId === ALL_TEAMS_FINANCE_FILTER) {
      alert('Для финансового действия выберите конкретную команду в фильтре Казны.');
      return;
    }
    const teamId =
      financeSelectedTeamId && financeSelectedTeamId !== ALL_TEAMS_FINANCE_FILTER
        ? financeSelectedTeamId
        : activeTeam.id;
    const newTx: Transaction = {
        id: `tx${Date.now()}`,
        teamId,
        date: new Date(),
        ...t
    };
    
    // Optimistic Update
    setTransactions(prev => [newTx, ...prev]);
    if (t.type === TransactionType.EXPENSE && activeTeam && teamId === activeTeam.id) {
        setActiveTeam(prev => prev ? ({ ...prev, budget: prev.budget - t.amount }) : null);
    } else if (t.type === TransactionType.DEPOSIT && activeTeam && teamId === activeTeam.id) {
        setActiveTeam(prev => prev ? ({ ...prev, budget: prev.budget + t.amount }) : null);
    }

    // Server Call
    if (t.type === TransactionType.DEPOSIT) {
      await api.createFinancePayment({
        teamId,
        amount: t.amount,
        title: t.title,
        payerUserId: t.userId,
        status: t.status,
      });
      await loadData({ silent: true });
      return;
    }
    await api.addTransaction(newTx);
    await loadData({ silent: true });
  };

  const handleCreateTransferConfirmation = async (payload: {
    userId?: string;
    amount: number;
    screenshotDataUrl: string;
    note?: string;
    autoApprove?: boolean;
    preferredEventId?: string;
  }) => {
    if (!activeTeam) return;
    if (financeSelectedTeamId === ALL_TEAMS_FINANCE_FILTER) {
      alert('Для подтверждения перевода выберите конкретную команду в фильтре Казны.');
      return;
    }
    const teamId = financeSelectedTeamId || activeTeam.id;

    const created = await api.createTransferConfirmation({
      teamId,
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

    await loadData({ silent: true });
  };

  const handleReviewTransferConfirmation = async (
    confirmationId: string,
    decision: 'APPROVE' | 'REJECT',
    reviewNote?: string
  ) => {
    await api.reviewTransferConfirmation({
      confirmationId,
      decision,
      reviewNote,
    });
    await loadData({ silent: true });
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

  const handleUpdateMemberStatus = async (member: TeamMember, status: PlayerStatus) => {
    if (!activeTeam) return;
    if (!member.membershipId) {
      alert('Не удалось определить membershipId участника');
      return;
    }

    await api.updateTeamMembership(activeTeam.id, member.membershipId, { status });
    setMembers((prev) =>
      prev.map((item) => (item.id === member.id ? { ...item, status } : item))
    );
    setSelectedMember((prev) => (prev && prev.id === member.id ? { ...prev, status } : prev));
  };

  const handleRemoveMember = async (member: TeamMember) => {
    if (!activeTeam || !user) return;
    if (!member.membershipId) {
      alert('Не удалось определить membershipId участника');
      return;
    }
    if (member.id === user.id) {
      alert('Нельзя исключить самого себя из команды через этот экран.');
      return;
    }

    await api.removeTeamMembership(activeTeam.id, member.membershipId);
    setMembers((prev) => prev.filter((item) => item.id !== member.id));
    setSelectedMember((prev) => (prev && prev.id === member.id ? null : prev));
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
      const canManageMembers = activeTeam!.role === Role.ADMIN || activeTeam!.role === Role.CAPTAIN;
      return (
        <PlayerProfileView
          member={selectedMember}
          teamName={activeTeam!.name}
          onBack={() => setSelectedMember(null)}
          canManage={canManageMembers}
          onUpdateMemberStatus={handleUpdateMemberStatus}
          onRemoveMember={handleRemoveMember}
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
            selectedTeamId={financeSelectedTeamId || activeTeam!.id}
            selectedTeamName={
              financeSelectedTeamId === ALL_TEAMS_FINANCE_FILTER
                ? 'Все команды'
                : teamContexts.find((item) => item.teamId === (financeSelectedTeamId || activeTeam!.id))?.teamName || activeTeam!.name
            }
            allowAllTeamsFilter={canUseAllTeamsFinance(teamContexts)}
            currentUser={user!}
            availableTeams={teamContexts}
            transactions={transactions}
            members={financeMembers}
            currentUserRole={
              financeSelectedTeamId === ALL_TEAMS_FINANCE_FILTER
                ? Role.PLAYER
                : teamContexts.find((item) => item.teamId === (financeSelectedTeamId || activeTeam!.id))?.role || activeTeam!.role
            }
            financeOverview={financeOverview}
            financeEvents={financeEvents || []}
            financeConfirmations={financeConfirmations}
            playerFinanceDetail={playerFinanceDetail}
            isSwitchingTeam={isSwitchingTeam}
            onSwitchTeam={handleSwitchFinanceTeam}
            onAddTransaction={handleAddTransaction}
            onRemindDebtor={handleRemindDebtor}
            onRemindAllDebtors={handleRemindAllDebtors}
            onCreateTransferConfirmation={handleCreateTransferConfirmation}
            onReviewTransferConfirmation={handleReviewTransferConfirmation}
          />
        );
      case 'TEAM':
        return (
          <TeamView 
            team={activeTeam!}
            members={members}
            currentUserRole={activeTeam!.role}
            onMemberClick={handleMemberClick}
            onUpdateMemberStatus={handleUpdateMemberStatus}
            onRemoveMember={handleRemoveMember}
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
              onClick={() => {
                void handleLogout();
              }}
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
            <div className="flex flex-col gap-3">
              <button
                onClick={() => navigate('/admin/login', { replace: true })}
                className="bg-pb-primary text-pb-background px-5 py-3 rounded-xl font-bold"
              >
                Перейти в админку
              </button>
              <button
                onClick={() => {
                  void handleSwitchToUserMode();
                }}
                className="bg-white/10 text-white px-5 py-3 rounded-xl font-bold"
              >
                Переключиться в режим USER
              </button>
              <button
                onClick={() => {
                  void handleLogout();
                }}
                className="bg-white/10 text-white px-5 py-3 rounded-xl font-bold"
              >
                Выйти
              </button>
            </div>
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

  if (isLoading || isLoggingOut) {
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
      <Route path="/admin/login" element={<AdminLoginView />} />
      <Route path="/admin/*" element={<AdminConsoleView />} />
      <Route path="/login" element={
        authStep === 'APP'
          ? <Navigate to="/app" replace />
          : (
            <LoginView 
              onLogin={handleLogin}
              onSelectRole={handleRoleSelect}
              availableRoles={[]}
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
