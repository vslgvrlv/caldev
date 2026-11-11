import React from 'react';
import { Button, Feed, Glass, Icon, Screen, TeamMark, teamMarkSvg, teamPaint, type FeedItem, type FeedType } from '../ui';
import { Event, RSVPStatus, TeamContext } from '../types';
import { EVENT_LABELS } from '../constants';
import { canCommitToSeries, type CaptainHomeHints } from '../lib/events';
import { eventTeamCode, resolveEventTeamName } from '../lib/event-team';
import {
  answerStatus,
  attendanceDots,
  attendanceText,
  awaitingCount,
  awaitingText,
  visibleFeedEvents,
  dayHeading,
  endLabel,
  eventSubline,
  eventTypeIcon,
  feedTitle,
  groupEventsByDay,
  heroDateLabel,
  homePaints,
  needsAnswer,
  pickHomeEvents,
  timeLabel,
  type DayGroup,
} from '../lib/home-feed';
import { canAnswerRsvp } from '../lib/rsvp';
import { eventPath } from '../lib/team-url';
import '../shell/home.css';

interface DashboardProps {
  /** Команды человека: по ним подписываем, чьё событие в общей ленте. */
  teams: TeamContext[];
  events: Event[];
  /** Шапка экрана (`HomeHeader`): живёт внутри экрана, потому что краски фона задаёт он. */
  header?: React.ReactNode;
  /** Команда, чья это главная: знак на подсказках капитану. */
  currentTeam?: { id: string; name: string; shortCode?: string } | null;
  onRsvp: (id: string, status: RSVPStatus) => void;
  onEventClick: (event: Event) => void;
  onEventLongPress: (event: Event) => void;
  onCommitSeries: (seriesId: string) => void;
  /** Подсказки капитану новой команды (`captainHomeHints`). */
  captainHints?: CaptainHomeHints;
  /** «Позови команду» — открывает лист ссылки команды. */
  onInviteTeam?: () => void;
  /** «Создай первое событие» — экран нового события. */
  onCreateEvent?: () => void;
  /** Карточки «Ты записан гостем» — между ближайшим событием и лентой. */
  guestBookings?: React.ReactNode;
  /** Текущее время для тестов и снимков; по умолчанию часы устройства. */
  nowOverride?: number;
}

const LONG_PRESS_MS = 600;
const FEED_TYPES: Record<string, FeedType> = { event: { icon: 'calendar' } };

/** Долгое нажатие по строкам: открывает окно ответа; следующий за ним тап строку не открывает. */
function useRowPress(find: (el: Element) => Event | undefined, onOpen: (e: Event) => void, onLong: (e: Event) => void) {
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = React.useRef(false);
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  React.useEffect(() => stop, []);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      fired.current = false;
      const event = find(e.target as Element);
      if (!event) return;
      stop();
      timer.current = setTimeout(() => {
        fired.current = true;
        if (canAnswerRsvp(event)) {
          if (navigator.vibrate) navigator.vibrate(50);
          onLong(event);
        }
      }, LONG_PRESS_MS);
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerMove: stop,
    onPointerCancel: stop,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onClick: (e: React.MouseEvent) => {
      const event = find(e.target as Element);
      if (!event) return;
      e.preventDefault();
      if (fired.current) {
        fired.current = false;
        return;
      }
      onOpen(event);
    },
  };
}

const HeroCount: React.FC<{ event: Event }> = ({ event }) => {
  const dots = attendanceDots(event.attendeesCount, event.maxAttendees);
  let index = 0;
  return (
    <Glass layer={2} className="pbth-hero__count">
      {dots.groups.length > 0 && (
        <span className="pbth-hero__dots" aria-hidden="true">
          {dots.groups.map((size, g) => (
            <span key={g} className="pbth-hero__dotgroup">
              {Array.from({ length: size }, () => {
                const on = index < dots.filled;
                index += 1;
                return <span key={index} className={`pbth-hero__dot${on ? ' is-on' : ''}`} />;
              })}
            </span>
          ))}
        </span>
      )}
      <span className="pbth-hero__counttext">{attendanceText(event.attendeesCount, event.maxAttendees)}</span>
    </Glass>
  );
};

const priceText = (cost?: number): string => {
  const value = Math.round(Number(cost) || 0);
  return value > 0 ? `${String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₽` : '';
};

