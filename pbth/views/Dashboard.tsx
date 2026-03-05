import React from 'react';
import { User, Event, Team, RSVPStatus } from '../types';
import { EventCard } from '../components/EventCard';
import { Bell, ChevronDown } from 'lucide-react';
import { EVENT_COLORS, EVENT_LABELS } from '../constants';
import { filterUpcomingAndOngoingEvents, getCountdownParts, getEventEndTimestamp, isEventOngoing } from '../lib/events';

interface DashboardProps {
  user: User;
  activeTeam: Team;
  events: Event[];
  onRsvp: (id: string, status: RSVPStatus) => void;
  onEventClick: (event: Event) => void;
  onEventLongPress: (event: Event) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ user, activeTeam, events, onRsvp, onEventClick, onEventLongPress }) => {
  const [nowTs, setNowTs] = React.useState(() => Date.now());

  React.useEffect(() => {
    const id = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const activeTimelineEvents = React.useMemo(() => filterUpcomingAndOngoingEvents(events, nowTs), [events, nowTs]);

  const nextEvent = activeTimelineEvents[0] || null;
  const nextEventIsOngoing = nextEvent ? isEventOngoing(nextEvent, nowTs) : false;
  const pendingEvents = activeTimelineEvents.filter((e) => e.rsvpStatus === RSVPStatus.PENDING || e.rsvpStatus === RSVPStatus.UNANSWERED);
  const upcomingEvents = activeTimelineEvents
    .filter((e) => e.rsvpStatus !== RSVPStatus.PENDING && e.rsvpStatus !== RSVPStatus.UNANSWERED)
    .slice(0, 3);

  const timeLeft = React.useMemo(() => {
    if (!nextEvent) return { days: '00', hours: '00', mins: '00' };
    const targetDate = nextEventIsOngoing ? new Date(getEventEndTimestamp(nextEvent)) : nextEvent.startDate;
    return getCountdownParts(targetDate, nowTs);
  }, [nextEvent, nextEventIsOngoing, nowTs]);

  return (
    <div className="pb-24 pt-4 px-4 space-y-6 animate-fade-in">
      {/* Header */}
      <header className="flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pb-primary to-blue-500 p-[2px]">
             <img 
               src={user.avatar || `https://ui-avatars.com/api/?name=${user.name}&background=0F0F0F&color=fff`} 
               alt="avatar" 
               className="w-full h-full rounded-full object-cover border-2 border-pb-background"
             />
          </div>
          <div>
            <div className="flex items-center space-x-1 text-pb-subtext text-xs uppercase tracking-wide">
              <span>{activeTeam.shortCode}</span>
              <span className="w-1 h-1 bg-pb-primary rounded-full"></span>
              <span>{activeTeam.role}</span>
            </div>
            <div className="flex items-center text-white font-bold text-lg">
              {activeTeam.name} <ChevronDown size={16} className="ml-1 text-pb-subtext" />
            </div>
          </div>
        </div>
        <button className="relative p-2 rounded-full bg-pb-surface hover:bg-white/10">
          <Bell size={20} className="text-white" />
          <span className="absolute top-2 right-2 w-2 h-2 bg-pb-danger rounded-full border border-pb-surface"></span>
        </button>
      </header>

      {/* Next Event Banner */}
      {nextEvent && (
        <section>
           <div 
             onClick={() => onEventClick(nextEvent)}
             className="bg-gradient-to-r from-pb-surface to-[#16213E] rounded-3xl p-6 border border-white/5 relative overflow-hidden cursor-pointer active:scale-[0.98] transition-transform"
           >
              <div className="absolute top-0 right-0 -mt-4 -mr-4 w-32 h-32 bg-pb-primary/10 rounded-full blur-3xl"></div>
              
              <span className="text-pb-primary text-xs font-bold uppercase tracking-wider mb-2 block">
                {nextEventIsOngoing ? 'Текущее событие' : 'Ближайшее событие'}
              </span>
              <span
                className="inline-flex mb-2 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide bg-black/30 border border-white/10"
                style={{ color: EVENT_COLORS[nextEvent.type] }}
              >
                {EVENT_LABELS[nextEvent.type]}
              </span>
              <h1 className="text-2xl font-black text-white mb-1 leading-tight">{nextEvent.title}</h1>
              <p className="text-pb-subtext mb-4">{nextEvent.location || 'Место не указано'}</p>

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
                  onEventClick(nextEvent);
                }}
                className="w-full bg-pb-primary text-pb-background font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors"
              >
                Подробнее
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
              />
            ))}
          </div>
        </section>
      )}

      {/* Upcoming */}
      <section>
         <h2 className="text-lg font-bold text-white mb-3">На этой неделе</h2>
         <div className="space-y-3">
            {upcomingEvents.length === 0 && <p className="text-pb-subtext text-sm">Событий нет</p>}
            {upcomingEvents.map(event => (
              <EventCard 
                key={event.id} 
                event={event} 
                compact 
                onClick={onEventClick}
                onLongPress={onEventLongPress}
              />
            ))}
         </div>
      </section>
    </div>
  );
};
