import React from 'react';
import { CalendarDays, Clock3, XCircle } from 'lucide-react';
import type { JoinRequest } from '../../api/track1';
import { EVENT_LABELS } from '../../constants';
import type { PublicEventInput } from '../../lib/invite-copy';

// Состояние заявки на вступление: «у капитана» с ближайшим событием или отказ
// словами. Общая для экрана ссылки и экрана «нет команды». Без состава и денег.

// Событие в заявке — время, тип, пояс: человек ещё не в команде. `startAt` —
// имя поля в старом ответе; `title` и `location` старого ответа не читаются.
export function formatEventWhen(event: PublicEventInput): string {
  const startsAt = String(event.startsAt ?? event.startAt ?? '');
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  };
  try {
    return new Date(startsAt).toLocaleString('ru-RU', { ...options, timeZone: event.timezone || undefined });
  } catch {
    return new Date(startsAt).toLocaleString('ru-RU', options);
  }
}

export const NextEventLine: React.FC<{ event: PublicEventInput }> = ({ event }) => {
  const type = (EVENT_LABELS as Record<string, string>)[String(event.type ?? '')] ?? '';
  return (
    <div className="rounded-xl bg-black/30 px-3 py-3 text-left text-sm">
      <div className="text-pb-subtext text-xs mb-1">Ближайшее событие команды</div>
      {type ? <div className="text-white font-semibold">{type}</div> : null}
      <div className="mt-1 flex items-center gap-2 text-pb-subtext">
        <CalendarDays size={14} className="shrink-0" />
        <span>{formatEventWhen(event)}</span>
      </div>
    </div>
  );
};

export const JoinRequestStatusCard: React.FC<{ request: JoinRequest; compact?: boolean }> = ({ request, compact }) => {
  if (request.status === 'DECLINED' || request.status === 'CANCELLED') {
    return (
      <div className="rounded-2xl border border-white/10 bg-pb-surface p-4 text-left">
        <div className="flex items-center gap-2 text-white font-semibold">
          <XCircle size={18} className="text-red-300 shrink-0" />
          {request.status === 'DECLINED' ? 'Заявку отклонили' : 'Заявка отменена'}
        </div>
        <p className="mt-1 text-sm text-pb-subtext">
          Команда «{request.team.name}». Если это ошибка — напиши капитану, пусть пришлёт ссылку ещё раз.
        </p>
      </div>
    );
  }
  if (request.status === 'APPROVED') {
    return (
      <div className="rounded-2xl border border-pb-primary/30 bg-pb-primary/10 p-4 text-left text-sm text-white">
        Тебя приняли в «{request.team.name}».
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-white/10 bg-pb-surface p-4 text-left space-y-3">
      <div>
        <div className="flex items-center gap-2 text-white font-semibold">
          <Clock3 size={18} className="text-pb-primary shrink-0" />
          Заявка у капитана
        </div>
        <p className="mt-1 text-sm text-pb-subtext">
          «{request.team.name}». Капитану пришло сообщение в Telegram. Как только он примет заявку, откроется команда.
        </p>
      </div>
      {!compact && request.nextEvent && <NextEventLine event={request.nextEvent} />}
    </div>
  );
};
