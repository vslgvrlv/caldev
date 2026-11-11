import React, { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Send } from 'lucide-react';
import { getEventDelivery, REMINDERS_SENT_EVENT, type EventDeliveryReport } from '../../api/track2';
import { countLabel } from '../../lib/plural';

// «Кому дошло» на экране события (трек 2): капитан и тренер видят по последней
// рассылке «Напомнить», кому дошло, кому нет и почему, и сколько раз уже
// уходило авто-напоминание. Данные — журнал доставки на сервере.

const SLOT_LABEL: Record<'EVE' | 'MORNING', string> = { EVE: 'накануне вечером', MORNING: 'утром' };

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return format(d, 'd MMMM, HH:mm', { locale: ru });
}

function times(n: number): string {
  return countLabel(n, 'раз', 'раза', 'раз');
}

const Chip: React.FC<{ tone: 'ok' | 'bad' | 'muted'; children: React.ReactNode }> = ({ tone, children }) => (
  <span
    className={`inline-flex items-center px-2 py-0.5 rounded-lg border text-xs ${
      tone === 'ok'
        ? 'bg-emerald-500/10 text-emerald-200 border-emerald-500/30'
        : tone === 'bad'
          ? 'bg-rose-500/10 text-rose-200 border-rose-500/30'
          : 'bg-white/5 text-pb-subtext border-white/10'
    }`}
  >
    {children}
  </span>
);

export const DeliveryBlock: React.FC<{ eventId: string }> = ({ eventId }) => {
  const [report, setReport] = useState<EventDeliveryReport | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await getEventDelivery(eventId);
      setReport(next);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [eventId]);

  useEffect(() => {
    setState('loading');
    void load();
  }, [load]);

  useEffect(() => {
    const onSent = (e: Event) => {
      const detail = (e as CustomEvent<{ eventId?: string }>).detail;
      if (!detail?.eventId || detail.eventId === eventId) void load();
    };
    window.addEventListener(REMINDERS_SENT_EVENT, onSent);
    return () => window.removeEventListener(REMINDERS_SENT_EVENT, onSent);
  }, [eventId, load]);

  const last = report?.lastBroadcast ?? null;
  const auto = report?.auto ?? [];
  const autoOff = (report?.members ?? []).filter((m) => m.autoRemindersOff);
  const delivered = last?.items.filter((i) => i.status === 'SENT' || i.status === 'QUEUED') ?? [];
  const failed = last?.items.filter((i) => i.status === 'FAILED' || i.status === 'NO_CHANNEL') ?? [];
  const autoFailed = auto.filter((a) => a.lastStatus === 'FAILED' || a.lastStatus === 'NO_CHANNEL');
  const nothingYet = state === 'ready' && !last && auto.length === 0;

  return (
    <div className="bg-pb-surface rounded-2xl p-4 border border-white/5 space-y-3" data-testid="delivery-block">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center text-white font-bold min-w-0">
          <Send size={18} className="mr-2 text-pb-primary" />
          Кому дошло
        </div>
        {state === 'ready' && !nothingYet && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-[12px] font-semibold text-pb-primary shrink-0"
          >
            {open ? 'Свернуть' : 'По именам'}
          </button>
        )}
      </div>

      {state === 'loading' && <p className="text-xs text-pb-subtext">Загружаем журнал…</p>}
      {state === 'error' && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-pb-danger">Не удалось загрузить журнал.</p>
          <button type="button" onClick={() => void load()} className="text-[12px] font-semibold text-pb-primary">
            Повторить
          </button>
        </div>
      )}

      {nothingYet && (
        <p className="text-xs text-pb-subtext">
          Напоминаний по этому событию ещё не было.
          {report?.autoRemindersEnabled ? ' Молчунам оно уйдёт само накануне в 19:00 и утром в день события.' : ''}
        </p>
      )}

      {state === 'ready' && last && (
        <div className="space-y-2">
          <p className="text-sm text-white">
            «Напомнить» {when(last.at)}: дошло {delivered.length} из {last.total}
            {failed.length ? `, не дошло ${failed.length}` : ''}.
          </p>
          {open && (
            <>
              {delivered.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {delivered.map((i) => (
                    <Chip key={i.userId} tone="ok">
                      {i.name}
                      {i.channel === 'WEBPUSH' ? ' · пуш' : ''}
                    </Chip>
                  ))}
                </div>
              )}
              {failed.length > 0 && (
                <ul className="space-y-1">
                  {failed.map((i) => (
                    <li key={i.userId} className="text-xs text-rose-200">
                      {i.name} — {i.reason || 'не удалось отправить'}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      {state === 'ready' && !nothingYet && (
        <div className="space-y-2 border-t border-white/5 pt-2">
          {!report?.autoRemindersEnabled ? (
            <p className="text-xs text-pb-subtext">Авто-напоминания пока не включены.</p>
          ) : auto.length === 0 ? (
            <p className="text-xs text-pb-subtext">Авто-напоминания по этому событию ещё не уходили.</p>
          ) : (
            <p className="text-sm text-white">
              Авто-напоминание уходило {auto.length} {auto.length === 1 ? 'человеку' : 'людям'}
              {autoFailed.length ? `, не дошло ${autoFailed.length}` : ''}.
            </p>
          )}
          {open && auto.length > 0 && (
            <ul className="space-y-1">
              {auto.map((a) => (
                <li key={a.userId} className={`text-xs ${a.lastStatus === 'FAILED' || a.lastStatus === 'NO_CHANNEL' ? 'text-rose-200' : 'text-pb-subtext'}`}>
                  {a.name} — {times(a.count)}, последнее {SLOT_LABEL[a.lastSlot]} {when(a.lastAt)}
                  {a.lastReason ? `: ${a.lastReason}` : ''}
                </li>
              ))}
            </ul>
          )}
          {open && autoOff.length > 0 && (
            <p className="text-xs text-pb-subtext">Отключили авто-напоминания: {autoOff.map((m) => m.name).join(', ')}.</p>
          )}
        </div>
      )}
    </div>
  );
};
