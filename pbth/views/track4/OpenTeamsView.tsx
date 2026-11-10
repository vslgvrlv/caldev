import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { RequireAuth } from '../../shell/gates';
import { slotsApi, slotsPath, type SlotFeed, type SlotTeamCard } from '../../api/track4';
import { errorText, notify } from '../../lib/notify';
import { SlotOfferCard } from '../../components/track4/SlotOfferCard';
import { SlotEventPage } from '../../components/track4/SlotEventPage';
import { SlotTeamPage } from '../../components/track4/SlotTeamPage';
import { SlotsFrame, secondaryBtn, sectionTitle, surface } from '../../components/track4/SlotsFrame';
import { pluralRu } from '../../components/track4/slot-format';

// Трек 4 «Открытые слоты», адрес `/teams` (решения Василия 10.11.2026, п. 23–28).
//
//   /teams              — мои записи гостем, свободные слоты команд, на которые
//                         я подписан, мои подписки, команды с открытым расписанием;
//   /teams?team=<id>    — страница команды: подписка по ссылке и QR, у капитана
//                         и тренера — «Открытое расписание»;
//   /teams?event=<id>   — событие для подписчика и гостя (сюда ведут уведомления).
//
// Страница и событие живут в параметрах адреса, а не в новых путях: адреса
// приложения заведены в общем `routes.tsx`, трек его не правит. Экран открыт
// и человеку без команды — подписаться может любой вошедший.

const TeamRow: React.FC<{ team: SlotTeamCard; busy: boolean; onOpen: () => void; onFollow?: () => void }> = ({
  team,
  busy,
  onOpen,
  onFollow,
}) => (
  <div className="flex items-center gap-3 py-2">
    <button type="button" onClick={onOpen} className="flex-1 min-w-0 flex items-center gap-3 text-left">
      <img
        src={team.logo || `https://ui-avatars.com/api/?name=${encodeURIComponent(team.name)}&background=0F0F0F&color=fff`}
        alt=""
        loading="lazy"
        className="w-9 h-9 rounded-full object-cover shrink-0"
      />
      <div className="min-w-0">
        <div className="text-sm text-white font-semibold truncate">{team.name}</div>
        <div className="text-xs text-pb-subtext">
          {!team.openSchedule
            ? 'расписание закрыто'
            : team.openEvents > 0
              ? `${team.openEvents} ${pluralRu(team.openEvents, 'событие', 'события', 'событий')} со слотами`
              : 'свободных слотов пока нет'}
        </div>
      </div>
    </button>
    {onFollow ? (
      <button type="button" className={secondaryBtn} disabled={busy} onClick={onFollow}>
        Подписаться
      </button>
    ) : (
      <ChevronRight size={16} className="text-pb-subtext shrink-0" />
    )}
  </div>
);

const SlotsHome: React.FC = () => {
  const navigate = useNavigate();
  const [feed, setFeed] = React.useState<SlotFeed | null>(null);
  const [openTeams, setOpenTeams] = React.useState<SlotTeamCard[]>([]);
  const [failed, setFailed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const [nextFeed, teams] = await Promise.all([slotsApi.feed(), slotsApi.openTeams()]);
      setFeed(nextFeed);
      setOpenTeams(teams.teams);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      notify.success(success);
    } catch (error) {
      notify.error(errorText(error));
    } finally {
      setBusy(false);
      await load();
    }
  };

  const notFollowing = openTeams.filter((team) => !team.following);

  return (
    <SlotsFrame title="Свободные слоты">
      {failed && (
        <div className={surface}>
          <div className="text-white font-bold mb-1">Не удалось загрузить</div>
          <button type="button" className={secondaryBtn} onClick={() => void load()}>
            Повторить
          </button>
        </div>
      )}
      {!failed && !feed && <div className="text-sm text-pb-subtext">Загрузка…</div>}

      {feed && feed.bookings.length > 0 && (
        <section>
          <div className={sectionTitle}>Мои записи</div>
          <div className="space-y-3">
            {feed.bookings.map((offer) => (
              <SlotOfferCard key={offer.eventId} offer={offer} onOpen={() => navigate(slotsPath.event(offer.eventId))} />
            ))}
          </div>
        </section>
      )}

      {feed && (
        <section>
          <div className={sectionTitle}>Свободные слоты</div>
          {feed.slots.length === 0 ? (
            <div className={`${surface} text-sm text-pb-subtext`}>
              {feed.following.length === 0
                ? 'Подпишись на команду ниже — когда у неё появятся свободные места, придёт уведомление.'
                : 'Сейчас свободных мест нет. Придёт уведомление, когда капитан их откроет.'}
            </div>
          ) : (
            <div className="space-y-3">
              {feed.slots.map((offer) => (
                <SlotOfferCard
                  key={offer.eventId}
                  offer={offer}
                  busy={busy}
                  onOpen={() => navigate(slotsPath.event(offer.eventId))}
                  onBook={() =>
                    void run(async () => {
                      await slotsApi.book(offer.eventId);
                    }, `Ты записан: ${offer.title}`)
                  }
                />
              ))}
            </div>
          )}
        </section>
      )}

      {feed && feed.following.length > 0 && (
        <section>
          <div className={sectionTitle}>Мои подписки</div>
          <div className={`${surface} py-2 divide-y divide-white/5`}>
            {feed.following.map((team) => (
              <TeamRow key={team.id} team={team} busy={busy} onOpen={() => navigate(slotsPath.team(team.id))} />
            ))}
          </div>
        </section>
      )}

      {feed && (
        <section>
          <div className={sectionTitle}>Команды с открытым расписанием</div>
          {notFollowing.length === 0 ? (
            <div className={`${surface} text-sm text-pb-subtext`}>
              {openTeams.length === 0
                ? 'Пока ни одна команда не открыла расписание.'
                : 'Ты подписан на все открытые команды.'}
            </div>
          ) : (
            <div className={`${surface} py-2 divide-y divide-white/5`}>
              {notFollowing.map((team) => (
                <TeamRow
                  key={team.id}
                  team={team}
                  busy={busy}
                  onOpen={() => navigate(slotsPath.team(team.id))}
                  onFollow={() => void run(() => slotsApi.follow(team.id), `Ты подписан на ${team.name}`)}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </SlotsFrame>
  );
};

export const OpenTeamsView: React.FC = () => {
  const [params] = useSearchParams();
  const eventId = params.get('event');
  const teamId = params.get('team');
  return (
    <RequireAuth>
      {eventId ? (
        <SlotEventPage key={eventId} eventId={eventId} />
      ) : teamId ? (
        <SlotTeamPage key={teamId} teamId={teamId} />
      ) : (
        <SlotsHome />
      )}
    </RequireAuth>
  );
};
