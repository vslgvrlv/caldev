import React, { lazy } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useShell } from './context';
import { useGoBack } from './navigation';
import { NotFoundScreen } from '../components/shell/StateScreens';
import { eventCreateAccess, eventCreateViewProps } from '../lib/event-create-access';
import { eventTeamCode, resolveEventTeamName } from '../lib/event-team';
import { eventPath, memberPath, teamCodeOf, teamPath } from '../lib/team-url';
import { captainHomeHints } from '../lib/events';
import { teamLinkAccess } from '../lib/team-link-access';
import { TeamJoinLinkSheet } from '../components/track1/TeamJoinLinkSheet';
import { shellExtensions, type ShellExtContext } from './extensions';
import { teamScreenRows } from './section-head';
import { treasuryRowSub } from '../lib/treasury-view';
import { formatRub } from '../lib/format-rub';
import { GuestBookingsBlock } from '../components/track4/GuestBookingCards';
import { useRequestCounts, useTeamFilter } from './team-filter-context';
import { requestsNotices } from '../lib/team-filter';
import { PlayerStatus, Role, type Event, type TeamContext, type TeamMember } from '../types';

// Экраны по адресам. Здесь только проводка: данные и действия из оболочки,
// «назад» — по адресу. Внутренности экранов не меняются.
//
// Экраны грузятся отдельными кусками (personal-os#1431): главная страница не
// должна ждать код админки, финансов и карточки события.
const Dashboard = lazy(() => import('../views/Dashboard').then((m) => ({ default: m.Dashboard })));
const CalendarView = lazy(() => import('../views/CalendarView').then((m) => ({ default: m.CalendarView })));
const TeamView = lazy(() => import('../views/TeamView').then((m) => ({ default: m.TeamView })));
const EventDetailView = lazy(() => import('../views/EventDetailView').then((m) => ({ default: m.EventDetailView })));
const CreateEventView = lazy(() => import('../views/CreateEventView').then((m) => ({ default: m.CreateEventView })));
const ProfileView = lazy(() => import('../views/ProfileView').then((m) => ({ default: m.ProfileView })));
const FinanceView = lazy(() => import('../views/FinanceView').then((m) => ({ default: m.FinanceView })));
const PlayerProfileView = lazy(() => import('../views/PlayerProfileView').then((m) => ({ default: m.PlayerProfileView })));

function useTeamCode(): string {
  const { team } = useParams();
  return String(team || '').toLowerCase();
}

/** Адрес события: команда события, а не та, что открыта сейчас. */
function useOpenEvent() {
  const shell = useShell();
  const navigate = useNavigate();
  const currentCode = useTeamCode();
  return React.useCallback(
    (event: Event) => {
      const code = eventTeamCode(event, shell.teams, currentCode);
      navigate(eventPath(code, event.id));
      // Расписание турнира правят, пока приложение открыто: на своей команде
      // подтягиваем свежие данные; чужую команда загрузит заново сама.
      if (code === shell.teamCode) void shell.reload();
    },
    [currentCode, navigate, shell],
  );
}

export const DashboardScreen: React.FC = () => {
  const shell = useShell();
  const navigate = useNavigate();
  const openEvent = useOpenEvent();
  const code = useTeamCode();
  const [linkOpen, setLinkOpen] = React.useState(false);
  const team = shell.team;
  const filter = useTeamFilter();
  // Лента, «Ждут ответа» и ближайшее событие — только по включённым в фильтре командам.
  const events = React.useMemo(() => shell.events.filter((event) => filter.isShown(event.teamId)), [shell.events, filter]);
  // Подсказки капитану новой команды: «Позови команду», «Создай первое событие» — если команда включена.
  const hints = captainHomeHints({
    role: team && filter.isShown(team.id) ? team.role : undefined,
    membersCount: shell.members.length,
    teamEventsCount: team ? shell.events.filter((event) => event.teamId === team.id).length : 0,
  });
  // Заявки в команду: по строке на каждую включённую команду, где я решаю заявки и они есть.
  const counts = useRequestCounts();
  const notices = requestsNotices(shell.teams, counts, filter.hidden).map(({ team: t, text }) => {
    const teamCode = teamCodeOf({ teamId: t.teamId, shortCode: t.shortCode });
    return {
      id: t.teamId,
      teamId: t.teamId,
      teamName: t.teamName,
      shortCode: t.shortCode,
      text,
      onOpen: () => navigate(teamPath(teamCode, 'requests')),
    };
  });

  // Шапку «Моё» (название, дата, ряд знаков, «Команды», значки) и фон даёт оболочка.
  return (
    <>
      <Dashboard
        teams={shell.teams}
        events={events}
        currentTeam={team ? { id: team.id, name: team.name, shortCode: team.shortCode } : null}
        onRsvp={(id, status) => void shell.actions.rsvp(id, status)}
        onEventClick={openEvent}
        onEventLongPress={shell.actions.openRsvpModal}
        onCommitSeries={(seriesId) => void shell.actions.commitSeries(seriesId)}
        captainHints={hints}
        onInviteTeam={() => setLinkOpen(true)}
        onCreateEvent={() => navigate(teamPath(code || shell.teamCode || '', 'new'))}
        guestBookings={<GuestBookingsBlock isShown={filter.isShown} />}
        requestNotices={notices}
        allTeamsHidden={filter.allHidden}
        onShowAllTeams={filter.showAll}
      />
      {linkOpen && team && (
        <TeamJoinLinkSheet
          teamId={team.id}
          teamName={team.name}
          canRotate={teamLinkAccess(team.role).canRotate}
          onClose={() => setLinkOpen(false)}
        />
      )}
    </>
  );
};

