import React from 'react';
import { Plus, UserPlus } from 'lucide-react';
import { Event, RSVPStatus, TeamContext } from '../types';
import { EventCard } from '../components/EventCard';
import { EVENT_COLORS, EVENT_LABELS } from '../constants';
import {
  buildDashboardEventSections,
  countdownLabels,
  getCountdownParts,
  getEventEndTimestamp,
  showUpcomingSection,
  type CaptainHomeHints,
} from '../lib/events';

interface DashboardProps {
  /** Команды человека: по ним подписываем, чьё событие в общей ленте. */
  teams: TeamContext[];
  events: Event[];
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
  /** Карточки «Ты записан гостем» — вверху главной. */
  guestBookings?: React.ReactNode;
}

// Шапка с переключателем команд — в общей оболочке (pbth/components/shell/TeamHeader.tsx).
// Лента общая по всем командам человека, поэтому у карточек подписана команда.
export const Dashboard: React.FC<DashboardProps> = ({
  teams,
  events,
  onRsvp,
  onEventClick,
  onEventLongPress,
  onCommitSeries,
  captainHints,
  onInviteTeam,
  onCreateEvent,
  guestBookings,
}) => {
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
  const timeLabels = countdownLabels(timeLeft);
  const showInvite = Boolean(captainHints?.inviteTeam && onInviteTeam);
  const showCreateEvent = Boolean(captainHints?.createFirstEvent && onCreateEvent);

  return (
    <div
      className="pb-24 px-4 space-y-6 animate-fade-in"
      style={{ paddingTop: 'calc(var(--pb-safe-top) + 1rem)' }}
    >
      {guestBookings}

      {/* Подсказки капитану новой команды: исчезают, когда условие выполнено. */}
      {(showInvite || showCreateEvent) && (
        <section className="space-y-3">
          {showInvite && (
            <div className="bg-pb-surface rounded-2xl border border-white/5 p-4">
              <h2 className="text-lg font-bold text-white mb-1">Позови команду</h2>
              <p className="text-pb-subtext text-sm mb-3">Пока в команде только ты. Отправь ребятам ссылку команды — заявки придут тебе.</p>
              <button
                onClick={onInviteTeam}
                className="w-full bg-pb-primary text-pb-background font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors flex items-center justify-center gap-2"
              >
                <UserPlus size={18} />
                Пригласить
              </button>
            </div>
          )}
          {showCreateEvent && (
            <div className="bg-pb-surface rounded-2xl border border-white/5 p-4">
              <h2 className="text-lg font-bold text-white mb-1">Создай первое событие</h2>
              <p className="text-pb-subtext text-sm mb-3">Тренировка или игра — команда увидит её здесь и ответит на явку.</p>
              <button
                onClick={onCreateEvent}
                className="w-full bg-white/10 hover:bg-white/20 text-white font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <Plus size={18} />
                Создать событие
              </button>
            </div>
          )}
        </section>
      )}

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
                   <span className="text-[10px] text-pb-subtext block uppercase">{timeLabels.days}</span>
                </div>
                <div className="text-2xl font-mono font-bold text-white/20">:</div>
                <div>
                   <span className="text-2xl font-mono font-bold text-white">{timeLeft.hours}</span>
                   <span className="text-[10px] text-pb-subtext block uppercase">{timeLabels.hours}</span>
                </div>
                <div className="text-2xl font-mono font-bold text-white/20">:</div>
                 <div>
                   <span className="text-2xl font-mono font-bold text-white">{timeLeft.mins}</span>
                   <span className="text-[10px] text-pb-subtext block uppercase">{timeLabels.mins}</span>
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

      {/* Upcoming: если других событий нет, а главное уже наверху — блока нет. */}
      {showUpcomingSection(dashboardSections) && (
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
      )}
    </div>
  );
};
