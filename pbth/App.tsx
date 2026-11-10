import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Role, User, Team, Event, RSVPStatus, TeamMember, AuthStep, Transaction, TransactionType, PlayerStatus, Game, TeamContext } from './types';
import { RSVPModal } from './components/RSVPModal';
import { NotifyHost } from './components/shell/NotifyHost';
import { ScreenLoader } from './components/shell/ScreenLoader';
import { api, setRequestTeam, type NotificationDeliveryResponse } from './api';
import { isOfflineError } from './lib/offline';
import { subscribeOutbox } from './lib/outbox';
import { confirmAction, errorText, notify } from './lib/notify';
import { clearDeviceData } from './lib/local-data';
import { resolvePostLoginAction } from './lib/post-login';
import { parseTeamPath, readLastTeam, rememberLastTeam, switchTeamPath, teamCodeOf, teamPath } from './lib/team-url';
import { ShellContext, type ShellState, type TeamLoadState, type EventReminderPayload, type EventEditPatch, type GamePatch } from './shell/context';
import { ErrorBoundary } from './shell/ErrorBoundary';
import { decideInitTeam } from './shell/team-switch';
import { readMiniAppInitData } from './shell/telegram';
import { AppRoutes } from './routes';

// Корень приложения: вход, загрузка данных команды и действия. Экраны и адреса —
// в pbth/routes.tsx, оболочка — в pbth/shell/. Команда живёт в адресе
// (`/t/:team/*`), а не в состоянии: «Назад», перезагрузка и ссылка на экран
// работают как у обычного сайта.

type InitLoadResult =
  | 'ok'
  | 'no_team'
  | 'admin_mode'
  | 'role_selection_required'
  | 'invalid_shape'
  | 'forbidden'
  | 'offline_other_team'
  | 'stale'
  | 'error';

type LoadOptions = {
  /** Команда из адреса. undefined — та, что нужна оболочке сейчас; '' / null — какую отдаст сервер. */
  team?: string | null;
  silent?: boolean;
  background?: boolean;
  skipAncillary?: boolean;
};

