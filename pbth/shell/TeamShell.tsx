import React, { Suspense } from 'react';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useShell } from './context';
import { AppGateScreens, RequireAuth } from './gates';
import { setRequestTeam } from '../api';
import { ShellNav } from '../components/shell/ShellNav';
import { OfflineBanner } from '../components/OfflineBanner';
import { ContentLoader, ScreenLoader } from '../components/shell/ScreenLoader';
import { DataUnavailableScreen, TeamForbiddenScreen } from '../components/shell/StateScreens';
import { TeamsPicker } from '../components/shell/TeamsPicker';
import { TeamsPickerContext } from './teams-picker-context';
import { SectionHeader } from './SectionHeader';
import { hasSectionHead, markTarget, sectionHeadText, sectionPaints } from './section-head';
import { spotColor, teamPaint } from '../ui';
import { shellExtensions, type ShellExtContext } from './extensions';
import { eventCreateAccess } from '../lib/event-create-access';
import { findTeamByCode, parseTeamPath, teamCodeOf, teamPath } from '../lib/team-url';
import type { Team, TeamContext } from '../types';
import './home.css';

// Оболочка экранов команды `/t/:team/*` и профиля `/me`.
//
// Разделы (Моё, Календарь, Команда, Казна, журнал, Профиль) получают общую
// стеклянную шапку раздела (`SectionHeader`): название экрана, подпись,
// «Команды», значки расширений и ряд знаков команд. Шапка закреплена сверху и
// закрывает вырез, экран отступает на её высоту. Фон раздела (краски за
// стеклом) тоже даёт оболочка: переменные красок стоят на обёртке
// `.pbth-shell` и перекрывают те, что экран ставит сам. Экраны одной записи
// (событие, карточка игрока, новое событие) и заявки — со своей шапкой
// «назад», как раньше.

function isRecordScreen(pathname: string): boolean {
  const parsed = parseTeamPath(pathname);
  if (!parsed) return false;
  if (parsed.section === 'event' || parsed.section === 'new') return true;
  return parsed.section === 'roster' && parsed.rest.length > 0;
}

/** Переменные красок фона раздела на обёртке: три пятна, недостающие — прозрачные. */
export function paintVars(paints: string[]): React.CSSProperties {
  const vars: Record<string, string> = {};
  for (let i = 0; i < 3; i += 1) vars[`--ui-paint-${i + 1}`] = paints[i] ? spotColor(paints[i]) : 'transparent';
  return vars as React.CSSProperties;
}

// Рамка старых экранов (подложка со сплэшем). `plain` — тёмный фон темы для экранов в новом виде.
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

/**
 * Рамка раздела со стеклянной шапкой: фон и краски раздела, шапка над экраном,
 * экран отступает на её высоту. Плашка «офлайн» — под шапкой, в потоке экрана.
 */
