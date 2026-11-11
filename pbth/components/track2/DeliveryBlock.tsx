import React, { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { getEventDelivery, REMINDERS_SENT_EVENT, type EventDeliveryReport } from '../../api/track2';
import { countLabel } from '../../lib/plural';
import { broadcastLabel, reserveLine } from './delivery-labels';
import { Button, Glass } from '../../ui';
import '../event/event.css';

// «Кому дошло» на экране события (трек 2): капитан и тренер видят по последней
// рассылке — «Напомнить» или сообщению о новом, перенесённом, отменённом
// событии, — кому дошло, кому нет и почему, и сколько раз уже уходило
// авто-напоминание. Данные — журнал доставки на сервере.

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
  <span className={`ui-chip ${tone === 'ok' ? 'ui-chip--success' : tone === 'bad' ? 'ui-chip--danger' : 'ui-chip--muted'}`}>{children}</span>
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
  const reserveText = reserveLine((report?.members ?? []).filter((m) => m.reserve).map((m) => m.name));
  const delivered = last?.items.filter((i) => i.status === 'SENT' || i.status === 'QUEUED') ?? [];
  const failed = last?.items.filter((i) => i.status === 'FAILED' || i.status === 'NO_CHANNEL') ?? [];
  const autoFailed = auto.filter((a) => a.lastStatus === 'FAILED' || a.lastStatus === 'NO_CHANNEL');
  const nothingYet = state === 'ready' && !last && auto.length === 0;

  return (
    <Glass layer={1} className="pbth-event__panel" data-testid="delivery-block">
      <div className="pbth-event__head">
        <h2 className="pbth-event__h">Кому дошло</h2>
        {state === 'ready' && !nothingYet && (
          <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
            {open ? 'Свернуть' : 'По именам'}
          </Button>
        )}
      </div>

      {state === 'loading' && <div className="pbth-event__muted">Загружаем журнал…</div>}
      {state === 'error' && (
        <div className="pbth-event__head">
          <span className="pbth-event__muted">Не удалось загрузить журнал.</span>
          <Button variant="glass2" size="sm" onClick={() => void load()}>
            Повторить
          </Button>
        </div>
      )}

      {nothingYet && (
        <div className="pbth-event__muted">
          Напоминаний по этому событию ещё не было.
          {report?.autoRemindersEnabled ? ' Молчунам оно уйдёт само накануне в 19:00 и утром в день события.' : ''}
        </div>
      )}

      {state === 'ready' && last && (
        <>
          <div>
            {broadcastLabel(last.kind)} {when(last.at)}: дошло {delivered.length} из {last.total}
            {failed.length ? `, не дошло ${failed.length}` : ''}.
          </div>
          {open && delivered.length > 0 && (
            <div className="pbth-event__chips">
              {delivered.map((i) => (
                <Chip key={i.userId} tone="ok">
                  {i.name}
                  {i.channel === 'WEBPUSH' ? ' · пуш' : ''}
                </Chip>
              ))}
            </div>
          )}
          {open && failed.length > 0 && (
            <ul className="pbth-event__plain">
              {failed.map((i) => (
                <li key={i.userId}>
                  {i.name} — {i.reason || 'не удалось отправить'}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {state === 'ready' && !nothingYet && (
        <>
          {!report?.autoRemindersEnabled ? (
            <div className="pbth-event__muted">Авто-напоминания пока не включены.</div>
          ) : auto.length === 0 ? (
            <div className="pbth-event__muted">Авто-напоминания по этому событию ещё не уходили.</div>
          ) : (
            <div>
              Авто-напоминание уходило {auto.length} {auto.length === 1 ? 'человеку' : 'людям'}
              {autoFailed.length ? `, не дошло ${autoFailed.length}` : ''}.
            </div>
          )}
          {open && auto.length > 0 && (
            <ul className="pbth-event__plain pbth-event__muted">
              {auto.map((a) => (
                <li key={a.userId}>
                  {a.name} — {times(a.count)}, последнее {SLOT_LABEL[a.lastSlot]} {when(a.lastAt)}
                  {a.lastReason ? `: ${a.lastReason}` : ''}
                </li>
              ))}
            </ul>
          )}
          {open && autoOff.length > 0 && (
            <div className="pbth-event__muted">Отключили авто-напоминания: {autoOff.map((m) => m.name).join(', ')}.</div>
          )}
          {open && reserveText && <div className="pbth-event__muted">{reserveText}</div>}
        </>
      )}
    </Glass>
  );
};
