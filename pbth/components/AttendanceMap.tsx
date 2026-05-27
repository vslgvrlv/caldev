import React from 'react';
import { groupAttendance, type AttendanceRsvp } from '../lib/attendance';

export interface AttendanceMapMember {
  userId: string;
  name: string;
  nickname: string;
  avatar?: string;
  rsvpStatus: AttendanceRsvp;
}

const avatarUrl = (m: AttendanceMapMember) =>
  m.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(m.name)}&background=0F0F0F&color=fff`;

const GROUPS = [
  { key: 'going', label: 'Идут', chip: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40' },
  { key: 'silent', label: 'Молчат', chip: 'bg-amber-500/20 text-amber-200 border-amber-500/40' },
  { key: 'notGoing', label: 'Не идут', chip: 'bg-rose-500/20 text-rose-200 border-rose-500/40' },
] as const;

interface AttendanceMapProps {
  attendees: AttendanceMapMember[];
  /** #49: один тап «Напомнить молчунам». Если не передан — кнопка не показывается. */
  onRemindSilent?: () => void;
  remindingSilent?: boolean;
}

/**
 * Карта явки (#48): показывает капитану состав на событие одним взглядом —
 * Идут / Молчат / Не идут, с аватарками. Без UUID и внутренних статусов RSVP.
 * #49: в группе «Молчат» — кнопка «Напомнить» в один тап.
 */
export const AttendanceMap: React.FC<AttendanceMapProps> = ({ attendees, onRemindSilent, remindingSilent }) => {
  const groups = groupAttendance(attendees);
  if (groups.counts.total === 0) return null;

  return (
    <div className="mb-4 space-y-3" data-testid="attendance-map">
      <div className="flex flex-wrap gap-2">
        {GROUPS.map((g) => (
          <span
            key={g.key}
            className={`inline-flex items-center px-2.5 py-1 rounded-lg border text-xs font-semibold ${g.chip}`}
          >
            {g.label} · {groups.counts[g.key]}
          </span>
        ))}
      </div>

      {GROUPS.map((g) => {
        const list = groups[g.key];
        if (list.length === 0) return null;
        const showRemind = g.key === 'silent' && Boolean(onRemindSilent);
        return (
          <div key={g.key}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[11px] uppercase tracking-wider text-pb-subtext font-bold">{g.label}</div>
              {showRemind && (
                <button
                  type="button"
                  onClick={onRemindSilent}
                  disabled={remindingSilent}
                  className="text-[11px] font-semibold text-pb-primary border border-pb-primary/30 rounded-lg px-2 py-1 hover:bg-pb-primary/10 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {remindingSilent ? 'Отправляем…' : `Напомнить (${list.length})`}
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {list.map((m) => (
                <div
                  key={m.userId}
                  title={m.name}
                  className="flex items-center gap-1.5 bg-white/5 border border-white/5 rounded-full pl-1 pr-2.5 py-1"
                >
                  <img src={avatarUrl(m)} alt={m.name} className="w-6 h-6 rounded-full object-cover" />
                  <span className="text-xs text-white truncate max-w-[120px]">{m.name}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};