export const CalendarScreen: React.FC = () => {
  const shell = useShell();
  const openEvent = useOpenEvent();
  const filter = useTeamFilter();
  // Точки под числами и список дня — только по включённым в фильтре командам.
  const events = React.useMemo(() => shell.events.filter((event) => filter.isShown(event.teamId)), [shell.events, filter]);
  return (
    <CalendarView
      events={events}
      allTeamsHidden={filter.allHidden}
      onShowAllTeams={filter.showAll}
      onEventClick={openEvent}
      onEventLongPress={shell.actions.openRsvpModal}
      onCommitSeries={(seriesId) => void shell.actions.commitSeries(seriesId)}
    />
  );
};

export const MoneyScreen: React.FC = () => {
  const shell = useShell();
  if (!shell.team) return null;
  return (
    <FinanceView
      team={shell.team}
      transactions={shell.transactions}
      members={shell.members}
      currentUserRole={shell.team.role}
      onAddTransaction={shell.actions.addTransaction}
      onRemindDebtor={shell.actions.remindDebtor}
      onRemindAllDebtors={shell.actions.remindAllDebtors}
    />
  );
};

export const RosterScreen: React.FC = () => {
  const shell = useShell();
  const navigate = useNavigate();
  const code = useTeamCode();
  if (!shell.team || !shell.user) return null;
  // Пункты меню команды от треков — строками на экране команды (раньше — в шапке и в листе «Ещё»).
  const extCtx: ShellExtContext = { user: shell.user, team: shell.team, teamCode: code, role: shell.team.role, teams: shell.teams };
  const menuRows = teamScreenRows(
    shellExtensions.teamMenu
      .filter((item) => !item.visible || item.visible(extCtx))
      .map((item) => ({ id: item.id, label: item.label, to: item.to(extCtx) })),
  );
  return (
    <TeamView
      team={shell.team}
      members={shell.members}
      currentUserRole={shell.team.role}
      onMemberClick={(member) => navigate(memberPath(code, member.id))}
      onUpdateMemberStatus={shell.actions.updateMemberStatus}
      onRemoveMember={shell.actions.removeMember}
      currentUserId={shell.user?.id}
      onOpenRequests={() => navigate(teamPath(code, 'requests'))}
      treasury={{
        sub: treasuryRowSub({
          role: shell.team.role,
          budget: shell.team.budget,
          members: shell.members,
          currentUserId: shell.user?.id,
          formatRub,
        }),
        onOpen: () => navigate(teamPath(code, 'money')),
      }}
      menuRows={menuRows.map((row) => ({ id: row.id, label: row.label, icon: row.icon, onOpen: () => navigate(row.to) }))}
    />
  );
};

type MemberSeed = { name: string; nickname: string; avatar?: string; role?: 'CAPTAIN' | 'TRAINER' | 'PLAYER' };

