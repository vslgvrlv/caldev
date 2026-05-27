import React, { useState } from 'react';
import { EventType } from '../types';
import { EVENT_LABELS, EVENT_COLORS } from '../constants';
import { ChevronLeft, Calendar, MapPin, Type, AlignLeft, DollarSign, Repeat } from 'lucide-react';
import { buildRecurrence, type Weekday } from '../lib/recurrence';

const WEEKDAYS: { key: Weekday; label: string }[] = [
  { key: 'MON', label: 'Пн' },
  { key: 'TUE', label: 'Вт' },
  { key: 'WED', label: 'Ср' },
  { key: 'THU', label: 'Чт' },
  { key: 'FRI', label: 'Пт' },
  { key: 'SAT', label: 'Сб' },
  { key: 'SUN', label: 'Вс' },
];

interface CreateEventViewProps {
  onBack: () => void;
  onCreate: (eventData: any) => void;
}

export const CreateEventView: React.FC<CreateEventViewProps> = ({ onBack, onCreate }) => {
  const [formData, setFormData] = useState({
    title: '',
    type: EventType.TRAINING,
    date: '',
    time: '19:00',
    location: '',
    description: '',
    cost: ''
  });
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [repeatWeekdays, setRepeatWeekdays] = useState<Weekday[]>([]);
  const [repeatUntil, setRepeatUntil] = useState('');

  const toggleWeekday = (day: Weekday) =>
    setRepeatWeekdays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    
    // Basic Validation
    if (!formData.title.trim()) {
        alert('Пожалуйста, введите название события');
        return;
    }
    if (!formData.date) {
        alert('Пожалуйста, выберите дату');
        return;
    }

    // Combine date and time
    try {
        const dateTimeString = `${formData.date}T${formData.time || '00:00'}`;
        const startDate = new Date(dateTimeString);

        if (isNaN(startDate.getTime())) {
            alert('Некорректная дата');
            return;
        }

        const recurrence = buildRecurrence({
          enabled: repeatEnabled,
          weekdays: repeatWeekdays,
          untilDate: repeatUntil,
        });
        if (recurrence.kind === 'error') {
          alert(recurrence.message);
          return;
        }

        onCreate({
          ...formData,
          startDate,
          cost: formData.cost ? Number(formData.cost) : 0,
          recurrence: recurrence.kind === 'ok' ? recurrence.value : undefined,
        });
    } catch (error) {
        console.error("Date parsing error", error);
        alert('Ошибка при создании даты');
    }
  };

  const currentTypeColor = EVENT_COLORS[formData.type as EventType];

  return (
    <div className="min-h-screen bg-pb-background flex flex-col pb-safe animate-fade-in z-50 relative">
      {/* Header */}
      <div
        className="sticky top-0 z-10 flex items-center justify-between border-b border-white/5 bg-pb-background/80 px-4 pb-3 backdrop-blur-md"
        style={{ paddingTop: 'calc(var(--pb-safe-top) + 0.75rem)' }}
      >
        <button onClick={onBack} className="p-2 -ml-2 text-white hover:bg-white/10 rounded-full">
          <ChevronLeft size={24} />
        </button>
        <span className="font-bold text-lg text-white">Новое событие</span>
        <div className="w-10"></div> {/* Spacer for center alignment */}
      </div>

      <form id="create-event-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
        
        {/* Type Selection */}
        <div className="space-y-2">
          <label className="text-pb-subtext text-xs uppercase font-bold tracking-wider">Тип события</label>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(EVENT_LABELS).map(([key, label]) => {
                const isSelected = formData.type === key;
                const typeColor = EVENT_COLORS[key as EventType];
                return (
                    <button
                        key={key}
                        type="button"
                        onClick={() => setFormData(prev => ({ ...prev, type: key as EventType }))}
                        className={`p-3 rounded-xl text-xs font-bold transition-all border ${isSelected ? 'text-pb-background' : 'bg-pb-surface text-pb-subtext border-transparent'}`}
                        style={{ 
                            backgroundColor: isSelected ? typeColor : undefined,
                            borderColor: isSelected ? typeColor : undefined
                        }}
                    >
                        {label}
                    </button>
                )
            })}
          </div>
        </div>

        {/* Title */}
        <div className="space-y-2">
           <label className="text-pb-subtext text-xs uppercase font-bold tracking-wider flex items-center">
             <Type size={14} className="mr-1" /> Название
           </label>
           <input 
             name="title"
             value={formData.title}
             onChange={handleChange}
             placeholder="Например: Тренировка в Бункере"
             className="w-full bg-pb-surface border border-white/10 rounded-xl p-4 text-white focus:border-pb-primary focus:outline-none transition-colors placeholder:text-white/20"
             required
           />
        </div>

        {/* Date & Time */}
        <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
                <label className="text-pb-subtext text-xs uppercase font-bold tracking-wider flex items-center">
                    <Calendar size={14} className="mr-1" /> Дата
                </label>
                <input 
                    type="date"
                    name="date"
                    value={formData.date}
                    onChange={handleChange}
                    className="w-full bg-pb-surface border border-white/10 rounded-xl p-4 text-white focus:border-pb-primary focus:outline-none transition-colors [color-scheme:dark]"
                    required
                />
            </div>
            <div className="space-y-2">
                <label className="text-pb-subtext text-xs uppercase font-bold tracking-wider flex items-center">
                    <Calendar size={14} className="mr-1" /> Время
                </label>
                <input 
                    type="time"
                    name="time"
                    value={formData.time}
                    onChange={handleChange}
                    className="w-full bg-pb-surface border border-white/10 rounded-xl p-4 text-white focus:border-pb-primary focus:outline-none transition-colors [color-scheme:dark]"
                    required
                />
            </div>
        </div>

        {/* Повтор (#52) */}
        <div className="space-y-3">
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-pb-subtext text-xs uppercase font-bold tracking-wider flex items-center">
              <Repeat size={14} className="mr-1" /> Повторять событие
            </span>
            <input
              type="checkbox"
              checked={repeatEnabled}
              onChange={(e) => setRepeatEnabled(e.target.checked)}
              className="w-5 h-5 accent-pb-primary"
            />
          </label>
          {repeatEnabled && (
            <div className="space-y-3 bg-pb-surface border border-white/10 rounded-xl p-4">
              <div>
                <div className="text-pb-subtext text-[11px] uppercase font-bold mb-2">Дни недели</div>
                <div className="flex flex-wrap gap-2">
                  {WEEKDAYS.map((d) => {
                    const active = repeatWeekdays.includes(d.key);
                    return (
                      <button
                        key={d.key}
                        type="button"
                        onClick={() => toggleWeekday(d.key)}
                        className={`w-10 h-10 rounded-full text-xs font-bold border transition-colors ${active ? 'bg-pb-primary text-pb-background border-pb-primary' : 'bg-black/30 text-pb-subtext border-white/10'}`}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <div className="text-pb-subtext text-[11px] uppercase font-bold mb-2">Повторять до</div>
                <input
                  type="date"
                  value={repeatUntil}
                  onChange={(e) => setRepeatUntil(e.target.value)}
                  className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-pb-primary focus:outline-none [color-scheme:dark]"
                />
              </div>
            </div>
          )}
        </div>

        {/* Location */}
        <div className="space-y-2">
           <label className="text-pb-subtext text-xs uppercase font-bold tracking-wider flex items-center">
             <MapPin size={14} className="mr-1" /> Место проведения
           </label>
           <input 
             name="location"
             value={formData.location}
             onChange={handleChange}
             placeholder="Адрес или название клуба"
             className="w-full bg-pb-surface border border-white/10 rounded-xl p-4 text-white focus:border-pb-primary focus:outline-none transition-colors placeholder:text-white/20"
           />
        </div>

        {/* Cost */}
        <div className="space-y-2">
           <label className="text-pb-subtext text-xs uppercase font-bold tracking-wider flex items-center">
             <DollarSign size={14} className="mr-1" /> Стоимость (₽)
           </label>
           <input 
             type="number"
             name="cost"
             value={formData.cost}
             onChange={handleChange}
             placeholder="0"
             className="w-full bg-pb-surface border border-white/10 rounded-xl p-4 text-white focus:border-pb-primary focus:outline-none transition-colors placeholder:text-white/20"
           />
        </div>

        {/* Description */}
        <div className="space-y-2">
           <label className="text-pb-subtext text-xs uppercase font-bold tracking-wider flex items-center">
             <AlignLeft size={14} className="mr-1" /> Описание / Заметки
           </label>
           <textarea 
             name="description"
             value={formData.description}
             onChange={handleChange}
             rows={4}
             placeholder="План тренировки, список снаряжения..."
             className="w-full bg-pb-surface border border-white/10 rounded-xl p-4 text-white focus:border-pb-primary focus:outline-none transition-colors placeholder:text-white/20 resize-none"
           />
        </div>

        <div className="h-10"></div> {/* Bottom spacer */}
      </form>

      {/* Footer Actions */}
      <div className="bg-pb-surface border-t border-white/5 p-4 pb-safe shadow-[0_-5px_20px_rgba(0,0,0,0.3)]">
        <button 
            type="button" 
            onClick={handleSubmit}
            className="w-full py-4 rounded-xl font-bold text-pb-background text-lg shadow-[0_0_20px_rgba(0,230,118,0.3)] hover:shadow-[0_0_30px_rgba(0,230,118,0.5)] transition-all active:scale-[0.98]"
            style={{ backgroundColor: currentTypeColor }}
        >
            Создать событие
        </button>
      </div>
    </div>
  );
};
