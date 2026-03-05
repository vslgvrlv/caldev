import React, { useRef } from 'react';
import { Event, RSVPStatus } from '../types';
import { EVENT_COLORS, EVENT_LABELS, getEventIcon } from '../constants';
import { MapPin, Clock, AlertTriangle, CheckCircle, XCircle, HelpCircle } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

interface EventCardProps {
  event: Event;
  compact?: boolean;
  onRsvp?: (id: string, status: RSVPStatus) => void;
  onClick?: (event: Event) => void;
  onLongPress?: (event: Event) => void;
}

export const EventCard: React.FC<EventCardProps> = ({ event, compact = false, onRsvp, onClick, onLongPress }) => {
  const Icon = getEventIcon(event.type);
  const color = EVENT_COLORS[event.type];
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPress = useRef(false);

  // Format date logic
  const dateStr = format(event.startDate, 'd MMM', { locale: ru });
  const timeStr = format(event.startDate, 'HH:mm');

  const handlePointerDown = () => {
    isLongPress.current = false;
    timerRef.current = setTimeout(() => {
      isLongPress.current = true;
      if (onLongPress) {
        // Trigger vibration if supported
        if (navigator.vibrate) navigator.vibrate(50);
        onLongPress(event);
      }
    }, 600); // 600ms for long press
  };

  const handlePointerUp = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
  };

  const handlePointerMove = () => {
    // If user scrolls or moves finger, cancel long press
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    // Prevent click if it was a long press
    if (isLongPress.current) return;
    onClick?.(event);
  };

  return (
    <div 
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onPointerMove={handlePointerMove}
      onClick={handleClick}
      onContextMenu={(e) => {
          e.preventDefault(); // Prevent native context menu
          // Fallback for some desktop browsers or specific touch behaviors
          // If long press logic via pointer didn't fire (rare), this might catch it, 
          // but usually pointer events handle it. 
          // Mainly strictly preventing the context menu here.
      }}
      className={`relative overflow-hidden bg-pb-surface rounded-2xl border border-white/5 mb-3 transition-transform active:scale-[0.98] cursor-pointer select-none ${event.isConflict ? 'border-pb-warning' : ''}`}
    >
      {/* Decorative side strip */}
      <div className="absolute left-0 top-0 bottom-0 w-1.5" style={{ backgroundColor: color }}></div>

      <div className="p-4 pl-5">
        <div className="flex justify-between items-start mb-2">
          <div className="flex items-center space-x-2">
            <span 
              className="text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider bg-white/10" 
              style={{ color: color }}
            >
              {EVENT_LABELS[event.type]}
            </span>
            {event.isConflict && (
              <span className="flex items-center text-[10px] text-pb-warning font-bold gap-1">
                 <AlertTriangle size={10} /> Конфликт
              </span>
            )}
          </div>
          
          {/* Status Indicator */}
          {event.rsvpStatus === RSVPStatus.CONFIRMED && <CheckCircle size={16} className="text-pb-primary" />}
          {event.rsvpStatus === RSVPStatus.DECLINED && <XCircle size={16} className="text-pb-danger" />}
          {event.rsvpStatus === RSVPStatus.PENDING && <HelpCircle size={16} className="text-pb-warning" />}
          {event.rsvpStatus === RSVPStatus.UNANSWERED && <HelpCircle size={16} className="text-pb-subtext" />}
        </div>

        <h3 className="text-lg font-bold text-white mb-1 leading-tight">{event.title}</h3>

        <div className="flex items-center text-pb-subtext text-sm space-x-4 mb-3">
          <div className="flex items-center">
            <Clock size={14} className="mr-1.5" />
            <span>{dateStr}, {timeStr}</span>
          </div>
          {event.location && (
            <div className="flex items-center truncate max-w-[120px]">
              <MapPin size={14} className="mr-1.5" />
              <span className="truncate">{event.location}</span>
            </div>
          )}
        </div>

        {/* Action Buttons for Pending - stopPropagation needed to not trigger card click */}
        {!compact && (event.rsvpStatus === RSVPStatus.PENDING || event.rsvpStatus === RSVPStatus.UNANSWERED) && (
          <div className="flex gap-2 mt-2 border-t border-white/10 pt-3">
             <button 
                onPointerDown={(e) => e.stopPropagation()} // Stop long press propagation
                onClick={(e) => { e.stopPropagation(); onRsvp?.(event.id, RSVPStatus.CONFIRMED); }}
                className="flex-1 bg-white/5 hover:bg-pb-primary/20 text-pb-primary py-2 rounded-xl text-sm font-semibold transition-colors z-10"
             >
               Иду
             </button>
             <button 
                onPointerDown={(e) => e.stopPropagation()} // Stop long press propagation
                onClick={(e) => { e.stopPropagation(); onRsvp?.(event.id, RSVPStatus.DECLINED); }}
                className="flex-1 bg-white/5 hover:bg-pb-danger/20 text-pb-danger py-2 rounded-xl text-sm font-semibold transition-colors z-10"
             >
               Не иду
             </button>
          </div>
        )}
      </div>
    </div>
  );
};
