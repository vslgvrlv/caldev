import React, { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { LandingView } from './views/LandingView';
import { useShell } from './shell/context';
import { ScreenLoader } from './components/shell/ScreenLoader';
import { setRequestTeam } from './api';
import { resolvePostLoginAction } from './lib/post-login';

// Все адреса приложения (спека ревизии, «Контракты основы → Адреса экранов»).
//
// | Адрес                                   | Экран                         |
// | /t/:team                                | главная команды               |
// | /t/:team/calendar                       | календарь                     |
// | /t/:team/money                          | казна                         |
// | /t/:team/roster, /t/:team/roster/:userId| состав, карточка игрока       |
// | /t/:team/event/:eventId                 | событие                       |
// | /t/:team/new                            | новое событие                 |
// | /t/:team/requests                       | заявки (трек 1)               |
// | /me                                     | профиль                       |
// | /join/:code                             | вступление по ссылке (трек 1) |
// | /teams                                  | открытые команды (трек 4)     |
// | /admin/*                                | консоль платформы (трек 3)    |
// | /app, /app/*                            | вход: последняя команда       |
// | /invite/:token, /login, /, /privacy, /terms, /support — как раньше      |
//
// Трек меняет заглушку своего экрана на настоящий; новые адреса раздела
// команды добавляются внутрь блока `/t/:team`.

const PrivacyView = lazy(() => import('./views/PrivacyView').then((m) => ({ default: m.PrivacyView })));
const TermsView = lazy(() => import('./views/TermsView').then((m) => ({ default: m.TermsView })));
const SupportView = lazy(() => import('./views/SupportView').then((m) => ({ default: m.SupportView })));
const InviteView = lazy(() => import('./views/InviteView').then((m) => ({ default: m.InviteView })));
const LoginView = lazy(() => import('./views/LoginView').then((m) => ({ default: m.LoginView })));
const OwnerConsoleView = lazy(() => import('./views/track3/OwnerConsoleView').then((m) => ({ default: m.OwnerConsoleView })));

// Оболочка приложения — отдельным куском: главная страница (лендинг) её не ждёт.
const shellChunk = () => import('./shell/app-chunk');
const AppEntry = lazy(() => shellChunk().then((m) => ({ default: m.AppEntry })));
const TeamShell = lazy(() => shellChunk().then((m) => ({ default: m.TeamShell })));
const MeShell = lazy(() => shellChunk().then((m) => ({ default: m.MeShell })));
const DashboardScreen = lazy(() => shellChunk().then((m) => ({ default: m.DashboardScreen })));
const CalendarScreen = lazy(() => shellChunk().then((m) => ({ default: m.CalendarScreen })));
const MoneyScreen = lazy(() => shellChunk().then((m) => ({ default: m.MoneyScreen })));
const RosterScreen = lazy(() => shellChunk().then((m) => ({ default: m.RosterScreen })));
const MemberScreen = lazy(() => shellChunk().then((m) => ({ default: m.MemberScreen })));
const EventScreen = lazy(() => shellChunk().then((m) => ({ default: m.EventScreen })));
const NewEventScreen = lazy(() => shellChunk().then((m) => ({ default: m.NewEventScreen })));
const ProfileScreen = lazy(() => shellChunk().then((m) => ({ default: m.ProfileScreen })));

// Заглушки треков второй волны.
const JoinRequestsView = lazy(() => import('./views/track1/JoinRequestsView').then((m) => ({ default: m.JoinRequestsView })));
const JoinByCodeView = lazy(() => import('./views/track1/JoinByCodeView').then((m) => ({ default: m.JoinByCodeView })));
const TeamJournalView = lazy(() => import('./views/track3/TeamJournalView').then((m) => ({ default: m.TeamJournalView })));
const OpenTeamsView = lazy(() => import('./views/track4/OpenTeamsView').then((m) => ({ default: m.OpenTeamsView })));

/** Вошедший на /login уходит туда, куда шёл (`?next=`), а не всегда на /app. */
const LoginRoute: React.FC = () => {
  const shell = useShell();
  const [searchParams] = useSearchParams();
  if (shell.authStep === 'APP') {
    const action = resolvePostLoginAction(searchParams.get('next'));
    return <Navigate to={action.kind === 'admin' ? '/admin' : action.path} replace />;
  }
  return (
    <LoginView
      onLogin={(target) => void shell.actions.login(target)}
      bootstrapDone={shell.authBootstrapDone}
      sessionUser={shell.user}
    />
  );
};

/** Консоль владельца (трек 3): команды в ней свои — заголовок команды не нужен. */
const AdminRoute: React.FC = () => {
  React.useEffect(() => {
    setRequestTeam(null);
  }, []);
  return <OwnerConsoleView />;
};

const InviteRoute: React.FC = () => {
  const shell = useShell();
  return <InviteView onJoined={shell.actions.joinedTeam} />;
};

export const AppRoutes: React.FC = () => (
  <Suspense fallback={<ScreenLoader />}>
    <Routes>
      <Route path="/" element={<LandingView />} />
      <Route path="/privacy" element={<PrivacyView />} />
      <Route path="/terms" element={<TermsView />} />
      <Route path="/support" element={<SupportView />} />
      <Route path="/invite/:inviteId" element={<InviteRoute />} />
      {/* /admin/login сведён в /login?next=/admin — единый вход для всех ролей */}
      <Route path="/admin/login" element={<Navigate to="/login?next=/admin" replace />} />
      <Route path="/admin/*" element={<AdminRoute />} />
      <Route path="/login" element={<LoginRoute />} />

      <Route path="/app/*" element={<AppEntry />} />

      <Route path="/t/:team" element={<TeamShell />}>
        <Route index element={<DashboardScreen />} />
        <Route path="calendar" element={<CalendarScreen />} />
        <Route path="money" element={<MoneyScreen />} />
        <Route path="roster" element={<RosterScreen />} />
        <Route path="roster/:userId" element={<MemberScreen />} />
        <Route path="event/:eventId" element={<EventScreen />} />
        <Route path="new" element={<NewEventScreen />} />
        <Route path="requests" element={<JoinRequestsView />} />
        <Route path="journal" element={<TeamJournalView />} />
        <Route path="*" element={<Navigate to=".." replace />} />
      </Route>

      <Route path="/me" element={<MeShell><ProfileScreen /></MeShell>} />
      <Route path="/join/:code" element={<JoinByCodeView />} />
      <Route path="/teams" element={<OpenTeamsView />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </Suspense>
);

