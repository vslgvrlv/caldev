import React, { useEffect, useState } from 'react';
import { getReminderSettings, setReminderSettings } from '../../api/track2';
import { notify } from '../../lib/notify';
import { SwitchRow } from '../profile/SwitchRow';

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
    <SwitchRow
      testId="reminder-settings"
      icon="calendar-days"
      title="Авто-напоминания о событиях"
      sub="Если не ответил, идёшь ли: накануне в 19:00 и утром в день события. Выключатель убирает и сообщения о новых событиях; перенос и отмена событий, на которые ты идёшь, приходят всегда"
      checked={on}
      disabled={enabled === null || saving}
      onChange={() => void toggle()}
    />
  );
};
