import React, { useCallback, useEffect, useState } from 'react';
import { CloudOff, AlertTriangle, UploadCloud, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '../api';
import { formatSnapshotAge } from '../lib/offline';
import { pluralRu } from '../lib/plural';
import {
  describeOutboxProblem,
  discardOutboxEntry,
  listOutbox,
  retryOutboxEntry,
  type OutboxEntry,
} from '../lib/outbox';

// Плашка обязана называть возраст данных, а не просто «офлайн». На турнире
// состав и расписание меняются по ходу дня: снимок недельной давности выглядит
// как актуальный экран, и человек примет решение по устаревшему списку.
//
// Второй смысл плашки — расписка за отложенное. Игрок нажал «Сохранить» и
// форма закрылась; без видимого счётчика он не отличит «ушло на сервер» от
// «лежит в телефоне» и не узнает, что запись до сих пор не доехала.
//
// Третий — выход для застрявшего. Если сервер не принимает запись, человек
// видит, какая именно, почему, и сам решает: отправить ещё раз или убрать.
// Раньше красная строка висела вечно, а что в ней — не знал никто.
export function OfflineBanner({
  snapshotAt,
  pending,
  blocked,
}: {
  snapshotAt: number | null;
  pending: number;
  blocked: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [expanded, setExpanded] = useState(false);
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    if (snapshotAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, [snapshotAt]);

  const refresh = useCallback(async () => {
    const all = await listOutbox();
    setEntries(all.filter((entry) => entry.blocked));
    setNow(Date.now());
  }, []);

  // Очередь сама сообщает о каждом изменении числом, поэтому список перечитываем
  // по смене счётчиков, а не по таймеру.
  useEffect(() => {
    if (expanded) void refresh();
  }, [expanded, blocked, pending, refresh]);

  // Разобрали всё — прятать список и вопрос: показывать их над пустотой нечем.
  useEffect(() => {
    if (blocked === 0) {
      setExpanded(false);
      setConfirmId(null);
    }
  }, [blocked]);

  const handleRetry = async (id: number) => {
    setBusyId(id);
    try {
      await retryOutboxEntry(id);
      await api.flushOfflineQueue();
    } finally {
      setBusyId(null);
      void refresh();
    }
  };

  const handleDiscard = async (id: number) => {
    setBusyId(id);
    try {
      await discardOutboxEntry(id);
    } finally {
      setBusyId(null);
      setConfirmId(null);
      void refresh();
    }
  };

  return (
    <OfflineBannerView
      snapshotAt={snapshotAt}
      now={now}
      pending={pending}
      blocked={blocked}
      expanded={expanded}
      entries={entries}
      confirmId={confirmId}
      busyId={busyId}
      onToggle={() => {
        setExpanded((value) => !value);
        setConfirmId(null);
      }}
      onRetry={(id) => void handleRetry(id)}
      onAskDiscard={setConfirmId}
      onCancelDiscard={() => setConfirmId(null)}
      onDiscard={(id) => void handleDiscard(id)}
    />
  );
}

export type OfflineBannerViewProps = {
  snapshotAt: number | null;
  now: number;
  pending: number;
  blocked: number;
  expanded: boolean;
  entries: OutboxEntry[];
  confirmId: number | null;
  busyId: number | null;
  onToggle: () => void;
  onRetry: (id: number) => void;
  onAskDiscard: (id: number) => void;
  onCancelDiscard: () => void;
  onDiscard: (id: number) => void;
};

// Отдельно от состояния, чтобы вид проверялся без браузера: тесты рисуют его
// из готовых данных и читают слова на экране.
export function OfflineBannerView({
  snapshotAt,
  now,
  pending,
  blocked,
  expanded,
  entries,
  confirmId,
  busyId,
  onToggle,
  onRetry,
  onAskDiscard,
  onCancelDiscard,
  onDiscard,
}: OfflineBannerViewProps) {
  if (snapshotAt === null && pending === 0 && blocked === 0) return null;

  return (
    <div
      className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-2 flex flex-col gap-1"
      style={{ paddingTop: 'calc(var(--pb-safe-top) + 0.5rem)' }}
    >
      {snapshotAt !== null && (
        <div className="flex items-center gap-2">
          <CloudOff size={14} className="text-amber-400 shrink-0" />
          <span className="text-amber-200 text-xs">
            {`Офлайн — данные ${formatSnapshotAge(snapshotAt, now)}`}
          </span>
        </div>
      )}
      {pending > 0 && (
        <div className="flex items-center gap-2">
          <UploadCloud size={14} className="text-amber-400 shrink-0" />
          <span className="text-amber-200 text-xs">
            {`${pending} ${recordNoun(pending)} ${pluralRu(pending, 'ждёт', 'ждут', 'ждут')} отправки — уйдут сами при интернете`}
          </span>
        </div>
      )}
      {blocked > 0 && (
        <>
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-red-400 shrink-0" />
            <span className="text-red-200 text-xs flex-1">
              {`${blocked} ${recordNoun(blocked)} ${pluralRu(blocked, 'не отправилась', 'не отправились', 'не отправились')}`}
            </span>
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={expanded}
              className="flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-bold text-white"
            >
              {expanded ? 'Свернуть' : 'Разобрать'}
              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          </div>
          {expanded && (
            <ul className="mt-1 flex flex-col gap-2">
              {entries.map((entry) => (
                <StuckEntry
                  key={entry.id}
                  entry={entry}
                  now={now}
                  confirming={confirmId === entry.id}
                  busy={busyId === entry.id}
                  onRetry={onRetry}
                  onAskDiscard={onAskDiscard}
                  onCancelDiscard={onCancelDiscard}
                  onDiscard={onDiscard}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function StuckEntry({
  entry,
  now,
  confirming,
  busy,
  onRetry,
  onAskDiscard,
  onCancelDiscard,
  onDiscard,
}: {
  entry: OutboxEntry;
  now: number;
  confirming: boolean;
  busy: boolean;
  onRetry: (id: number) => void;
  onAskDiscard: (id: number) => void;
  onCancelDiscard: () => void;
  onDiscard: (id: number) => void;
}) {
  const id = entry.id as number;
  return (
    <li className="rounded-xl border border-red-400/25 bg-black/20 px-3 py-2">
      <div className="text-xs font-bold text-white">{entry.label}</div>
      <div className="mt-0.5 text-xs text-red-200">{describeOutboxProblem(entry)}</div>
      <div className="mt-0.5 text-[11px] text-pb-subtext">{`записано ${formatSnapshotAge(entry.createdAt, now)}`}</div>
      {confirming ? (
        <div className="mt-2">
          <div className="text-xs text-white">Убрать запись насовсем? Она не будет отправлена.</div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => onDiscard(id)}
              disabled={busy}
              className="rounded-lg border border-pb-danger/50 px-2.5 py-1.5 text-xs font-bold text-pb-danger disabled:opacity-50"
            >
              Да, убрать
            </button>
            <button
              type="button"
              onClick={onCancelDiscard}
              disabled={busy}
              className="rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-bold text-white disabled:opacity-50"
            >
              Оставить
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => onRetry(id)}
            disabled={busy}
            className="rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-bold text-white disabled:opacity-50"
          >
            {busy ? 'Отправляем…' : 'Отправить ещё раз'}
          </button>
          <button
            type="button"
            onClick={() => onAskDiscard(id)}
            disabled={busy}
            className="rounded-lg border border-pb-danger/50 px-2.5 py-1.5 text-xs font-bold text-pb-danger disabled:opacity-50"
          >
            Убрать
          </button>
        </div>
      )}
    </li>
  );
}

function recordNoun(count: number): string {
  return pluralRu(count, 'запись', 'записи', 'записей');
}
