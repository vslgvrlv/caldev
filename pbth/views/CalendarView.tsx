import React, { useState } from 'react';
import { Event } from '../types';
import { EVENT_COLORS } from '../constants';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths, isToday, getISODay, addDays } from 'date-fns';
import { ru } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { EventCard } from '../components/EventCard';
import { sortEventsByStart } from '../lib/events';

interface CalendarViewProps {
  events: Event[];
  onEventClick: (event: Event) => void;
  onEventLongPress: (event: Event) => void;
}

export const CalendarView: React.FC<CalendarViewProps> = ({ events, onEventClick, onEventLongPress }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const monthDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const leadPadding = getISODay(monthStart) - 1;
  const trailPadding = (7 - ((leadPadding + monthDays.length) % 7)) % 7;
  const gridDays = [
    ...Array.from({ length: leadPadding }, (_, idx) => addDays(monthStart, -(leadPadding - idx))),
    ...monthDays,
    ...Array.from({ length: trailPadding }, (_, idx) => addDays(monthEnd, idx + 1)),
  ];

  // Get events for the selected date
  const selectedEvents = sortEventsByStart(events.filter(e => isSameDay(e.startDate, selectedDate)));

  const nextMonth = () => setCurrentDate(addMonths(currentDate, 1));
  const prevMonth = () => setCurrentDate(subMonths(currentDate, 1));

  return (
    <div className="pb-24 pt-4 px-4 h-full flex flex-col">
      <h1 className="text-2xl font-bold text-white mb-6">Календарь</h1>

      {/* Month Navigation */}
      <div className="flex justify-between items-center mb-6 bg-pb-surface p-2 rounded-xl border border-white/5">
        <button onClick={prevMonth} className="p-2 hover:bg-white/10 rounded-lg text-white">
          <ChevronLeft size={20} />
        </button>
        <span className="text-lg font-bold capitalize text-white">
          {format(currentDate, 'LLLL yyyy', { locale: ru })}
        </span>
        <button onClick={nextMonth} className="p-2 hover:bg-white/10 rounded-lg text-white">
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-1 mb-6">
        {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => (
          <div key={day} className="text-center text-pb-subtext text-xs font-medium py-2">
            {day}
          </div>
        ))}
        
        {gridDays.map((day) => {
           const dayEvents = events.filter(e => isSameDay(e.startDate, day));
           const isSelected = isSameDay(day, selectedDate);
           const isCurrentDay = isToday(day);
           const isCurrentMonth = day.getMonth() === currentDate.getMonth();

           return (
             <button
                key={day.toString()}
                onClick={() => setSelectedDate(day)}
                className={`
                  h-12 rounded-xl flex flex-col items-center justify-center relative transition-colors
                  ${isSelected ? 'bg-pb-primary text-pb-background font-bold shadow-lg shadow-green-500/20' : 'bg-pb-surface/50 text-white hover:bg-pb-surface'}
                  ${isCurrentDay && !isSelected ? 'border border-pb-primary text-pb-primary' : ''}
                  ${!isCurrentMonth ? 'opacity-45' : ''}
                `}
             >
               <span className="text-sm">{format(day, 'd')}</span>
               
               {/* Event Dots */}
               <div className="flex space-x-0.5 mt-1">
                 {dayEvents.slice(0, 3).map((e, i) => (
                   <div 
                    key={i} 
                    className="w-1 h-1 rounded-full" 
                    style={{ backgroundColor: EVENT_COLORS[e.type] }}
                   />
                 ))}
               </div>
             </button>
           );
        })}
      </div>

      {/* Selected Day Events */}
      <div className="flex-1 overflow-y-auto">
        <h3 className="text-pb-subtext text-sm uppercase font-bold mb-3">
          {format(selectedDate, 'd MMMM, EEEE', { locale: ru })}
        </h3>
        
        <div className="space-y-3">
          {selectedEvents.length === 0 ? (
            <div className="text-center py-8 text-pb-subtext/50">
              <p>Нет событий</p>
            </div>
          ) : (
            selectedEvents.map(event => (
               <EventCard 
                 key={event.id} 
                 event={event} 
                 compact 
                 onClick={onEventClick}
                 onLongPress={onEventLongPress}
               />
            ))
          )}
        </div>
      </div>
    </div>
  );
};
