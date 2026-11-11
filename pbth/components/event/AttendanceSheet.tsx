import React from 'react';
import { api } from '../../api';
import { Avatar, Row, Sheet, Switch } from '../../ui';
import { errorText, notify } from '../../lib/notify';
import { attendanceEntries, buildAttendanceDraft, type EventAttendee } from '../../lib/event-view';
import { SheetFooter } from './fields';

/** Явка «был / не был» — факт, а не планы. Стартует от сохранённого или от намерения. */
export const AttendanceSheet: React.FC<{ eventId: string; attendees: EventAttendee[]; onClose: () => void }> = ({
  eventId,
  attendees,
  onClose,
}) => {
  const [draft, setDraft] = React.useState<Record<string, boolean>>({});
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void api
      .getAttendance(eventId)
      .then((response) => !cancelled && setDraft(buildAttendanceDraft(attendees, response.attendance)))
      .catch((error) => {
        console.error('Failed to load attendance', error);
        if (!cancelled) setDraft(buildAttendanceDraft(attendees, null));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // состав на момент открытия: окно не перечитывает его при каждом ответе
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const save = async () => {
    const entries = attendanceEntries(attendees, draft);
    if (entries.length === 0) return;
    setSaving(true);
    try {
      await api.markAttendance(eventId, entries);
      notify.success('Явка сохранена.');
      onClose();
    } catch (error) {
      console.error('Failed to save attendance', error);
      notify.error(errorText(error, 'Не удалось сохранить явку.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title="Кто был на занятии" subtitle="Кто реально был — факт, не планы.">
      <div className="pbth-event__form">
        {loading ? (
          <div className="pbth-event__muted">Загружаем явку…</div>
        ) : (
          <div className="pbth-event__list">
            {attendees.map((a) => (
              <Row
                key={a.userId}
                lead={<Avatar name={a.name} size={40} />}
                title={a.name}
                trailing={
                  <Switch
                    checked={Boolean(draft[a.userId])}
                    label={`${a.name}: был на занятии`}
                    onChange={(checked) => setDraft((prev) => ({ ...prev, [a.userId]: checked }))}
                  />
                }
              />
            ))}
          </div>
        )}
        <SheetFooter
          cancelLabel="Закрыть"
          onCancel={onClose}
          submitLabel={saving ? 'Сохраняем…' : 'Сохранить явку'}
          onSubmit={() => void save()}
          busy={saving}
          disabled={loading}
        />
      </div>
    </Sheet>
  );
};
