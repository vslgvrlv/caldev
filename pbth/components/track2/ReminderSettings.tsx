import React, { useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { getReminderSettings, setReminderSettings } from '../../api/track2';
import { notify } from '../../lib/notify';

// Профиль → авто-напоминания о явке (трек 2). Включены всем по умолчанию,
// отключает сам человек (решение Василия 10.11.2026, п. 8).
export const ReminderSettings: React.FC = () => {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    getReminderSettings()
      .then((s) => alive && setEnabled(s.autoEventReminders))
      .catch(() => alive && setEnabled(true));
    return () => {
      alive = false;
    };
  }, []);

  const toggle = async () => {
    if (enabled === null || saving) return;
    const next = !enabled;
    setSaving(true);
    setEnabled(next);
    try {
      const saved = await setReminderSettings({ autoEventReminders: next });
      setEnabled(saved.autoEventReminders);
      notify.success(next ? 'Авто-напоминания включены.' : 'Авто-напоминания выключены. Ручные от капитана придут как раньше.');
    } catch {
      setEnabled(!next);
      notify.error('Не получилось сохранить. Проверь сеть и попробуй ещё раз.');
    } finally {
      setSaving(false);
    }
  };

  const on = enabled !== false;
  return (
    <div className="bg-pb-surface rounded-2xl p-4 border border-white/5" data-testid="reminder-settings">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={toggle}
        disabled={enabled === null || saving}
        className="w-full flex items-center justify-between gap-3 text-left disabled:opacity-60"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-pb-primary/15 flex items-center justify-center flex-shrink-0">
            <CalendarClock size={20} className={on ? 'text-pb-primary' : 'text-pb-subtext'} strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <div className="text-white font-bold text-sm">Авто-напоминания о событиях</div>
            <div className="text-pb-subtext text-xs">
              Если не ответил, идёшь ли: накануне в 19:00 и утром в день события. Выключатель убирает и
              сообщения о новых событиях; перенос и отмена событий, на которые ты идёшь, приходят всегда
            </div>
          </div>
        </div>
        <div className={`w-11 h-6 rounded-full flex-shrink-0 relative transition-colors ${on ? 'bg-pb-primary' : 'bg-white/10'}`}>
          <div
            className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`}
          />
        </div>
      </button>
    </div>
  );
};
