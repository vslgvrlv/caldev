import React from 'react';
import { Shield } from 'lucide-react';
import { useShell } from '../../shell/context';
import { platformApi, type JournalItem } from '../../api/track3';
import { groupByDay, timeLabel } from '../../components/track3/format';
import { ContentLoader } from '../../components/shell/ScreenLoader';
import { errorText } from '../../lib/notify';

// Журнал команды `/t/:team/journal` — капитану: кто, что и когда сделал.
// Действия владельца платформы помечены (решение Василия 10.11.2026, п. 11).
export const TeamJournalView: React.FC = () => {
  const shell = useShell();
  const teamId = shell.team?.id ?? null;
  const [items, setItems] = React.useState<JournalItem[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!teamId) return;
    let cancelled = false;
    setItems(null);
    setError(null);
    platformApi
      .journal(teamId)
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      .catch((err) => {
        if (!cancelled) setError(errorText(err, 'Журнал не загрузился. Проверь связь и попробуй ещё раз.'));
      });
    return () => {
      cancelled = true;
    };
  }, [teamId]);

  return (
    <div className="px-4 pb-24 pt-4 text-white animate-fade-in">
      <h1 className="text-2xl font-bold mb-1">Журнал команды</h1>
      <p className="text-pb-subtext text-sm mb-5">Последние действия в команде: кто, что и когда.</p>

      {error && (
        <div className="rounded-2xl border border-pb-danger/30 bg-pb-danger/10 px-4 py-3 text-sm">{error}</div>
      )}
      {!error && items === null && <ContentLoader />}
      {!error && items !== null && items.length === 0 && (
        <p className="text-pb-subtext text-sm">Пока пусто. Здесь появятся события, ответы, оплаты и приглашения.</p>
      )}

      {items !== null &&
        groupByDay(items).map((group) => (
          <section key={group.day} className="mb-5">
            <h2 className="text-pb-subtext text-xs font-semibold mb-2">{group.day}</h2>
            <ul className="bg-pb-surface rounded-2xl border border-white/5 divide-y divide-white/5">
              {group.items.map((item) => (
                <li key={item.id} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold text-sm truncate">{item.actorName}</span>
                    <span className="text-pb-subtext text-xs shrink-0">{timeLabel(item.at)}</span>
                  </div>
                  <div className="text-sm text-white/90 mt-0.5">{item.text}</div>
                  {item.byOwner && (
                    <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-amber-400/10 border border-amber-400/30 px-2 py-0.5 text-[11px] text-amber-100">
                      <Shield size={12} />
                      владелец платформы
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
};
