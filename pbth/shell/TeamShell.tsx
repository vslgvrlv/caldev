import React, { Suspense } from 'react';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useShell } from './context';
import { AppGateScreens, RequireAuth } from './gates';
import { setRequestTeam } from '../api';
import { ShellNav } from '../components/shell/ShellNav';
import { OfflineBanner } from '../components/OfflineBanner';
import { TeamHeader } from '../components/shell/TeamHeader';
import { ContentLoader, ScreenLoader } from '../components/shell/ScreenLoader';
import { DataUnavailableScreen, TeamForbiddenScreen } from '../components/shell/StateScreens';
import { eventCreateAccess } from '../lib/event-create-access';
import { findTeamByCode, parseTeamPath, teamPath } from '../lib/team-url';
import type { Team } from '../types';

// Оболочка экранов команды `/t/:team/*` и профиля `/me`.
//
// Экраны разделов (главная, календарь, казна, состав, заявки и разделы
// треков) получают общую шапку с переключателем команд и нижнюю навигацию.
// Экраны одной записи (событие, карточка игрока, новое событие) — со своей
// шапкой и кнопкой «назад», как раньше: их липкая шапка учитывает вырез экрана,
// и вторая шапка над ней ломала бы прокрутку.

const SECTION_SAFE_TOP = {
  '--pb-safe-top': '0px',
  // Старые экраны уходят под плавающую нижнюю панель: запас под неё и под вырез снизу.
  paddingBottom: 'calc(var(--pb-safe-bottom) + 16px)',
} as React.CSSProperties;

function isRecordScreen(pathname: string): boolean {
  const parsed = parseTeamPath(pathname);
  if (!parsed) return false;
  if (parsed.section === 'event' || parsed.section === 'new') return true;
  return parsed.section === 'roster' && parsed.rest.length > 0;
}

// `plain` — новая главная: тёмный фон темы и краски за стеклом вместо старой подложки.
const Frame: React.FC<{ children: React.ReactNode; plain?: boolean }> = ({ children, plain }) => {
  const shell = useShell();
  return (
    <div
      className={
        plain
          ? 'min-h-screen text-white font-sans'
          : 'min-h-screen bg-pb-background bg-splatter bg-fixed bg-no-repeat bg-center bg-cover text-white font-sans selection:bg-pb-primary selection:text-pb-background'
      }
      style={plain ? { background: 'var(--ui-bg)' } : undefined}
    >
      {!plain && <div className="fixed inset-0 bg-pb-background/72 -z-10 pointer-events-none"></div>}
      <main
        className={`max-w-md mx-auto min-h-screen relative overflow-hidden flex flex-col${plain ? '' : ' shadow-2xl shadow-black'}`}
      >
        <OfflineBanner
          snapshotAt={shell.offlineSnapshotAt}
          pending={shell.outboxState.pending}
          blocked={shell.outboxState.blocked}
        />
        {children}
      </main>
    </div>
  );
};

const OnboardingNote: React.FC = () => {
  const shell = useShell();
  if (!shell.onboardingRequired) return null;
  return (
    <div className="mx-4 mt-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
      Аккаунт создан по данным Telegram. Всё уже доступно — можно просто работать в приложении.
    </div>
  );
};

const TeamShellInner: React.FC = () => {
  const shell = useShell();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const code = String(params.team || '').toLowerCase();
  const { ensureTeam } = shell;

  React.useEffect(() => {
    if (code) ensureTeam(code);
  }, [code, ensureTeam]);

  const ready = Boolean(shell.user && shell.team && shell.teamCode === code);

  // Команда из адреса — во всех запросах этого экрана (заголовок X-PBTH-Team).
  React.useEffect(() => {
    if (ready && shell.team) setRequestTeam(shell.team.id);
  }, [ready, shell.team]);

  const recordScreen = isRecordScreen(location.pathname);

  if (!ready && shell.teamLoad === 'forbidden') {
    return (
      <Frame>
        <TeamForbiddenScreen
          code={code}
          onOpenOwn={() => navigate(shell.teamCode ? teamPath(shell.teamCode) : '/app', { replace: true })}
        />
        <ShellNav teamCode={shell.teamCode} />
      </Frame>
    );
  }
  if (!ready && shell.teamLoad === 'error') {
    return (
      <DataUnavailableScreen
        onRetry={() => window.location.reload()}
        onLogin={() => navigate('/login', { replace: true })}
      />
    );
  }

  if (recordScreen) {
    if (!ready) return <ScreenLoader />;
    return (
      <Frame>
        <div className="flex-1">
          <Suspense fallback={<ScreenLoader />}>
            <Outlet />
          </Suspense>
        </div>
      </Frame>
    );
  }

  // Пока грузится выбранная команда, шапка уже показывает её — из списка
  // команд человека. Содержимое ждёт данных: показывать старую команду под
  // новым названием нельзя, так легко создать событие не там.
  let headerTeam: Team | null = ready ? shell.team : null;
  if (!headerTeam) {
    const pending = findTeamByCode(code, shell.teams);
    if (pending) {
      headerTeam = {
        id: pending.teamId,
        name: pending.teamName,
        shortCode: pending.shortCode || '',
        role: pending.role,
        via: pending.via,
        budget: 0,
      };
    }
  }

  const canCreate = ready && shell.team ? eventCreateAccess(shell.team.role).canCreate : false;
  const section = parseTeamPath(location.pathname)?.section ?? '';
  // Главная рисует свою шапку внутри экрана (краски фона зависят от событий).
  const home = section === '';

  return (
    <Frame plain={home}>
      {!home && shell.user && headerTeam && (
        <TeamHeader user={shell.user} team={headerTeam} teamCode={code} teams={shell.teams} />
      )}
      <OnboardingNote />
      <div className="flex-1" style={home ? undefined : SECTION_SAFE_TOP}>
        {ready ? (
          <Suspense fallback={<ContentLoader />}>
            <Outlet />
          </Suspense>
        ) : (
          <ContentLoader />
        )}
      </div>

      <ShellNav teamCode={code} canCreate={canCreate && section !== 'requests' && section !== 'journal'} />
    </Frame>
  );
};

export const TeamShell: React.FC = () => (
  <RequireAuth>
    <AppGateScreens>
      <TeamShellInner />
    </AppGateScreens>
  </RequireAuth>
);

/** `/me` — профиль: без шапки команды, навигация ведёт в последнюю команду. */
export const MeShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const shell = useShell();
  const { ensureTeam } = shell;
  React.useEffect(() => {
    if (shell.authStep === 'APP' && !shell.team && shell.teamLoad === 'idle') ensureTeam('');
  }, [ensureTeam, shell.authStep, shell.team, shell.teamLoad]);
  return (
    <RequireAuth>
      <AppGateScreens>
        {shell.user && shell.team ? (
          <Frame>
            <div className="flex-1" style={{ paddingBottom: 'calc(var(--pb-safe-bottom) + 16px)' }}>
              <Suspense fallback={<ContentLoader />}>{children}</Suspense>
            </div>
            <ShellNav teamCode={shell.teamCode} />
          </Frame>
        ) : shell.teamLoad === 'error' ? (
          <DataUnavailableScreen onRetry={() => window.location.reload()} onLogin={() => window.location.assign('/login')} />
        ) : (
          <ScreenLoader />
        )}
      </AppGateScreens>
    </RequireAuth>
  );
};