export const MemberScreen: React.FC = () => {
  const shell = useShell();
  const navigate = useNavigate();
  const location = useLocation();
  const code = useTeamCode();
  const { userId } = useParams();
  const goBack = useGoBack(teamPath(code, 'roster'));
  if (!shell.team) return null;

  let member: TeamMember | undefined = shell.members.find((m) => m.id === userId);
  // Участник из явки события, которого нет в загруженном составе: карточка
  // строится из того, что показало событие (как раньше).
  const seed = (location.state as { seed?: MemberSeed } | null)?.seed;
  if (!member && seed && userId) {
    member = {
      id: userId,
      name: seed.name,
      nickname: seed.nickname,
      avatar: seed.avatar,
      role: seed.role === 'CAPTAIN' ? Role.CAPTAIN : seed.role === 'TRAINER' ? Role.TRAINER : Role.PLAYER,
      status: PlayerStatus.ACTIVE,
      balance: 0,
    };
  }
  if (!member) {
    return (
      <NotFoundScreen
        title="Игрок не найден"
        text="Возможно, он больше не в команде."
        actionLabel="К составу"
        onAction={() => navigate(teamPath(code, 'roster'), { replace: true })}
      />
    );
  }
  const canManage = shell.team.role === Role.ADMIN || shell.team.role === Role.CAPTAIN;
  return (
    <PlayerProfileView
      member={member}
      teamName={shell.team.name}
      teamId={shell.team.id}
      onBack={goBack}
      canManage={canManage}
      onUpdateMemberStatus={shell.actions.updateMemberStatus}
      onRemoveMember={async (target) => {
        await shell.actions.removeMember(target);
        navigate(teamPath(code, 'roster'), { replace: true });
      }}
    />
  );
};

export const EventScreen: React.FC = () => {
  const shell = useShell();
  const navigate = useNavigate();
  const code = useTeamCode();
  const { eventId } = useParams();
  const goBack = useGoBack(teamPath(code));
  if (!shell.team) return null;
  const event = shell.events.find((item) => item.id === eventId);
  if (!event) {
    return (
      <NotFoundScreen
        title="Событие не найдено"
        text="Возможно, его удалили или перенесли в другую команду."
        actionLabel="К событиям команды"
        onAction={() => navigate(teamPath(code), { replace: true })}
      />
    );
  }
  const team = shell.team;
  return (
    <EventDetailView
      event={event}
      currentUserRole={event.viewerRole || team.role}
      teamName={resolveEventTeamName(event, shell.teams, team)}
      onBack={goBack}
      onRsvp={(id, status) => shell.actions.rsvp(id, status)}
      currentUserId={shell.user?.id}
      onAddGame={(id, game) => void shell.actions.addGame(id, game)}
      onUpdateGame={shell.actions.updateGame}
      onAttendeeClick={(userId, seed) => navigate(memberPath(code, userId), { state: { seed } })}
      onSendEventReminder={shell.actions.sendEventReminder}
      onOpenMoney={() => navigate(teamPath(code, 'money'))}
      onEditTime={shell.actions.editEventTime}
      onEditEvent={shell.actions.editEvent}
      onDeleteEvent={async (id, scope) => {
        await shell.actions.deleteEvent(id, scope);
        navigate(teamPath(code), { replace: true });
      }}
    />
  );
};

export const NewEventScreen: React.FC = () => {
  const shell = useShell();
  const navigate = useNavigate();
  const code = useTeamCode();
  const goBack = useGoBack(teamPath(code));
  if (!shell.team) return null;
  const createProps = eventCreateViewProps(eventCreateAccess(shell.team.role));
  if (createProps === null) {
    return (
      <NotFoundScreen
        title="Создавать события может капитан"
        text="Попроси капитана или тренера команды."
        actionLabel="К событиям команды"
        onAction={() => navigate(teamPath(code), { replace: true })}
      />
    );
  }
  return (
    <CreateEventView
      onBack={goBack}
      onCreate={async (eventData) => {
        const created = await shell.actions.createEvent(eventData);
        if (created) navigate(teamPath(code), { replace: true });
      }}
      {...createProps}
    />
  );
};

export const ProfileScreen: React.FC = () => {
  const shell = useShell();
  const navigate = useNavigate();
  if (!shell.user || !shell.team) return null;
  return (
    <ProfileView
      user={shell.user}
      onLogout={shell.actions.logout}
      calendarLink={shell.calendarLink || 'Ссылка пока недоступна'}
      onCopyLink={() => void shell.actions.copyIcsLink()}
      onShareLink={() => void shell.actions.shareIcsLink()}
      onDownloadICS={() => void shell.actions.downloadIcs()}
      role={shell.team.role}
      canEnterAdmin={shell.canEnterAdmin}
      onEnterAdmin={() => navigate('/admin')}
      guestBookings={<GuestBookingsBlock />}
      teams={shell.teams}
      onOpenTeam={(t) => navigate(teamPath(teamCodeOf({ teamId: t.teamId, shortCode: t.shortCode })))}
    />
  );
};
