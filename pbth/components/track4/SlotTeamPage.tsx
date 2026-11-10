import React from 'react';
import { useNavigate } from 'react-router-dom';
import { generate } from 'lean-qr';
import { Copy, Share2 } from 'lucide-react';
import { slotsApi, slotsPath, type SlotTeamPage as TeamPageData } from '../../api/track4';
import { errorText, notify } from '../../lib/notify';
import { teamPath } from '../../lib/team-url';
import { SlotOfferCard } from './SlotOfferCard';
import { followersLabel } from './slot-format';
import { SlotsFrame, primaryBtn, secondaryBtn, sectionTitle, surface } from './SlotsFrame';

// Страница команды на `/teams?team=<id>`.
//   Подписчику — «Подписаться» (сам, без одобрения) и свободные слоты команды.
//   Капитану и тренеру — «Открытое расписание»: включить (капитан), ссылка и
//   QR для подписки, число подписчиков.

function subscribeLink(teamId: string): string {
  return `${window.location.origin}${slotsPath.team(teamId)}`;
}

/** QR-код ссылки картинкой: библиотека lean-qr (MIT), без своего рисования. */
const QrImage: React.FC<{ value: string }> = ({ value }) => {
  const src = React.useMemo(() => {
    try {
      return generate(value).toDataURL({ scale: 8, pad: 2, on: [0, 0, 0, 255], off: [255, 255, 255, 255] });
    } catch {
      return '';
    }
  }, [value]);
  if (!src) return null;
  return (
    <img
      src={src}
      alt="QR-код ссылки для подписки"
      width={192}
      height={192}
      className="w-48 h-48 rounded-xl bg-white mx-auto"
      style={{ imageRendering: 'pixelated' }}
    />
  );
};

const ManagePanel: React.FC<{ data: TeamPageData; teamId: string; reload: () => Promise<void> }> = ({
  data,
  teamId,
  reload,
}) => {
  const [busy, setBusy] = React.useState(false);
  const enabled = Boolean(data.team?.openSchedule);
  const link = subscribeLink(teamId);

  const toggle = async () => {
    setBusy(true);
    try {
      await slotsApi.setOpenSchedule(teamId, !enabled);
      notify.success(enabled ? 'Открытое расписание выключено' : 'Открытое расписание включено');
      await reload();
    } catch (error) {
      notify.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      notify.success('Ссылка скопирована');
    } catch {
      notify.error('Не получилось скопировать — выдели ссылку и скопируй вручную');
    }
  };

  const share = async () => {
    const text = `Подписывайся на свободные слоты ${data.team?.name ?? 'команды'} в PBTH`;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: data.team?.name, text, url: link });
        return;
      } catch {
        return;
      }
    }
    await copy();
  };

  return (
    <div className={`${surface} space-y-4`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-white font-bold">Открытое расписание</div>
          <div className="text-sm text-pb-subtext mt-1">
            {enabled
              ? 'Подписчики видят события, где ты открыл слоты: название, время, место, цену и свободные места. Состав, деньги и остальное расписание им закрыты.'
              : 'Выключено. Включи — и люди смогут подписаться на команду и записываться на свободные места в событиях.'}
          </div>
        </div>
        {data.canManage && (
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Открытое расписание"
            disabled={busy}
            onClick={() => void toggle()}
            className={`relative shrink-0 w-12 h-7 rounded-full transition-colors disabled:opacity-60 ${enabled ? 'bg-pb-primary' : 'bg-white/15'}`}
          >
            <span
              className={`absolute top-1 left-0 w-5 h-5 rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`}
            />
          </button>
        )}
      </div>
      {!data.canManage && !enabled && (
        <p className="text-sm text-pb-subtext">Включает капитан команды.</p>
      )}
      {enabled && (
        <>
          <div className="text-sm text-white">{followersLabel(data.followers ?? 0)}</div>
          <div className="space-y-2">
            <div className={sectionTitle}>Ссылка для подписки</div>
            <div className="rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-xs text-pb-subtext break-all select-all">
              {link}
            </div>
            <div className="flex gap-2">
              <button type="button" className={secondaryBtn} onClick={() => void copy()}>
                <span className="inline-flex items-center gap-1.5">
                  <Copy size={14} /> Скопировать
                </span>
              </button>
              <button type="button" className={secondaryBtn} onClick={() => void share()}>
                <span className="inline-flex items-center gap-1.5">
                  <Share2 size={14} /> Поделиться
                </span>
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <div className={sectionTitle}>QR-код</div>
            <QrImage value={link} />
            <p className="text-xs text-pb-subtext text-center">Покажи на площадке — подписаться можно с телефона.</p>
          </div>
        </>
      )}
    </div>
  );
};

