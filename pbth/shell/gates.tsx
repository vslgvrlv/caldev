import React from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useShell } from './context';
import { ScreenLoader } from '../components/shell/ScreenLoader';
import { DataUnavailableScreen, NoTeamScreen } from '../components/shell/StateScreens';
import { readLastTeam, resolveEntryTeam, teamPath } from '../lib/team-url';

/**
 * Экраны только для вошедших. Не вошёл — на вход, а после входа обратно на
 * этот же адрес (`/login?next=…`): так ссылка на событие открывает событие.
 */
export const RequireAuth: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const shell = useShell();
  const location = useLocation();
  if (shell.authStep === 'APP') return <>{children}</>;
  if (!shell.authBootstrapDone) return <ScreenLoader />;
  const here = `${location.pathname}${location.search}`;
  const next = here === '/app' || here.startsWith('/app/') ? '' : `?next=${encodeURIComponent(here)}`;
  return <Navigate to={`/login${next}`} replace />;
};

/** Экран «нет команды» — до любого экрана команды. */
export const AppGateScreens: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const shell = useShell();
  if (shell.appGate === 'NO_TEAM') {
    // Владелец без своей команды открывает любую из консоли.
    if (shell.canEnterAdmin) return <Navigate to="/admin" replace />;
    return (
      <NoTeamScreen
        userName={shell.user?.name}
        onboardingRequired={shell.onboardingRequired}
        onLogout={() => void shell.actions.logout()}
      />
    );
  }
  return <>{children}</>;
};

/**
 * `/app` и `/app/*` — вход из Mini App, пушей и старых закладок. Ведёт в
 * последнюю команду на этом устройстве.
 */
export const AppEntry: React.FC = () => {
  const shell = useShell();
  const navigate = useNavigate();
  const lastTeam = readLastTeam();

  React.useEffect(() => {
    // Данных ещё нет (вход открыли напрямую) — загружаем последнюю команду.
    // Только после входа: до него загрузку ведёт восстановление сессии.
    if (shell.authStep === 'APP' && !shell.team && shell.teamLoad === 'idle' && shell.appGate === 'READY') {
      shell.ensureTeam(lastTeam || '');
    }
  }, [lastTeam, shell]);

  const entry = resolveEntryTeam(
    lastTeam,
    shell.teams,
    shell.team ? { teamId: shell.team.id, shortCode: shell.team.shortCode } : null,
  );

  return (
    <RequireAuth>
      <AppGateScreens>
        {entry ? (
          <Navigate to={teamPath(entry)} replace />
        ) : shell.teamLoad === 'error' ? (
          <DataUnavailableScreen
            onRetry={() => window.location.reload()}
            onLogin={() => navigate('/login', { replace: true })}
          />
        ) : (
          <ScreenLoader />
        )}
      </AppGateScreens>
    </RequireAuth>
  );
};