const SectionFrame: React.FC<{ paints: string[]; head: (onHeight: (px: number) => void) => React.ReactNode; children: React.ReactNode }> = ({
  paints,
  head,
  children,
}) => {
  const shell = useShell();
  const ref = React.useRef<HTMLDivElement>(null);
  const onHeight = React.useCallback((px: number) => {
    ref.current?.style.setProperty('--pbth-head-h', `${Math.round(px)}px`);
  }, []);
  return (
    <div ref={ref} className="pbth-shell min-h-screen text-white" style={{ background: 'var(--ui-bg)', ...paintVars(paints) }}>
      {head(onHeight)}
      <main className="pbth-shell__body max-w-md mx-auto min-h-screen relative flex flex-col">
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

/** Значки расширений шапки и пункты меню команды (треки, `pbth/shell/ext`). */
function useShellExt(code: string) {
  const shell = useShell();
  const extCtx: ShellExtContext | null =
    shell.user && shell.team ? { user: shell.user, team: shell.team, teamCode: code, role: shell.team.role, teams: shell.teams } : null;
  const badges = extCtx
    ? shellExtensions.headerBadges
        .filter((badge) => !badge.visible || badge.visible(extCtx))
        .map(({ id, Component }) => <Component key={id} {...extCtx} />)
    : null;
  const menuItems = extCtx
    ? shellExtensions.teamMenu
        .filter((item) => !item.visible || item.visible(extCtx))
        .map((item) => ({ id: item.id, label: item.label, to: item.to(extCtx) }))
    : [];
  return { badges, menuItems };
}

/** Шапка раздела и выбор команд: общие для разделов команды и профиля. */
const SectionHead: React.FC<{
  code: string;
  /** Команда в шапке: пока выбранная грузится — она же из списка команд человека. */
  team: Team | null;
  ready: boolean;
  teamsOpen: boolean;
  setTeamsOpen: (open: boolean) => void;
  onHeight: (px: number) => void;
}> = ({ code, team, ready, teamsOpen, setTeamsOpen, onHeight }) => {
  const shell = useShell();
  const navigate = useNavigate();
  const location = useLocation();
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const { badges, menuItems } = useShellExt(code);
  const onMe = location.pathname === '/me';
  const text = sectionHeadText(location.pathname, { now, team, membersCount: ready ? shell.members.length : 0 });
  const pickTeam = (target: TeamContext) => {
    setTeamsOpen(false);
    const targetCode = teamCodeOf({ teamId: target.teamId, shortCode: target.shortCode });
    if (onMe || targetCode !== code) navigate(markTarget(location.pathname, targetCode));
  };
  return (
    <>
      <SectionHeader
        title={text.title}
        subtitle={text.subtitle}
        note={!onMe && team?.via === 'owner' ? 'Владелец платформы' : undefined}
        teams={shell.teams}
        currentCode={onMe ? null : code}
        badges={ready && !onMe ? badges : null}
        onPickTeam={pickTeam}
        onOpenTeams={() => setTeamsOpen(true)}
        onHeight={onHeight}
      />
      <TeamsPicker
        open={teamsOpen}
        onClose={() => setTeamsOpen(false)}
        teams={shell.teams}
        currentCode={onMe ? '' : code}
        items={ready && !onMe ? menuItems : []}
        onPickTeam={pickTeam}
        onPickItem={(to) => {
          setTeamsOpen(false);
          navigate(to);
        }}
      />
    </>
  );
};

/** Краски фона раздела. */
function useSectionPaints(pathname: string): string[] {
  const shell = useShell();
  const [now] = React.useState(() => Date.now());
  return React.useMemo(
    () => sectionPaints(pathname, { now, events: shell.events, team: shell.team, teams: shell.teams, paintOf: teamPaint }),
    [pathname, now, shell.events, shell.team, shell.teams],
  );
}

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
  const [teamsOpen, setTeamsOpen] = React.useState(false);
  const paints = useSectionPaints(location.pathname);

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
  const nav = <ShellNav teamCode={code} canCreate={canCreate && section !== 'requests' && section !== 'journal'} />;
  const content = (
    <div className="flex-1">
      <TeamsPickerContext.Provider value={() => setTeamsOpen(true)}>
        {ready ? (
          <Suspense fallback={<ContentLoader />}>
            <Outlet />
          </Suspense>
        ) : (
          <ContentLoader />
        )}
      </TeamsPickerContext.Provider>
    </div>
  );

  // Заявки — экран со своей шапкой «назад»: без шапки раздела.
  if (!hasSectionHead(location.pathname)) {
    return (
      <Frame plain>
        <OnboardingNote />
        {content}
        {nav}
      </Frame>
    );
  }

  return (
    <SectionFrame
      paints={paints}
      head={(onHeight) => (
        <SectionHead
          code={code}
          team={headerTeam}
          ready={ready}
          teamsOpen={teamsOpen}
          setTeamsOpen={setTeamsOpen}
          onHeight={onHeight}
        />
      )}
    >
      <OnboardingNote />
      {content}
      {nav}
    </SectionFrame>
  );
};

export const TeamShell: React.FC = () => (
  <RequireAuth>
    <AppGateScreens>
      <TeamShellInner />
    </AppGateScreens>
  </RequireAuth>
);

/** Профиль `/me` в рамке раздела: шапка «Профиль», ряд знаков ведёт на «Моё» команды. */
const MeFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const shell = useShell();
  const [teamsOpen, setTeamsOpen] = React.useState(false);
  const paints = useSectionPaints('/me');
  const code = shell.teamCode || '';
  const canCreate = shell.team ? eventCreateAccess(shell.team.role).canCreate : false;
  return (
    <SectionFrame
      paints={paints}
      head={(onHeight) => (
        <SectionHead code={code} team={shell.team} ready teamsOpen={teamsOpen} setTeamsOpen={setTeamsOpen} onHeight={onHeight} />
      )}
    >
      <div className="flex-1">
        <Suspense fallback={<ContentLoader />}>{children}</Suspense>
      </div>
      <ShellNav teamCode={shell.teamCode} canCreate={canCreate} />
    </SectionFrame>
  );
};

/** `/me` — профиль: навигация ведёт в последнюю команду. */
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
          <MeFrame>{children}</MeFrame>
        ) : shell.teamLoad === 'error' ? (
          <DataUnavailableScreen onRetry={() => window.location.reload()} onLogin={() => window.location.assign('/login')} />
        ) : (
          <ScreenLoader />
        )}
      </AppGateScreens>
    </RequireAuth>
  );
};