type ScheduleItemPayload = {
  id?: string;
  time: string;
  opponent: string;
  score?: string;
  pitZone?: 'NEAR' | 'FAR';
  gamePair?: 'FIRST' | 'SECOND';
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PATCH расписания обновляет игры по id, а не пересоздаёт их: на игре висят
// рефлексии (#89). Локальные id старого формата (`g-<timestamp>`) сервер не
// примет — для них id не отправляем, игра заведётся заново.
const toScheduleItemPayload = (game: Game): ScheduleItemPayload => ({
  id: UUID_RE.test(game.id) ? game.id : undefined,
  time: game.time,
  opponent: game.opponent,
  score: game.score,
  pitZone: game.pitZone,
  gamePair: game.gamePair,
});

const RESUME_FRESH_MS = 10_000;
const LOGOUT_REQUEST_MS = 3_000;

const loadResultIsEntered = (result: InitLoadResult) =>
  result === 'ok' || result === 'no_team' || result === 'forbidden' || result === 'offline_other_team';

const App: React.FC = () => {
  const logoutGuardKey = 'pbth:skip-auto-auth-after-logout';
  const logoutGuardCookie = 'pbth_logout_guard';
  const navigate = useNavigate();
  // navigate меняется при каждой смене адреса; эффекты держат ссылку, а не зависимость.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const [authStep, setAuthStep] = useState<AuthStep>('LOGIN');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [authBootstrapDone, setAuthBootstrapDone] = useState(false);
  const [appGate, setAppGate] = useState<'READY' | 'NO_TEAM' | 'ADMIN_MODE'>('READY');
  const [onboardingRequired, setOnboardingRequired] = useState(false);
  // Момент снятия снимка, из которого поднялось приложение. null — данные
  // свежие. Показывается человеку: состав недельной давности легко принять за
  // сегодняшний, и это хуже, чем отсутствие данных.
  const [offlineSnapshotAt, setOfflineSnapshotAt] = useState<number | null>(null);
  const [outboxState, setOutboxState] = useState<{ pending: number; blocked: number }>({ pending: 0, blocked: 0 });
  // Владелец из списка допуска: плитка «Платформа админа» в профиле.
  const [canEnterAdmin, setCanEnterAdmin] = useState(false);

  // Data State
  const [user, setUser] = useState<User | null>(null);
  const [activeTeam, setActiveTeam] = useState<Team | null>(null);
  const [teamCode, setTeamCode] = useState<string | null>(null);
  const [teamLoad, setTeamLoad] = useState<TeamLoadState>('idle');
  const [teams, setTeams] = useState<TeamContext[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [calendarLink, setCalendarLink] = useState<string>('');

  const [isRSVPModalOpen, setIsRSVPModalOpen] = useState(false);
  const [rsvpModalEvent, setRsvpModalEvent] = useState<Event | null>(null);
  const resumeRefreshRef = useRef({ inFlight: false, lastStartedAt: 0 });
  // Когда данные последний раз пришли с сервера: возврат в приложение сразу
  // после загрузки (браузер присылает focus/pageshow при открытии) не должен
  // грузить всё второй раз.
  const lastLoadedAtRef = useRef(0);

  // Какую команду хочет видеть оболочка (из адреса) и какая загружена.
  const desiredTeamRef = useRef<string>('');
  const loadedCodeRef = useRef<string | null>(null);
  const inflightCodeRef = useRef<string | null>(null);
  // Загрузки идут по одной: переключение сессии на старом сервере — побочный
  // эффект, и две загрузки вперемешку перебивали бы друг другу команду.
  const loadChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const loadSeqRef = useRef(0);

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

  const applyInit = (data: Record<string, any>) => {
    const code = teamCodeOf({ teamId: String(data.team.id), shortCode: data.team.shortCode });
    loadedCodeRef.current = code;
    setUser(data.user);
    setActiveTeam(data.team);
    setTeamCode(code);
    setTeams(data.teams || []);
    setEvents(data.events || []);
    setMembers(data.members || []);
    setTransactions(data.transactions || []);
    setOfflineSnapshotAt(typeof data.offlineSnapshotAt === 'number' ? data.offlineSnapshotAt : null);
    setRequestTeam(String(data.team.id));
    rememberLastTeam(code);
    if (typeof data.offlineSnapshotAt !== 'number') lastLoadedAtRef.current = Date.now();
    return code;
  };

  // Финансы и календарь — второй слой: не нужны для входа и без сети не
  // поднимаются. Игроку финансы закрыты — не спрашиваем, чтобы не получать
  // два отказа на каждом запуске.
  const loadAncillary = async (team: Team, code: string) => {
    if (team.role !== Role.PLAYER) {
      try {
        const [financeOverview, financeMembers] = await Promise.all([
          api.getFinanceOverview(team.id),
          api.getFinanceMembers(team.id),
        ]);
        if (loadedCodeRef.current !== code) return;

        const financeBalance = financeOverview?.summary?.balance;
        if (financeBalance !== undefined) {
          setActiveTeam((prev) => (prev && prev.id === team.id ? { ...prev, budget: Number(financeBalance) } : prev));
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
    }

    try {
      const ics = await api.getIcs(team.id);
      if (loadedCodeRef.current !== code) return;
      setCalendarLink(ics.subscriptionUrl || ics.url);
    } catch (icsErr) {
      console.warn('ICS bootstrap failed', icsErr);
      if (loadedCodeRef.current === code) setCalendarLink('');
    }
  };

  // background — обновление поверх уже показанного экрана. Такое обновление не
  // имеет права поднимать загрузочный спиннер: на турнире связь то есть, то
  // нет, и приложение мигало бы пустым экраном поверх живых данных.
  const loadDataInner = async (options: LoadOptions, seq: number): Promise<InitLoadResult> => {
    if (seq !== loadSeqRef.current) return 'stale';
    const requested = (options.team === undefined ? desiredTeamRef.current : options.team) || '';
    if (!options.background) setIsLoading(true);
    try {
      let data = await api.getInitData(requested || null);

      if (data?.noTeamYet) throw new Error('INIT_NO_TEAM');
      if (data?.admin) throw new Error('INIT_ADMIN_MODE');
      if (!data?.user || !data?.team) throw new Error('INIT_INVALID_SHAPE');

      const isSnapshot = typeof data.offlineSnapshotAt === 'number';
      let result: InitLoadResult = 'ok';
      if (requested) {
        const decision = decideInitTeam(requested, data as any);
        if (decision.kind === 'switch' && !isSnapshot) {
          // Старый сервер не знает `?team=`: переключаем сессию и читаем заново.
          await api.switchTeamContext(decision.membershipId);
          data = await api.getInitData(requested);
          if (!data?.user || !data?.team || decideInitTeam(requested, data as any).kind !== 'match') {
            throw new Error('INIT_TEAM_MISMATCH');
          }
        } else if (decision.kind === 'switch' && isSnapshot) {
          result = 'offline_other_team';
        } else if (decision.kind === 'forbidden') {
          result = 'forbidden';
        }
      }

      if (seq !== loadSeqRef.current) return 'stale';

      // Чужая команда в адресе: данные своей команды нужны, только если ещё
      // ничего не загружено — для кнопки «Открыть мою команду».
      if (result === 'forbidden' && loadedCodeRef.current) {
        setTeamLoad('forbidden');
        return result;
      }

      const code = applyInit(data);
      setAppGate('READY');
      setTeamLoad(result === 'forbidden' ? 'forbidden' : 'ready');

      // Финансы и календарь без сети не поднять, и они не нужны для входа —
      // приложение обязано открыться и на турнире, где есть только снимок.
      // Возврат в приложение тоже их не трогает: обновляем только расписание.
      if (!isSnapshot && !options.skipAncillary) {
        await loadAncillary(data.team as Team, code);
      }
      return result;
    } catch (e) {
      if (seq !== loadSeqRef.current) return 'stale';
      console.error('Error loading data', e);
      const message = e instanceof Error ? e.message : '';
      // Сети нет и снимка тоже нет — показывать «проверьте авторизацию»
      // вредно: человек пойдёт перелогиниваться, а логин без сети тем более
      // не работает.
      if (isOfflineError(e)) {
        if (!options.silent) {
          notify.error('Нет сети, а сохранённых данных на этом устройстве ещё нет. Открой приложение один раз при интернете — дальше оно будет работать и без него.');
        }
        setTeamLoad('error');
        return 'error';
      }
      if (message.includes('INIT_NO_TEAM')) {
        setAppGate('NO_TEAM');
        setTeamLoad('ready');
        return 'no_team';
      }
      if (message.includes('INIT_ADMIN_MODE')) {
        setAppGate('ADMIN_MODE');
        setTeamLoad('ready');
        return 'admin_mode';
      }
      if (message.includes('ROLE_SELECTION_REQUIRED')) {
        return 'role_selection_required';
      }
      if (!options.silent) {
        notify.error('Не удалось открыть приложение после входа. Попробуй войти ещё раз.');
      }
      setTeamLoad('error');
      return message.includes('INIT_INVALID_SHAPE') ? 'invalid_shape' : 'error';
    } finally {
      if (!options.background) setIsLoading(false);
    }
  };

  const loadData = (options: LoadOptions = {}): Promise<InitLoadResult> => {
    const seq = ++loadSeqRef.current;
    const run = loadChainRef.current.then(() => loadDataInner(options, seq));
    loadChainRef.current = run.catch(() => undefined);
    return run;
  };
  const loadDataRef = useRef(loadData);
  loadDataRef.current = loadData;

  const tryEnterUserApp = async (options?: LoadOptions) => {
    const result = await loadData(options);
    if (loadResultIsEntered(result)) return true;

    try {
      const me = await api.getAuthMe();
      if (!me?.authenticated) return false;

      const shouldSwitchToUser =
        me?.roleSelectionRequired ||
        (result === 'admin_mode' && me.canChooseAdminRole && me.accountRole === 'ADMIN');

      if (shouldSwitchToUser) {
        await api.selectAccountRole('USER');
        const retry = await loadData(options);
        return loadResultIsEntered(retry);
      }
    } catch (error) {
      console.error('Failed to switch account role to USER', error);
    }

    return false;
  };

  /** Загрузить команду из адреса. Вызывает оболочка при смене `:team`. */
  const ensureTeam = useCallback((code: string) => {
    const wanted = String(code || '').toLowerCase();
    if (!wanted) {
      // «Любая команда» (вход /app, профиль): что-то уже загружено — хватит.
      if (loadedCodeRef.current || inflightCodeRef.current !== null) return;
    } else {
      desiredTeamRef.current = wanted;
      if (loadedCodeRef.current === wanted || inflightCodeRef.current === wanted) return;
    }
    if (!wanted) desiredTeamRef.current = readLastTeam() || '';
    const target = wanted || desiredTeamRef.current;
    inflightCodeRef.current = target;
    setTeamLoad('loading');
    void loadDataRef.current({ team: target, background: true, silent: true }).then((result) => {
      if (inflightCodeRef.current === target) inflightCodeRef.current = null;
      if (result === 'offline_other_team' && loadedCodeRef.current) {
        // Без сети другую команду не загрузить: открываем ту, что в снимке.
        notify.info('Нет сети — открыта команда из сохранённых данных.');
        desiredTeamRef.current = loadedCodeRef.current;
        navigateRef.current(switchTeamPath(window.location.pathname, loadedCodeRef.current), { replace: true });
      }
    });
  }, []);

  const reload = useCallback(async () => {
    await loadDataRef.current({ silent: true, background: true });
  }, []);

  const handleSwitchToUserMode = async () => {
    try {
      await api.selectAccountRole('USER');
      setAppGate('READY');
      const ok = await tryEnterUserApp({ team: readLastTeam() });
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

  // Восстановление сессии — один раз при запуске. Раньше эффект зависел от
  // navigate, перезапускался при каждой смене адреса и грузил всё дважды.
  useEffect(() => {
    let cancelled = false;

    const restoreSession = async () => {
      try {
        if (hasLogoutGuard()) {
          setAuthStep('LOGIN');
          return;
        }

        let payload = await api.getAuthMe();

        // Mini App — по данным запуска, а не по наличию скрипта Telegram.
        const initData = readMiniAppInitData();
        if (!payload?.authenticated && initData) {
          try {
            await api.authTelegramWebApp(initData);
            payload = await api.getAuthMe();
          } catch (err) {
            console.warn('Telegram Mini App auto-auth failed', err);
          }
        }

        if (!payload?.authenticated || cancelled) return;
        clearLogoutGuard();
        setOnboardingRequired(Boolean(payload.onboardingRequired));
        // Плитка «Платформа админа»: и допуск, и доверенный способ входа.
        setCanEnterAdmin(Boolean(payload.canChooseAdminRole) && payload.adminScope !== 'NONE');

        if (payload?.user) {
          setUser((prev) => {
            if (prev?.id === payload.user.id) return prev;
            return {
              id: String(payload.user.id),
              name: String(payload.user.name || ''),
              nickname: String(payload.user.nickname || ''),
              telegramUsername: payload.user.telegramUsername ? String(payload.user.telegramUsername) : undefined,
              avatar: payload.user.avatar ? String(payload.user.avatar) : undefined,
            };
          });
        }

        const currentPath = window.location.pathname;
        // /admin и /invite ведут свой вход сами: загрузка приложения команды
        // переключила бы владельца в режим USER (см. tryEnterUserApp).
        if (currentPath.startsWith('/admin') || currentPath.startsWith('/invite/')) {
          setAuthStep('APP');
          sessionStorage.removeItem('pbth:post-auth-app');
          return;
        }

        // Одна загрузка сразу нужной команды: из адреса или последней на устройстве.
        const team = parseTeamPath(currentPath)?.team ?? readLastTeam() ?? '';
        desiredTeamRef.current = team;
        const ok = await tryEnterUserApp({ silent: true, team });
        if (cancelled) return;
        if (!ok) {
          setAuthStep('LOGIN');
          return;
        }

        setAuthStep('APP');
        sessionStorage.removeItem('pbth:post-auth-app');
        // С главной страницы вошедшего ведём в приложение. Остальные адреса
        // (экран команды, /support, /privacy, /terms) открываются как есть.
        if (currentPath === '/') {
          navigateRef.current('/app', { replace: true });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Отложенное уходит при возврате связи и на старте: телефон в поле чаще
  // ловит сеть в кармане, чем в руках у владельца, поэтому ждать открытия
  // нужного экрана нельзя. Следом, если приложение поднялось из снимка,
  // перезагружаем данные — иначе плашка «офлайн» висела бы поверх уже живой
  // сети до ручного обновления страницы.
  useEffect(() => {
    const unsubscribe = subscribeOutbox(setOutboxState);
    const sync = async () => {
      await api.flushOfflineQueue();
      if (offlineSnapshotAt !== null) await loadData({ silent: true, background: true });
    };
    void sync();
    const onOnline = () => { void sync(); };
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('online', onOnline);
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offlineSnapshotAt]);

  // Турнирное расписание публикуют и правят, пока приложение уже открыто у
  // игроков. На возврате из Telegram/другого приложения обновляем /init.
  // Throttle склеивает пачку focus + pageshow + visibilitychange, которую
  // мобильные браузеры присылают почти одновременно.
  useEffect(() => {
    if (authStep !== 'APP') return;

    const refresh = async () => {
      if (document.visibilityState === 'hidden' || navigator.onLine === false) return;
      if (!loadedCodeRef.current || inflightCodeRef.current !== null) return;
      if (Date.now() - lastLoadedAtRef.current < RESUME_FRESH_MS) return;
      const state = resumeRefreshRef.current;
      if (state.inFlight || Date.now() - state.lastStartedAt < 2_000) return;
      state.inFlight = true;
      state.lastStartedAt = Date.now();
      try {
        await loadDataRef.current({ silent: true, background: true, skipAncillary: true });
      } finally {
        state.inFlight = false;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const onResume = () => { void refresh(); };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onResume);
    window.addEventListener('pageshow', onResume);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onResume);
      window.removeEventListener('pageshow', onResume);
    };
  }, [authStep]);

  // --- AUTH HANDLERS ---
  // target — куда человек шёл до входа (`?next=` экрана входа).
  const handleLogin = async (target?: string) => {
    clearLogoutGuard();
    sessionStorage.removeItem('pbth:tg-webapp-fallback-direct');
    const action = resolvePostLoginAction(target);
    if (action.kind === 'invite') {
      // Новичок по приглашению ещё не в команде. Грузить приложение сейчас
      // нельзя: /init ответит «нет команды». Ведём на приглашение — уже
      // вошедшим; приложение команды загрузит joinedTeam после «Принять».
      sessionStorage.removeItem('pbth:post-auth-app');
      navigate(action.path, { replace: true });
      return;
    }
    const path = action.kind === 'app' ? action.path : '/app';
    const team = parseTeamPath(path)?.team ?? readLastTeam() ?? '';
    desiredTeamRef.current = team;
    const ok = await tryEnterUserApp({ team });
    if (ok) {
      sessionStorage.removeItem('pbth:post-auth-app');
      setAuthStep('APP');
      setAuthBootstrapDone(true);
      navigate(path, { replace: true });
    }
  };

  // Человек только что вступил в команду по приглашению: сервер уже сделал её
  // активной в сессии, так что /init без команды вернёт именно её.
  const handleJoinedTeam = async () => {
    clearLogoutGuard();
    sessionStorage.removeItem('pbth:post-auth-app');
    setAppGate('READY');
    desiredTeamRef.current = '';
    loadedCodeRef.current = null;
    const ok = await tryEnterUserApp({ team: null });
    if (ok) {
      setAuthStep('APP');
      setAuthBootstrapDone(true);
      const code = loadedCodeRef.current;
      if (code) desiredTeamRef.current = code;
      navigate(code ? teamPath(code) : '/app', { replace: true });
    }
  };

  const resetSessionState = () => {
    setAuthStep('LOGIN');
    setAppGate('READY');
    setAuthBootstrapDone(true);
    setUser(null);
    setActiveTeam(null);
    setTeamCode(null);
    setTeamLoad('idle');
    setTeams([]);
    setEvents([]);
    setMembers([]);
    setTransactions([]);
    setCalendarLink('');
    setOnboardingRequired(false);
    setOfflineSnapshotAt(null);
    setCanEnterAdmin(false);
    desiredTeamRef.current = '';
    loadedCodeRef.current = null;
    inflightCodeRef.current = null;
    loadSeqRef.current += 1;
    setRequestTeam(null);
  };

  const handleLogout = async () => {
    if (outboxState.pending + outboxState.blocked > 0) {
      const total = outboxState.pending + outboxState.blocked;
      const ok = await confirmAction(
        `На этом устройстве есть неотправленные записи: ${total}. После выхода они пропадут. Выйти?`,
        { confirmLabel: 'Выйти', danger: true },
      );
      if (!ok) return;
    }
    setIsLoggingOut(true);

    // Apply local guard first to prevent immediate auto re-login after app reopen.
    sessionStorage.removeItem('pbth:post-auth-app');
    sessionStorage.removeItem('pbth:tg-webapp-fallback-direct');
    enableLogoutGuard();

    resetSessionState();

    // Сначала закрываем сессию на сервере (не дольше пары секунд — без сети
    // выход всё равно должен случиться), потом чистим устройство: иначе экран
    // входа успевал спросить сервер «кто я», получить ещё живую сессию и
    // снова сохранить её снимок.
    const logoutRequest = fetch('/api/v1/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      keepalive: true,
    }).catch((error) => {
      console.error('Failed to terminate server session', error);
    });
    await Promise.race([logoutRequest, new Promise((resolve) => setTimeout(resolve, LOGOUT_REQUEST_MS))]);

    // Снимки и очередь отправки принадлежат вышедшему человеку: следующий
    // вошедший на этом телефоне не должен их видеть и отправлять.
    try {
      await clearDeviceData();
    } catch (error) {
      console.error('Failed to clear device data', error);
    }
    navigate('/login', { replace: true });
    setIsLoggingOut(false);
  };

  const handleCopyIcsLink = async () => {
    if (!calendarLink) {
      notify.error('Ссылка календаря недоступна. Обнови страницу.');
      return;
    }
    try {
      await navigator.clipboard.writeText(calendarLink);
      notify.success('Ссылка скопирована');
    } catch (err) {
      console.error('Failed to copy ICS link', err);
      notify.error('Не удалось скопировать ссылку');
    }
  };

  const handleShareIcsLink = async () => {
    if (!calendarLink) {
      notify.error('Ссылка календаря недоступна. Обнови страницу.');
      return;
    }
    try {
      if ((navigator as any).share) {
        await (navigator as any).share({ url: calendarLink, title: 'Календарь команды' });
      } else {
        await navigator.clipboard.writeText(calendarLink);
        notify.success('Ссылка скопирована');
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
      notify.error('Не удалось скачать файл календаря');
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

  const deliverySummary = (summary: ReturnType<typeof parseReminderResult>) =>
    [
      `Отправлено: ${summary.sent}`,
      summary.queued ? `В очереди: ${summary.queued}` : '',
      summary.skippedNoTelegram ? `Без Telegram: ${summary.skippedNoTelegram}` : '',
      summary.failed ? `Не дошло: ${summary.failed}` : '',
    ]
      .filter(Boolean)
      .join('\n');

  const handleSendEventReminder = async (payload: EventReminderPayload) => {
    try {
      const result = await api.sendEventReminder(payload);
      const summary = parseReminderResult(result);
      if (summary.attempted === 0) {
        notify.info('Некому напоминать: под выбранный фильтр никто не попал.');
        return;
      }
      notify.success(`Напоминания отправлены.\n${deliverySummary(summary)}`);
    } catch (err) {
      console.error('Failed to remind unanswered attendees', err);
      notify.error(`Не удалось отправить напоминания. ${errorText(err, '')}`.trim());
    }
  };

  const handleRemindDebtor = async (userId: string, userName: string) => {
    try {
      const result = await api.remindFinanceMemberDebt({ userId });
      const summary = parseReminderResult(result);
      if (summary.sent + summary.queued > 0) {
        notify.success(`Напоминание для ${userName} отправлено.`);
        return;
      }
      if (summary.skippedNoTelegram > 0) {
        notify.error(`Не удалось отправить ${userName}: не привязан Telegram.`);
        return;
      }
      notify.error(`Не удалось отправить напоминание ${userName}.`);
    } catch (err) {
      console.error('Failed to remind debtor', err);
      notify.error(`Не удалось отправить напоминание. ${errorText(err, '')}`.trim());
    }
  };

  const handleRemindAllDebtors = async () => {
    try {
      const result = await api.remindFinanceDebtors();
      const summary = parseReminderResult(result);
      if (summary.attempted === 0) {
        notify.info('В команде нет должников.');
        return;
      }
      notify.success(`Напоминания должникам отправлены.\n${deliverySummary(summary)}`);
    } catch (err) {
      console.error('Failed to remind all debtors', err);
      notify.error(`Не удалось отправить напоминания должникам. ${errorText(err, '')}`.trim());
    }
  };

  // --- FINANCE HANDLER ---
  const handleAddTransaction = async (t: Omit<Transaction, 'id' | 'date'>) => {
    if (!activeTeam) return;
    const newTx: Transaction = {
      id: `tx${Date.now()}`,
      date: new Date(),
      ...t,
    };

    // Optimistic Update
    setTransactions((prev) => [newTx, ...prev]);
    if (t.type === TransactionType.EXPENSE) {
      setActiveTeam((prev) => (prev ? { ...prev, budget: prev.budget - t.amount } : null));
    } else if (t.type === TransactionType.DEPOSIT) {
      setActiveTeam((prev) => (prev ? { ...prev, budget: prev.budget + t.amount } : null));
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
    setEvents((prev) =>
      prev.map((e) => {
        if (e.id === id) {
          const diff = status === RSVPStatus.CONFIRMED ? 1 : e.rsvpStatus === RSVPStatus.CONFIRMED ? -1 : 0;
          return { ...e, rsvpStatus: status, attendeesCount: e.attendeesCount + diff };
        }
        return e;
      })
    );

    await api.rsvp(id, user.id, status);
  };

  // #60: «Иду на серию» одним тапом из списка.
  const handleCommitSeries = async (seriesId: string) => {
    await api.commitSeries(seriesId);
    await loadData({ silent: true, background: true });
  };

  // #61: удалить событие (scope single — серия сохраняется). Капитан/штаб.
  const handleDeleteEvent = async (eventId: string, scope: 'single' | 'future') => {
    await api.deleteEvent(eventId, scope);
    setEvents((prev) => prev.filter((e) => e.id !== eventId));
  };

  // Изменить дату/время события (scope single). Капитан/штаб/админ — гейт на бэкенде.
  const handleEditEventTime = async (eventId: string, startISO: string, endISO: string) => {
    await api.updateEventTime(eventId, startISO, endISO);
    const start = new Date(startISO);
    const end = new Date(endISO);
    const apply = (ev: Event): Event => ({ ...ev, startAt: startISO, endAt: endISO, startDate: start, endDate: end });
    setEvents((prev) => prev.map((e) => (e.id === eventId ? apply(e) : e)));
    await loadData({ silent: true, background: true });
  };

  const handleEditEvent = async (eventId: string, patch: EventEditPatch) => {
    await api.updateEvent(eventId, {
      title: patch.title,
      location: patch.location ?? null,
      locationUrl: patch.locationUrl ?? null,
      locationAddress: patch.locationAddress ?? null,
      startAt: patch.startISO,
      endAt: patch.endISO,
      cost: patch.cost ?? null,
      description: patch.description ?? null,
    });
    const start = new Date(patch.startISO);
    const end = new Date(patch.endISO);
    const apply = (ev: Event): Event => ({
      ...ev,
      title: patch.title,
      location: patch.location || undefined,
      locationUrl: patch.locationUrl || undefined,
      startAt: patch.startISO,
      endAt: patch.endISO,
      startDate: start,
      endDate: end,
      cost: patch.cost ?? undefined,
      description: patch.description || undefined,
    });
    setEvents((prev) => prev.map((e) => (e.id === eventId ? apply(e) : e)));
    await loadData({ silent: true, background: true });
  };

  const handleCreateEvent = async (eventData: any): Promise<boolean> => {
    if (!activeTeam) return false;

    const startDate = eventData?.startDate instanceof Date ? eventData.startDate : new Date(eventData?.startDate);
    if (Number.isNaN(startDate.getTime())) {
      notify.error('Проверь дату события');
      return false;
    }

    const normalizedTitle = String(eventData?.title || '').trim();
    if (!normalizedTitle) {
      notify.error('Введи название события');
      return false;
    }

    const normalizedDescription = String(eventData?.description || '').trim();
    const normalizedLocation = String(eventData?.location || '').trim();
    const normalizedLocationUrl = String(eventData?.locationUrl || '').trim();
    const normalizedLocationAddress = String(eventData?.locationAddress || '').trim();
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
        locationUrl: normalizedLocationUrl || undefined,
        locationAddress: normalizedLocationAddress || undefined,
        cost: normalizedCost,
        recurrence: eventData.recurrence,
      });

      if (response?.event) {
        const dto = response.event;
        const rawStart = dto.startAt || dto.startDate;
        const rawEnd = dto.endAt || dto.endDate;
        const createdEvent: Event = {
          id: String(dto.id),
          teamId: String(dto.teamId || activeTeam.id),
          teamName: dto.teamName || activeTeam.name,
          teamShortCode: dto.teamShortCode || activeTeam.shortCode,
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
          locationUrl: dto.locationUrl ?? (normalizedLocationUrl || undefined),
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
        await loadData({ silent: true, background: true });
      }
      notify.success('Событие создано');
      return true;
    } catch (error) {
      console.error('Failed to create event', error);
      notify.error(`Не удалось создать событие. ${errorText(error, '')}`.trim());
      return false;
    }
  };

  const handleAddGame = async (eventId: string, game: Omit<Game, 'id'>) => {
    const createdGame: Game = {
      // Настоящий UUID, а не `g-<timestamp>`: id уезжает на сервер и становится
      // постоянным id игры. На игре висят рефлексии (#89) — он не должен меняться.
      id: crypto.randomUUID(),
      time: game.time,
      opponent: game.opponent,
      score: game.score,
      pitZone: game.pitZone,
      gamePair: game.gamePair,
    };

    const source = events.find((event) => event.id === eventId);
    const nextSchedule = [...(source?.schedule || []), createdGame].sort((a, b) => a.time.localeCompare(b.time));
    setEvents((prev) => prev.map((event) => (event.id === eventId ? { ...event, schedule: nextSchedule } : event)));
    await api.updateEventSchedule(eventId, nextSchedule.map(toScheduleItemPayload));
  };

  const handleUpdateGame = async (eventId: string, gameId: string, patch: GamePatch) => {
    const source = events.find((event) => event.id === eventId);
    const nextSchedule = (source?.schedule || []).map((game) =>
      game.id === gameId
        ? { ...game, time: patch.time, opponent: patch.opponent, score: patch.score, pitZone: patch.pitZone, gamePair: patch.gamePair }
        : game
    );
    setEvents((prev) => prev.map((event) => (event.id === eventId ? { ...event, schedule: nextSchedule } : event)));
    await api.updateEventSchedule(eventId, nextSchedule.map(toScheduleItemPayload));
  };

  const handleUpdateMemberStatus = async (member: TeamMember, status: PlayerStatus) => {
    if (!activeTeam) return;
    if (!member.membershipId) {
      notify.error('Не удалось определить участника. Обнови страницу.');
      return;
    }

    await api.updateTeamMembership(activeTeam.id, member.membershipId, { status });
    setMembers((prev) => prev.map((item) => (item.id === member.id ? { ...item, status } : item)));
  };

  const handleRemoveMember = async (member: TeamMember) => {
    if (!activeTeam || !user) return;
    if (!member.membershipId) {
      notify.error('Не удалось определить участника. Обнови страницу.');
      return;
    }
    if (member.id === user.id) {
      notify.error('Себя исключить из команды на этом экране нельзя.');
      return;
    }

    await api.removeTeamMembership(activeTeam.id, member.membershipId);
    setMembers((prev) => prev.filter((item) => item.id !== member.id));
  };

  const openRsvpModal = (event: Event) => {
    setRsvpModalEvent(event);
    setIsRSVPModalOpen(true);
  };

  const shell: ShellState = {
    authStep,
    authBootstrapDone,
    appGate,
    onboardingRequired,
    canEnterAdmin,
    offlineSnapshotAt,
    outboxState,
    user,
    team: activeTeam,
    teamCode,
    teamLoad,
    teams,
    events,
    members,
    transactions,
    calendarLink,
    ensureTeam,
    reload,
    actions: {
      rsvp: handleRsvp,
      commitSeries: handleCommitSeries,
      deleteEvent: handleDeleteEvent,
      editEventTime: handleEditEventTime,
      editEvent: handleEditEvent,
      createEvent: handleCreateEvent,
      addGame: handleAddGame,
      updateGame: handleUpdateGame,
      sendEventReminder: handleSendEventReminder,
      updateMemberStatus: handleUpdateMemberStatus,
      removeMember: handleRemoveMember,
      addTransaction: handleAddTransaction,
      remindDebtor: handleRemindDebtor,
      remindAllDebtors: handleRemindAllDebtors,
      copyIcsLink: handleCopyIcsLink,
      shareIcsLink: handleShareIcsLink,
      downloadIcs: handleDownloadIcs,
      logout: handleLogout,
      login: handleLogin,
      joinedTeam: handleJoinedTeam,
      switchToUserMode: handleSwitchToUserMode,
      openRsvpModal,
    },
  };

  return (
    <ShellContext.Provider value={shell}>
      <ErrorBoundary>
        {isLoading || isLoggingOut ? <ScreenLoader /> : <AppRoutes />}
      </ErrorBoundary>
      <RSVPModal
        event={rsvpModalEvent}
        isOpen={isRSVPModalOpen}
        onClose={() => setIsRSVPModalOpen(false)}
        onRsvp={(id, status) => void handleRsvp(id, status)}
      />
      <NotifyHost />
    </ShellContext.Provider>
  );
};

export default App;
