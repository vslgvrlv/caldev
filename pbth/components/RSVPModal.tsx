import React from 'react';
import { Event, RSVPStatus } from '../types';
import { CheckCircle, XCircle, HelpCircle } from 'lucide-react';

interface RSVPModalProps {
  event: Event | null;
  isOpen: boolean;
  onClose: () => void;
  onRsvp: (id: string, status: RSVPStatus) => void;
}

export const RSVPModal: React.FC<RSVPModalProps> = ({ event, isOpen, onClose, onRsvp }) => {
  if (!isOpen || !event) return null;

  const handleSelect = (status: RSVPStatus) => {
    onRsvp(event.id, status);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative w-full max-w-sm bg-pb-surface rounded-2xl border border-white/10 shadow-2xl p-6 transform transition-all scale-100">
        
        <h3 className="text-lg font-bold text-white text-center mb-1">Изменить статус</h3>
        <p className="text-pb-subtext text-center text-sm mb-6 truncate">{event.title}</p>

        <div className="space-y-3">
          <button 
            onClick={() => handleSelect(RSVPStatus.CONFIRMED)}
            className={`w-full flex items-center justify-center p-4 rounded-xl border font-bold transition-all ${
              event.rsvpStatus === RSVPStatus.CONFIRMED 
                ? 'bg-pb-primary text-pb-background border-pb-primary' 
                : 'bg-white/5 text-white border-white/10 hover:bg-white/10'
            }`}
          >
            <CheckCircle className="mr-3" size={20} />
            Я иду
          </button>

          <button 
             onClick={() => handleSelect(RSVPStatus.DECLINED)}
             className={`w-full flex items-center justify-center p-4 rounded-xl border font-bold transition-all ${
              event.rsvpStatus === RSVPStatus.DECLINED 
                ? 'bg-pb-danger text-white border-pb-danger' 
                : 'bg-white/5 text-white border-white/10 hover:bg-white/10'
            }`}
          >
            <XCircle className="mr-3" size={20} />
            Не иду
          </button>

          <button 
             onClick={() => handleSelect(RSVPStatus.PENDING)}
             className={`w-full flex items-center justify-center p-4 rounded-xl border font-bold transition-all ${
              event.rsvpStatus === RSVPStatus.PENDING 
                ? 'bg-pb-warning text-white border-pb-warning' 
                : 'bg-white/5 text-white border-white/10 hover:bg-white/10'
            }`}
          >
            <HelpCircle className="mr-3" size={20} />
            Думаю
          </button>
        </div>

        <button onClick={onClose} className="mt-6 w-full text-center text-pb-subtext text-sm py-2">
          Отмена
        </button>
      </div>
    </div>
  );
};

export default RSVPModal;
