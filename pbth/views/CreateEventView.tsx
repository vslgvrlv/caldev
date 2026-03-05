import React, { useState } from 'react';
import { EventType } from '../types';
import { EVENT_LABELS, EVENT_COLORS } from '../constants';
import { ChevronLeft, Calendar, MapPin, Type, AlignLeft, DollarSign } from 'lucide-react';

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

        onCreate({
          ...formData,
          startDate,
          cost: formData.cost ? Number(formData.cost) : 0
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
      <div className="sticky top-0 z-10 bg-pb-background/80 backdrop-blur-md px-4 py-3 flex items-center justify-between border-b border-white/5">
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