const Hero: React.FC<{
  event: Event;
  now: number;
  teamName: string;
  onRsvp: DashboardProps['onRsvp'];
  press: ReturnType<typeof useRowPress>;
  onOpen: (event: Event) => void;
}> = ({ event, now, teamName, onRsvp, press, onOpen }) => {
  const canAnswer = canAnswerRsvp(event);
  const until = endLabel(event);
  const place = [(event.location || '').trim(), priceText(event.cost)].filter(Boolean).join(' · ');
  const typeLabel = EVENT_LABELS[event.type] ?? '';
  const showName = event.title && event.title.trim().toLowerCase() !== typeLabel.toLowerCase();
  const going = event.rsvpStatus === RSVPStatus.CONFIRMED;
  const declined = event.rsvpStatus === RSVPStatus.DECLINED;
  return (
    <Glass as="section" className="pbth-hero" aria-label="Ближайшее событие">
      <div
        className="pbth-hero__head"
        role="link"
        tabIndex={0}
        data-hero="1"
        onPointerDown={(e) => press.onPointerDown(e)}
        onPointerUp={press.onPointerUp}
        onPointerLeave={press.onPointerLeave}
        onPointerMove={press.onPointerMove}
        onPointerCancel={press.onPointerCancel}
        onContextMenu={press.onContextMenu}
        onClick={press.onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onOpen(event);
        }}
      >
        <TeamMark teamId={event.teamId} name={teamName} code={event.teamShortCode} size={64} />
        <div className="pbth-hero__titles">
          <div className="pbth-hero__kind">
            <Icon name={eventTypeIcon(event.type)} size={20} />
            <span>
              {typeLabel}
              {teamName ? ` · ${teamName}` : ''}
            </span>
          </div>
          {showName && <div className="pbth-hero__name">{event.title}</div>}
          <div className="pbth-hero__date">{heroDateLabel(event, now)}</div>
        </div>
      </div>
      <div className="pbth-hero__when">
        <span className="pbth-hero__time">{timeLabel(event.startDate)}</span>
        {until && <span className="pbth-hero__until">{until}</span>}
      </div>
      {place && (
        <div className="pbth-hero__place">
          <Icon name="map-pin" size={20} />
          <span>{place}</span>
        </div>
      )}
      <div style={{ ['--pbth-paint' as string]: teamPaint(event.teamId) }}>
        <HeroCount event={event} />
      </div>
      {canAnswer && needsAnswer(event) && (
        <div className="pbth-hero__actions">
          <Button variant="primary" icon="check" onClick={() => onRsvp(event.id, RSVPStatus.CONFIRMED)}>
            Иду
          </Button>
          <Button variant="glass2" onClick={() => onRsvp(event.id, RSVPStatus.DECLINED)}>
            Не иду
          </Button>
        </div>
      )}
      {canAnswer && (going || declined) && (
        <div className="pbth-hero__answered">
          <span className={`pbth-hero__answer ${going ? 'is-yes' : 'is-no'}`}>
            <Icon name={going ? 'check' : 'x'} size={20} />
            {going ? 'Ты идёшь' : 'Ты не идёшь'}
          </span>
          <Button variant="glass2" onClick={() => onRsvp(event.id, RSVPStatus.UNANSWERED)}>
            Передумал
          </Button>
        </div>
      )}
    </Glass>
  );
};

const Note: React.FC<{
  mark?: React.ReactNode;
  title: string;
  text: string;
  action: { label: string; icon: string; onClick: () => void };
}> = ({ mark, title, text, action }) => (
  <Glass as="section" className="pbth-note">
    {mark}
    <div className="pbth-note__main">
      <div className="pbth-note__title">{title}</div>
      <div className="pbth-note__text">{text}</div>
      <div className="pbth-note__actions">
        <Button size="sm" icon={action.icon} onClick={action.onClick}>
          {action.label}
        </Button>
      </div>
    </div>
  </Glass>
);

const DayPanel: React.FC<{
  group: DayGroup;
  now: number;
  teams: TeamContext[];
  multi: boolean;
  currentCode: string;
  onRsvp: DashboardProps['onRsvp'];
  onCommitSeries: DashboardProps['onCommitSeries'];
  onOpen: (event: Event) => void;
  onLong: (event: Event) => void;
}> = ({ group, now, teams, multi, currentCode, onRsvp, onCommitSeries, onOpen, onLong }) => {
  const heading = dayHeading(group.date, now, group.events.length);
  // Колбэки экрана меняются на каждый рендер; лента перерисовывается только от данных.
  const callbacks = React.useRef({ onRsvp, onCommitSeries });
  callbacks.current = { onRsvp, onCommitSeries };
  const byHref = React.useMemo(() => {
    const map = new Map<string, Event>();
    const items: FeedItem[] = group.events.map((event) => {
      const code = eventTeamCode(event, teams, currentCode);
      const href = eventPath(code, event.id);
      map.set(href, event);
      const teamName = resolveEventTeamName(event, teams, null);
      const actions: NonNullable<FeedItem['actions']> = [];
      if (canAnswerRsvp(event) && needsAnswer(event)) {
        actions.push({ label: 'Иду', onClick: () => callbacks.current.onRsvp(event.id, RSVPStatus.CONFIRMED) });
        actions.push({ label: 'Не иду', onClick: () => callbacks.current.onRsvp(event.id, RSVPStatus.DECLINED) });
      }
      if (canAnswerRsvp(event) && canCommitToSeries(event)) {
        actions.push({ label: 'Иду на серию', onClick: () => callbacks.current.onCommitSeries(event.seriesId!) });
      }
      return {
        id: event.id,
        type: 'event',
        at: event.startDate.toISOString(),
        title: feedTitle(event, teamName, multi),
        sub: eventSubline(event),
        href,
        lead: teamMarkSvg({ teamId: event.teamId, name: teamName, code: event.teamShortCode, size: 40 }),
        timeDisplay: timeLabel(event.startDate),
        status: answerStatus(event) ?? undefined,
        actions: actions.length ? actions : undefined,
      };
    });
    return { map, items };
  }, [group.events, teams, multi, currentCode]);

  const press = useRowPress(
    (el) => {
      const a = el.closest?.('a.ui-feed__row');
      return a ? byHref.map.get(a.getAttribute('href') || '') : undefined;
    },
    onOpen,
    onLong,
  );

  return (
    <section className="pbth-day">
      <div className="pbth-day__head">
        <h2 className="pbth-day__title">{heading.title}</h2>
        <span className="pbth-day__sub">{heading.sub}</span>
      </div>
      <div className="pbth-day__list" {...press}>
        <Feed types={FEED_TYPES} items={byHref.items} order="asc" limit={100} />
      </div>
    </section>
  );
};

