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
import { TeamsFilter } from '../components/shell/TeamsFilter';
import { CreateTeamPicker } from '../components/shell/CreateTeamPicker';
import { RequestCountsContext, TeamFilterContext, useTeamFilter, useTeamFilterState } from './team-filter-context';
import { useTeamRequestCounts } from '../lib/use-team-requests';
import { plusAction } from '../lib/team-filter';
import { TeamsPickerContext } from './teams-picker-context';
import { SectionHeader } from './SectionHeader';
import { useSectionSubtitleOverride } from './section-subtitle';
import { hasSectionHead, markTarget, sectionHeadText, sectionPaints } from './section-head';
import { spotColor, TeamMark, teamPaint } from '../ui';
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
      {/* Стекло под часами и вырезом: прокрученное содержимое не лезет под статус-бар голым. Без выреза высота 0. */}
      <div className="ui-glass pbth-statusveil" aria-hidden="true" />
      {/* overflow-x: clip, а не hidden: hidden делает рамку контейнером прокрутки, и липкая шапка экрана не липнет. */}
      <main
        className={`max-w-md mx-auto min-h-screen relative overflow-x-clip flex flex-col${plain ? '' : ' shadow-2xl shadow-black'}`}
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
      {/* Фон раздела для экранов в старом виде; экран в <Screen> рисует его сам (тогда этот скрыт, см. home.css). */}
      <div className="ui-backdrop pbth-shell__paints" aria-hidden="true" />
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

/**
 * Разделы, где ряд знаков — фильтр команд, а не переключатель: «Моё» и «Календарь»
 * показывают события всех команд человека, текущей команды там для него нет.
 */
export function isFilterSection(pathname: string): boolean {
  const parsed = parseTeamPath(pathname);
  return Boolean(parsed) && (parsed!.section === '' || parsed!.section === 'calendar') && parsed!.rest.length === 0;
}

/**
 * Какие значки расширений ставить в шапку раздела. «Моё» — только не про
 * команду (свободные слоты), «Календарь» — никаких, разделы команды — все.
 */
export function headerBadgeScope(pathname: string): 'all' | 'global' | 'none' {
  const section = parseTeamPath(pathname)?.section;
  if (section === '' && isFilterSection(pathname)) return 'global';
  if (section === 'calendar') return 'none';
  return 'all';
}

/** Значки расширений шапки (треки, `pbth/shell/ext`). */
function useShellBadges(code: string, scope: 'all' | 'global' | 'none') {
  const shell = useShell();
  const extCtx: ShellExtContext | null =
    shell.user && shell.team ? { user: shell.user, team: shell.team, teamCode: code, role: shell.team.role, teams: shell.teams } : null;
  if (!extCtx || scope === 'none') return null;
  return shellExtensions.headerBadges
    .filter((badge) => scope === 'all' || !badge.teamScoped)
    .filter((badge) => !badge.visible || badge.visible(extCtx))
    .map(({ id, Component }) => <Component key={id} {...extCtx} />);
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
  const onMe = location.pathname === '/me';
  const filterMode = isFilterSection(location.pathname);
  const filter = useTeamFilter();
  const badges = useShellBadges(code, headerBadgeScope(location.pathname));
  const text = sectionHeadText(location.pathname, { now, team, membersCount: ready ? shell.members.length : 0 });
  const subtitleOverride = useSectionSubtitleOverride();
  const pickTeam = (target: TeamContext) => {
    setTeamsOpen(false);
    const targetCode = teamCodeOf({ teamId: target.teamId, shortCode: target.shortCode });
    if (onMe || targetCode !== code) navigate(markTarget(location.pathname, targetCode));
  };
  return (
    <>
      <SectionHeader
        title={text.title}
        subtitle={subtitleOverride ?? text.subtitle}
        mark={
          team && parseTeamPath(location.pathname)?.section === 'roster' ? (
            <TeamMark teamId={team.id} name={team.name} code={team.shortCode} size={48} />
          ) : undefined
        }
        note={!onMe && team?.via === 'owner' ? 'Владелец платформы' : undefined}
        teams={filterMode ? filter.teams : shell.teams}
        currentCode={onMe || filterMode ? null : code}
        filter={filterMode ? { isShown: filter.isShown, onToggle: (t) => filter.toggle(t.teamId) } : undefined}
        badges={ready && !onMe ? badges : null}
        onPickTeam={pickTeam}
        onOpenTeams={() => setTeamsOpen(true)}
        onHeight={onHeight}
      />
      {filterMode ? (
        <TeamsFilter
          open={teamsOpen}
          onClose={() => setTeamsOpen(false)}
          teams={filter.teams}
          hidden={filter.hidden}
          onSetShown={filter.setShown}
          onSetHidden={filter.setHidden}
          onOpenTeam={(t) => {
            setTeamsOpen(false);
            navigate(teamPath(teamCodeOf({ teamId: t.teamId, shortCode: t.shortCode }), 'roster'));
          }}
        />
      ) : (
        <TeamsPicker
          open={teamsOpen}
          onClose={() => setTeamsOpen(false)}
          teams={shell.teams}
          currentCode={onMe ? '' : code}
          onPickTeam={pickTeam}
        />
      )}
    </>
  );
};

