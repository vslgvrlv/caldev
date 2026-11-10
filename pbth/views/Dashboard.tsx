import React from 'react';
import { Event, RSVPStatus, TeamContext } from '../types';
import { EventCard } from '../components/EventCard';
import { EVENT_COLORS, EVENT_LABELS } from '../constants';
import { buildDashboardEventSections, getCountdownParts, getEventEndTimestamp } from '../lib/events';

interface DashboardProps {
  /** Команды человека: по ним подписываем, чьё событие в общей ленте. */
  teams: TeamContext[];
  events: Event[];
  onRsvp: (id: string, status: RSVPStatus) => void;
  onEventClick: (event: Event) => void;
  onEventLongPress: (event: Event) => void;
  onCommitSeries: (seriesId: string) => void;
}

// Шапка с переключателем команд — в общей оболочке (pbth/components/shell/TeamHeader.tsx).
// Лента общая по всем командам человека, поэтому у карточек подписана команда.
export const Dashboard: React.FC<DashboardProps> = ({ teams, events, onRsvp, onEventClick, onEventLongPress, onCommitSeries }) => {
  const [nowTs, setNowTs] = React.useState(() => Date.now());
  const hasMultipleTeams = teams.length > 1;
  const teamLabelOf = (event: Event): string | undefined => {
    if (!hasMultipleTeams) return undefined;
    return event.teamName || teams.find((t) => t.teamId === event.teamId)?.teamName || undefined;
  };

  React.useEffect(() => {
    const id = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const dashboardSections = React.useMemo(() => buildDashboardEventSections(events, nowTs), [events, nowTs]);
  const heroEvent = dashboardSections.heroEvent;
  const heroEventIsOngoing = dashboardSections.heroEventIsOngoing;
  const heroEventNeedsResponse = dashboardSections.heroEventNeedsResponse;
  const pendingEvents = dashboardSections.pendingEvents;
  const upcomingEvents = dashboardSections.upcomingEvents;

  const timeLeft = React.useMemo(() => {
    if (!heroEvent) return { days: '00', hours: '00', mins: '00' };
    const targetDate = heroEventIsOngoing ? new Date(getEventEndTimestamp(heroEvent)) : heroEvent.startDate;
    return getCountdownParts(targetDate, nowTs);
  }, [heroEvent, heroEventIsOngoing, nowTs]);

  return (
    <div
      className="pb-24 px-4 space-y-6 animate-fade-in"
      style={{ paddingTop: 'calc(var(--pb-safe-top) + 1rem)' }}
    >
      {/* Next Event Banner */}
      {heroEvent && (
        <section>
           <div 
             onClick={() => onEventClick(heroEvent)}
             className="bg-gradient-to-r from-pb-surface to-[#16213E] rounded-3xl p-6 border border-white/5 relative overflow-hidden cursor-pointer active:scale-[0.98] transition-transform"
           >
              <div className="absolute top-0 right-0 -mt-4 -mr-4 w-32 h-32 bg-pb-primary/10 rounded-full blur-3xl"></div>
              
              <span className="text-pb-primary text-xs font-bold uppercase tracking-wider mb-2 block">
                {heroEventIsOngoing ? 'Текущее событие' : 'Ближайшее событие'}
                {teamLabelOf(heroEvent) ? ` · ${teamLabelOf(heroEvent)}` : ''}
              </span>
              <span
                className="inline-flex mb-2 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide bg-black/30 border border-white/10"
                style={{ color: EVENT_COLORS[heroEvent.type] }}
              >
                {EVENT_LABELS[heroEvent.type]}
              </span>
              <h1 className="text-2xl font-black text-white mb-1 leading-tight">{heroEvent.title}</h1>
              <p className="text-pb-subtext mb-3">{heroEvent.location || 'Место не указано'}</p>

              {heroEventNeedsResponse && (
                <div className="inline-flex mb-4 px-3 py-1 rounded-full text-[11px] font-semibold text-pb-warning bg-pb-warning/10 border border-pb-warning/20">
                  Ждет ответа
                </div>
              )}

              <div className="flex space-x-4 mb-4">
                <div>
                   <span className="text-2xl font-mono font-bold text-white">{timeLeft.days}</span>
                   <span className="text-[10px] text-pb-subtext block uppercase">Дня</span>
                </div>
                <div className="text-2xl font-mono font-bold text-white/20">:</div>
                <div>
                   <span className="text-2xl font-mono font-bold text-white">{timeLeft.hours}</span>
                   <span className="text-[10px] text-pb-subtext block uppercase">Часов</span>
                </div>
                <div className="text-2xl font-mono font-bold text-white/20">:</div>
                 <div>
                   <span className="text-2xl font-mono font-bold text-white">{timeLeft.mins}</span>
                   <span className="text-[10px] text-pb-subtext block uppercase">Мин</span>
                </div>
              </div>

              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  onEventClick(heroEvent);
                }}
                className="w-full bg-pb-primary text-pb-background font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors"
              >
                {heroEventNeedsResponse ? 'Открыть и ответить' : 'Подробнее'}
              </button>
           </div>
        </section>
      )}

      {/* Action Required */}
      {pendingEvents.length > 0 && (
        <section>
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-lg font-bold text-white">Требуют ответа</h2>
            <span className="bg-pb-warning/20 text-pb-warning text-xs font-bold px-2 py-1 rounded-md">{pendingEvents.length}</span>
          </div>
          <div className="space-y-3">
            {pendingEvents.map(event => (
              <EventCard
                key={event.id}
                event={event}
                onRsvp={onRsvp}
                onClick={onEventClick}
                onLongPress={onEventLongPress}
                onCommitSeries={onCommitSeries}
                teamLabel={teamLabelOf(event)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Upcoming */}
      <section>
         <h2 className="text-lg font-bold text-white mb-3">Ближайшие</h2>
         <div className="space-y-3">
            {upcomingEvents.length === 0 && <p className="text-pb-subtext text-sm">Событий нет</p>}
            {upcomingEvents.map(event => (
              <EventCard
                key={event.id}
                event={event}
                compact
                onClick={onEventClick}
                onLongPress={onEventLongPress}
                onCommitSeries={onCommitSeries}
                teamLabel={teamLabelOf(event)}
              />
            ))}
         </div>
      </section>
    </div>
  );
};
