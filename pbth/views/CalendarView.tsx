import React from 'react';
import { useParams } from 'react-router-dom';
import { Feed, Glass, Month, Screen, teamMarkSvg, teamPaint, type FeedItem, type FeedType } from '../ui';
import { Event } from '../types';
import { useShell } from '../shell/context';
import { canCommitToSeries } from '../lib/events';
import { eventTeamCode, resolveEventTeamName } from '../lib/event-team';
import { answerStatus, eventSubline, feedTitle, timeLabel } from '../lib/home-feed';
import { calendarDayHeading, calendarMarks, dayForMonth, eventsOfDay, isoOfDate, monthCaption, parseIso } from '../lib/calendar-days';
import { canAnswerRsvp } from '../lib/rsvp';
import { eventPath } from '../lib/team-url';
import { useRowPress } from './Dashboard';
import { useSectionSubtitle } from '../shell/section-subtitle';
import '../shell/home.css';
import './calendar-view.css';

interface CalendarViewProps {
  /** События всех команд игрока (`shell.events`). */
  events: Event[];
  onEventClick: (event: Event) => void;
  onEventLongPress: (event: Event) => void;
  onCommitSeries: (seriesId: string) => void;
  /** Текущее время для тестов и снимков; по умолчанию часы устройства. */
  nowOverride?: number;
}

const FEED_TYPES: Record<string, FeedType> = { event: { icon: 'calendar' } };

/** Отметка ответа справа: «думаю» — просто приглушённое слово, без значка. */
function calendarStatus(event: Event): FeedItem['status'] {
  const status = answerStatus(event);
  if (!status) return undefined;
  return status.text === 'думаю' ? { text: status.text, tone: status.tone } : status;
}

/** События выбранного дня одной стеклянной лентой: знак команды, название, время, отметка ответа. */
const DayEvents: React.FC<{
  events: Event[];
  onOpen: (event: Event) => void;
  onLong: (event: Event) => void;
  onCommitSeries: (seriesId: string) => void;
}> = ({ events, onOpen, onLong, onCommitSeries }) => {
  const shell = useShell();
  const { team: teamParam } = useParams();
  const currentCode = String(teamParam || '').toLowerCase();
  const teams = shell.teams;
  const multi = teams.length > 1;
  const commit = React.useRef(onCommitSeries);
  commit.current = onCommitSeries;

  const { map, items } = React.useMemo(() => {
    const byHref = new Map<string, Event>();
    const list: FeedItem[] = events.map((event) => {
      const href = eventPath(eventTeamCode(event, teams, currentCode), event.id);
      byHref.set(href, event);
      const teamName = resolveEventTeamName(event, teams, null);
      const actions: NonNullable<FeedItem['actions']> = [];
      if (canAnswerRsvp(event) && canCommitToSeries(event)) {
        actions.push({ label: 'Иду на серию', onClick: () => commit.current(event.seriesId!) });
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
        status: calendarStatus(event),
        actions: actions.length ? actions : undefined,
      };
    });
    return { map: byHref, items: list };
  }, [events, teams, multi, currentCode]);

  const press = useRowPress(
    (el) => {
      const a = el.closest?.('a.ui-feed__row');
      return a ? map.get(a.getAttribute('href') || '') : undefined;
    },
    onOpen,
    onLong,
  );

  return (
    <div className="pbth-day__list" {...press}>
      <Feed types={FEED_TYPES} items={items} order="asc" limit={100} />
    </div>
  );
};

/** Календарь: сетка месяца со знаками команд-красок, под ней события выбранного дня. */
export const CalendarView: React.FC<CalendarViewProps> = ({
  events,
  onEventClick,
  onEventLongPress,
  onCommitSeries,
  nowOverride,
}) => {
  const now = React.useMemo(() => nowOverride ?? Date.now(), [nowOverride]);
  const todayIso = isoOfDate(new Date(now));
  const [shown, setShown] = React.useState(() => ({ year: new Date(now).getFullYear(), month: new Date(now).getMonth() + 1 }));
  const [selected, setSelected] = React.useState(todayIso);

  const marks = React.useMemo(() => calendarMarks(events, teamPaint), [events]);
  // Шапка раздела и фон — оболочки; подпись шапки следует за показанным месяцем.
  useSectionSubtitle(monthCaption(shown.year, shown.month));
  const dayEvents = React.useMemo(() => eventsOfDay(events, selected), [events, selected]);
  const heading = calendarDayHeading(parseIso(selected) ?? new Date(now), dayEvents.length);

  // Сетка при тапе по дню соседнего месяца сначала сообщает о смене месяца, потом о выборе дня: выбор побеждает.
  const onNav = React.useCallback(
    (to: { year: number; month: number }) => {
      setShown(to);
      setSelected(dayForMonth(events, to.year, to.month, todayIso));
    },
    [events, todayIso],
  );

  return (
    <Screen>
      <div className="pbth-home">
        <Glass as="section" className="pbth-cal" aria-label="Календарь">
          <Month
            year={shown.year}
            month={shown.month}
            today={todayIso}
            selected={selected}
            marks={marks}
            onSelect={setSelected}
            onNav={onNav}
          />
        </Glass>

        <section className="pbth-day pbth-calday">
          <div className="pbth-day__head">
            <h2 className="pbth-day__title">{heading.title}</h2>
            <span className="pbth-day__sub">{heading.sub}</span>
          </div>
          {dayEvents.length === 0 ? (
            <Glass as="div" className="pbth-empty">
              <div className="pbth-empty__text">В этот день событий нет</div>
            </Glass>
          ) : (
            <DayEvents events={dayEvents} onOpen={onEventClick} onLong={onEventLongPress} onCommitSeries={onCommitSeries} />
          )}
        </section>
      </div>
    </Screen>
  );
};