/** Главная: ближайшее событие крупно, ниже события всех команд игрока по дням. */
export const Dashboard: React.FC<DashboardProps> = ({
  teams,
  events,
  header,
  currentTeam,
  onRsvp,
  onEventClick,
  onEventLongPress,
  onCommitSeries,
  captainHints,
  onInviteTeam,
  onCreateEvent,
  guestBookings,
  nowOverride,
}) => {
  const [tick, setTick] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (nowOverride != null) return;
    const id = window.setInterval(() => setTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [nowOverride]);
  const now = nowOverride ?? tick;

  const { hero, rest } = React.useMemo(() => pickHomeEvents(events, now), [events, now]);
  const [onlyAwaiting, setOnlyAwaiting] = React.useState(false);
  const awaiting = awaitingCount(rest);
  // Когда ждущих ответа не осталось, лента сама возвращается ко всем событиям.
  const filtering = onlyAwaiting && awaiting > 0;
  const days = React.useMemo(() => groupEventsByDay(visibleFeedEvents(rest, filtering)), [rest, filtering]);
  const paints = React.useMemo(() => homePaints(hero ? [hero, ...rest] : rest, teamPaint), [hero, rest]);
  const multi = teams.length > 1;
  const showInvite = Boolean(captainHints?.inviteTeam && onInviteTeam);
  const showCreateEvent = Boolean(captainHints?.createFirstEvent && onCreateEvent);
  const currentCode = (currentTeam?.shortCode || currentTeam?.id || '').toLowerCase();
  const homeMark = currentTeam ? (
    <TeamMark teamId={currentTeam.id} name={currentTeam.name} code={currentTeam.shortCode} size={40} />
  ) : null;

  const findHero = React.useCallback((el: Element) => (el.closest?.('[data-hero]') && hero ? hero : undefined), [hero]);
  const heroPress = useRowPress(findHero, onEventClick, onEventLongPress);

  return (
    <Screen paints={paints}>
      <div className="pbth-home">
        {header}

        {hero && (
          <Hero
            event={hero}
            now={now}
            teamName={resolveEventTeamName(hero, teams, null)}
            onRsvp={onRsvp}
            press={heroPress}
            onOpen={onEventClick}
          />
        )}

        {awaiting > 0 && (
          <Glass as="section" className="pbth-awaiting">
            <span className="pbth-awaiting__text">{awaitingText(awaiting)}</span>
            <Button size="sm" onClick={() => setOnlyAwaiting(!filtering)}>
              {filtering ? 'Показать все' : 'Показать'}
            </Button>
          </Glass>
        )}

        {guestBookings}

        {/* Подсказки капитану новой команды: исчезают, когда условие выполнено. */}
        {showInvite && (
          <Note
            mark={homeMark}
            title="Позови команду"
            text="Пока в команде только ты. Отправь ребятам ссылку команды — заявки придут тебе."
            action={{ label: 'Пригласить', icon: 'user-plus', onClick: onInviteTeam! }}
          />
        )}
        {showCreateEvent && (
          <Note
            mark={homeMark}
            title="Создай первое событие"
            text="Тренировка или игра — команда увидит её здесь и ответит на явку."
            action={{ label: 'Создать событие', icon: 'plus', onClick: onCreateEvent! }}
          />
        )}

        {days.map((group) => (
          <DayPanel
            key={group.key}
            group={group}
            now={now}
            teams={teams}
            multi={multi}
            currentCode={currentCode}
            onRsvp={onRsvp}
            onCommitSeries={onCommitSeries}
            onOpen={onEventClick}
            onLong={onEventLongPress}
          />
        ))}

        {!hero && !showCreateEvent && (
          <Glass as="section" className="pbth-empty">
            <div className="pbth-empty__title">Событий нет</div>
            <div className="pbth-empty__text">Когда в твоих командах появятся события, они будут здесь.</div>
          </Glass>
        )}
      </div>
    </Screen>
  );
};