/**
 * Краски фона раздела. На «Моё» и в «Календаре» — только по включённым в
 * фильтре командам: скрытая команда не красит фон, все скрыты — фон без пятен.
 */
function useSectionPaints(pathname: string, isShown?: (teamId: string) => boolean): string[] {
  const shell = useShell();
  const [now] = React.useState(() => Date.now());
  return React.useMemo(() => {
    const filtered = Boolean(isShown) && isFilterSection(pathname);
    const events = filtered ? shell.events.filter((e) => isShown!(e.teamId)) : shell.events;
    const team = filtered && shell.team && !isShown!(shell.team.id) ? null : shell.team;
    return sectionPaints(pathname, { now, events, team, teams: shell.teams, paintOf: teamPaint });
  }, [pathname, now, shell.events, shell.team, shell.teams, isShown]);
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
  const [createOpen, setCreateOpen] = React.useState(false);
  const filter = useTeamFilterState(shell.user?.id, shell.teams);
  const paints = useSectionPaints(location.pathname, filter.isShown);
  // Заявки по всем своим командам для строк в ленте «Моё»: один запрос на команду, где я капитан или тренер.
  const requestCounts = useTeamRequestCounts(shell.teams, Boolean(shell.user));

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
  // «Плюс» на «Моё» и в «Календаре» не привязан к последней открытой команде:
  // команд с правом создавать несколько — сначала шторка выбора, одна — сразу её форма.
  const plus = isFilterSection(location.pathname) ? plusAction(shell.teams) : null;
  const onCreate =
    plus?.kind === 'pick'
      ? () => setCreateOpen(true)
      : plus?.kind === 'go'
        ? () => navigate(teamPath(teamCodeOf({ teamId: plus.team.teamId, shortCode: plus.team.shortCode }), 'new'))
        : undefined;
  const navCanCreate = plus && plus.kind !== 'none' ? ready : canCreate && section !== 'requests' && section !== 'journal';
  const nav = <ShellNav teamCode={code} canCreate={navCanCreate} onCreate={onCreate} />;
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

  // Правило панели: у разделов (шапка раздела) нижняя панель есть, у внутренних экранов с «назад»
  // (заявки, событие, новое событие, карточка игрока) её нет — путь назад даёт стрелка.
  if (!hasSectionHead(location.pathname)) {
    return (
      <Frame plain>
        <OnboardingNote />
        {content}
      </Frame>
    );
  }

  return (
    <TeamFilterContext.Provider value={filter}>
      <RequestCountsContext.Provider value={requestCounts}>
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
        {plus?.kind === 'pick' && (
          <CreateTeamPicker
            open={createOpen}
            onClose={() => setCreateOpen(false)}
            teams={plus.teams}
            onPick={(t) => {
              setCreateOpen(false);
              navigate(teamPath(teamCodeOf({ teamId: t.teamId, shortCode: t.shortCode }), 'new'));
            }}
          />
        )}
      </RequestCountsContext.Provider>
    </TeamFilterContext.Provider>
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
