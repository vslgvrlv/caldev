import React, { useEffect, useState } from 'react';
import { CloudOff, AlertTriangle, UploadCloud } from 'lucide-react';
import { formatSnapshotAge } from '../lib/offline';

// Плашка обязана называть возраст данных, а не просто «офлайн». На турнире
// состав и расписание меняются по ходу дня: снимок недельной давности выглядит
// как актуальный экран, и человек примет решение по устаревшему списку.
//
// Второй смысл плашки — расписка за отложенное. Игрок нажал «Сохранить» и
// форма закрылась; без видимого счётчика он не отличит «ушло на сервер» от
// «лежит в телефоне» и не узнает, что запись до сих пор не доехала.
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

  useEffect(() => {
    if (snapshotAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, [snapshotAt]);

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
            Офлайн — данные {formatSnapshotAge(snapshotAt, now)}
          </span>
        </div>
      )}
      {pending > 0 && (
        <div className="flex items-center gap-2">
          <UploadCloud size={14} className="text-amber-400 shrink-0" />
          <span className="text-amber-200 text-xs">
            {pending} {pluralRecords(pending)} ждут отправки — уйдут сами при интернете
          </span>
        </div>
      )}
      {blocked > 0 && (
        <div className="flex items-center gap-2">
          <AlertTriangle size={14} className="text-red-400 shrink-0" />
          <span className="text-red-200 text-xs">
            {blocked} {pluralRecords(blocked)} сервер не принял — покажи это капитану
          </span>
        </div>
      )}
    </div>
  );
}

function pluralRecords(count: number): string {
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'записей';
  switch (count % 10) {
    case 1:
      return 'запись';
    case 2:
    case 3:
    case 4:
      return 'записи';
    default:
      return 'записей';
  }
}
