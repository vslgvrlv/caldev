import React from 'react';
import { Check, Inbox, Loader2, X } from 'lucide-react';
import { useShell } from '../../shell/context';
import { notifyJoinRequestsChanged, track1Api, type PendingJoinRequest } from '../../api/track1';
import { notify, errorText } from '../../lib/notify';

// Заявки на вступление, `/t/:team/requests` (трек 1). Видят капитан и
// тренер; решение здесь и кнопкой в боте — одно и то же: кто успел первым.

function avatarOf(user: PendingJoinRequest['user']): string {
  return user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || user.nickname)}&background=1E1E2E&color=fff`;
}

function since(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

export const JoinRequestsView: React.FC = () => {
  const shell = useShell();
  const team = shell.team;
  const canDecide = team?.role === 'CAPTAIN' || team?.role === 'TRAINER' || team?.role === 'ADMIN';
  const [items, setItems] = React.useState<PendingJoinRequest[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!canDecide) return;
    try {
      const res = await track1Api.teamJoinRequests();
      setItems(res.requests);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [canDecide]);

  React.useEffect(() => {
    setItems(null);
    void load();
  }, [load, team?.id]);

  const decide = async (item: PendingJoinRequest, decision: 'approve' | 'decline') => {
    if (busy) return;
    setBusy(item.id);
    try {
      await track1Api.decideJoinRequest(item.id, decision);
      notify.success(decision === 'approve' ? `${item.user.name} теперь в составе` : 'Заявка отклонена');
      setItems((prev) => (prev ? prev.filter((x) => x.id !== item.id) : prev));
      notifyJoinRequestsChanged();
      if (decision === 'approve') void shell.reload();
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === 'JOIN_REQUEST_ALREADY_DECIDED') {
        notify.info('Эту заявку уже решили');
        setItems((prev) => (prev ? prev.filter((x) => x.id !== item.id) : prev));
        notifyJoinRequestsChanged();
      } else {
        notify.error(errorText(error, 'Не получилось. Попробуй ещё раз.'));
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="px-4 pb-24 pt-4 text-white">
      <h1 className="text-2xl font-bold mb-1">Заявки</h1>
      <p className="text-pb-subtext text-sm mb-4">Люди, которые открыли ссылку команды и просятся в состав игроками.</p>

      {!canDecide ? (
        <div className="text-pb-subtext text-sm">Заявки решают капитан и тренер.</div>
      ) : failed ? (
        <div className="rounded-2xl bg-pb-surface border border-white/5 p-4 text-sm text-pb-subtext">
          Заявки не загрузились.{' '}
          <button className="text-pb-primary font-semibold" onClick={() => void load()}>
            Обновить
          </button>
        </div>
      ) : items === null ? (
        <div className="flex justify-center py-10">
          <Loader2 className="animate-spin text-pb-primary" size={28} />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl bg-pb-surface border border-white/5 p-6 text-center text-pb-subtext text-sm">
          <Inbox size={28} className="mx-auto mb-2 opacity-60" />
          Новых заявок нет. Ссылку команды можно отправить с экрана «Команда».
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="rounded-2xl bg-pb-surface border border-white/5 p-4">
              <div className="flex items-center gap-3">
                <img src={avatarOf(item.user)} alt="" className="w-11 h-11 rounded-full object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate">{item.user.name}</div>
                  <div className="text-xs text-pb-subtext truncate">
                    {item.user.username ? `@${item.user.username} · ` : ''}
                    {since(item.createdAt)}
                  </div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  disabled={busy !== null}
                  onClick={() => void decide(item, 'approve')}
                  className="py-2.5 rounded-xl bg-pb-primary text-pb-background font-bold text-sm flex items-center justify-center gap-1.5 disabled:opacity-60"
                >
                  {busy === item.id ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  Принять
                </button>
                <button
                  disabled={busy !== null}
                  onClick={() => void decide(item, 'decline')}
                  className="py-2.5 rounded-xl bg-white/10 text-white font-semibold text-sm flex items-center justify-center gap-1.5 disabled:opacity-60"
                >
                  <X size={16} />
                  Отклонить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