export const SlotTeamPage: React.FC<{ teamId: string }> = ({ teamId }) => {
  const navigate = useNavigate();
  const [data, setData] = React.useState<TeamPageData | null>(null);
  const [missing, setMissing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      setData(await slotsApi.team(teamId));
      setMissing(false);
    } catch {
      setMissing(true);
    }
  }, [teamId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      notify.success(success);
      await load();
    } catch (error) {
      notify.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const team = data?.team ?? null;
  const manager = data?.role === 'CAPTAIN' || data?.role === 'TRAINER';

  return (
    <SlotsFrame title={team?.name ?? 'Команда'} onBack={() => navigate(slotsPath.list())}>
      {missing && (
        <div className={surface}>
          <div className="text-white font-bold mb-1">Команда не найдена</div>
          <p className="text-sm text-pb-subtext">Проверь ссылку или найди команду в списке открытых.</p>
        </div>
      )}
      {!missing && !data && <div className="text-sm text-pb-subtext">Загрузка…</div>}
      {data && team && (
        <>
          {manager && <ManagePanel data={data} teamId={teamId} reload={load} />}

          {data.member && !manager && (
            <div className={surface}>
              <div className="text-white font-bold mb-1">Ты в этой команде</div>
              <p className="text-sm text-pb-subtext mb-3">Слоты нужны гостям. Свои события отмечай в приложении команды.</p>
              <button type="button" className={secondaryBtn} onClick={() => navigate(teamPath(team.id))}>
                Открыть команду
              </button>
            </div>
          )}

          {!data.member && (
            <div className={`${surface} space-y-3`}>
              {team.openSchedule ? (
                <>
                  <p className="text-sm text-pb-subtext">
                    {team.following
                      ? 'Ты подписан. Когда капитан откроет свободные места, придёт уведомление — запишешься одним нажатием.'
                      : 'Подпишись — и когда у команды появятся свободные места на тренировке, придёт уведомление с ценой. Записаться можно одним нажатием.'}
                  </p>
                  {team.following ? (
                    <button
                      type="button"
                      className={secondaryBtn}
                      disabled={busy}
                      onClick={() => void run(() => slotsApi.unfollow(team.id), 'Ты отписался')}
                    >
                      Отписаться
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={primaryBtn}
                      disabled={busy}
                      onClick={() => void run(() => slotsApi.follow(team.id), 'Ты подписан на команду')}
                    >
                      Подписаться
                    </button>
                  )}
                </>
              ) : (
                <>
                  <p className="text-sm text-pb-subtext">Команда пока не открыла расписание.</p>
                  {team.following && (
                    <button
                      type="button"
                      className={secondaryBtn}
                      disabled={busy}
                      onClick={() => void run(() => slotsApi.unfollow(team.id), 'Ты отписался')}
                    >
                      Отписаться
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {data.slots.length > 0 && (
            <section>
              <div className={sectionTitle}>Свободные слоты</div>
              <div className="space-y-3">
                {data.slots.map((offer) => (
                  <SlotOfferCard key={offer.eventId} offer={offer} onOpen={() => navigate(slotsPath.event(offer.eventId))} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </SlotsFrame>
  );
};
