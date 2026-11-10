import React from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Clock, MapPin, Users } from 'lucide-react';
import { slotsApi, slotsPath, type SlotEventView } from '../../api/track4';
import { confirmAction, errorText, notify } from '../../lib/notify';
import { eventPath } from '../../lib/team-url';
import { bookButtonLabel, freeSlotsLabel, slotPriceLabel, slotWhenLabel } from './slot-format';
import { SlotsFrame, primaryBtn, secondaryBtn, sectionTitle, surface } from './SlotsFrame';

// Событие на `/teams?event=<id>` — сюда ведут уведомление и кнопка в боте.
//   Подписчик: название, время, место, цена, свободные места, «Записаться».
//   Гость: событие целиком — описание, игры, кто идёт — и «Сняться».
//   Участник команды уходит на экран события своей команды.

export const SlotEventPage: React.FC<{ eventId: string }> = ({ eventId }) => {
  const navigate = useNavigate();
  const [view, setView] = React.useState<SlotEventView | null>(null);
  const [missing, setMissing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      setView(await slotsApi.event(eventId));
      setMissing(false);
    } catch {
      setMissing(true);
    }
  }, [eventId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (view && (view.viewer === 'MANAGER' || view.viewer === 'MEMBER')) {
    return <Navigate to={eventPath(view.teamId, view.eventId)} replace />;
  }

  const bookSlot = async () => {
    setBusy(true);
    try {
      setView(await slotsApi.book(eventId));
      notify.success('Ты записан');
    } catch (error) {
      notify.error(errorText(error));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    const ok = await confirmAction('Сняться с события? Место освободится для других.', {
      confirmLabel: 'Сняться',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await slotsApi.leave(eventId);
      notify.success('Ты снялся с события');
      await load();
    } catch (error) {
      notify.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const guest = view?.viewer === 'GUEST';
  const slot = view?.slot ?? null;

  return (
    <SlotsFrame title={view?.title ?? 'Событие'} onBack={() => navigate(slotsPath.list())}>
      {missing && (
        <div className={surface}>
          <div className="text-white font-bold mb-1">Событие недоступно</div>
          <p className="text-sm text-pb-subtext mb-3">
            Запись закрыта, событие прошло или ты не подписан на команду.
          </p>
          <button type="button" className={secondaryBtn} onClick={() => navigate(slotsPath.list())}>
            К свободным слотам
          </button>
        </div>
      )}
      {!missing && !view && <div className="text-sm text-pb-subtext">Загрузка…</div>}

      {view && (
        <>
          <div className={`${surface} space-y-2`}>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => navigate(slotsPath.team(view.teamId))}
                className="text-xs text-pb-subtext truncate underline-offset-2 hover:underline"
              >
                {view.teamName}
              </button>
              {guest && (
                <span className="shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full bg-pb-primary/15 text-pb-primary border border-pb-primary/30">
                  гость
                </span>
              )}
            </div>
            <div className="text-xl font-bold text-white">{view.title}</div>
            <div className="flex items-center gap-1.5 text-sm text-pb-subtext">
              <Clock size={14} className="shrink-0" /> {slotWhenLabel(view.startAt, view.timezone)}
            </div>
            {view.location && (
              <div className="flex items-center gap-1.5 text-sm text-pb-subtext">
                <MapPin size={14} className="shrink-0" />
                {view.locationUrl ? (
                  <a href={view.locationUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 truncate">
                    {view.location}
                  </a>
                ) : (
                  <span className="truncate">{view.location}</span>
                )}
              </div>
            )}
            {view.description && <p className="text-sm text-white/90 whitespace-pre-line pt-1">{view.description}</p>}
          </div>

          {!guest && slot && (
            <div className={`${surface} space-y-3`}>
              <div className="flex items-center justify-between">
                <span className="text-white font-bold">{slotPriceLabel(slot.price)}</span>
                <span className={`text-sm ${slot.free > 0 ? 'text-pb-primary' : 'text-pb-subtext'}`}>
                  {freeSlotsLabel(slot.free, slot.capacity)}
                </span>
              </div>
              {slot.free > 0 ? (
                <button type="button" className={primaryBtn} disabled={busy} onClick={() => void bookSlot()}>
                  {bookButtonLabel(slot.price)}
                </button>
              ) : (
                <p className="text-sm text-pb-subtext">Мест нет. Если кто-то снимется, придёт уведомление.</p>
              )}
              <p className="text-xs text-pb-subtext">Запись сразу, без одобрения. Оплата — капитану команды.</p>
            </div>
          )}

          {guest && view.myBooking && (
            <div className={`${surface} space-y-3`}>
              <div className="flex items-center justify-between">
                <span className="text-white font-bold">Ты записан</span>
                <span className="text-sm text-pb-subtext">{slotPriceLabel(view.myBooking.price)}</span>
              </div>
              <div className={`text-sm ${view.myBooking.paid ? 'text-pb-primary' : 'text-pb-subtext'}`}>
                {view.myBooking.paid
                  ? 'Капитан отметил оплату'
                  : view.myBooking.price > 0
                    ? 'Оплата капитану, пока не отмечена'
                    : 'Участие бесплатное'}
              </div>
              {!view.started && (
                <button type="button" className={secondaryBtn} disabled={busy} onClick={() => void leave()}>
                  Сняться
                </button>
              )}
            </div>
          )}

          {guest && view.schedule && view.schedule.length > 0 && (
            <section>
              <div className={sectionTitle}>Расписание игр</div>
              <div className={`${surface} divide-y divide-white/5 py-1`}>
                {view.schedule.map((game) => (
                  <div key={game.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-pb-subtext w-16 shrink-0">{game.time}</span>
                    <span className="text-white flex-1 truncate">{game.opponent}</span>
                    {game.score && <span className="text-white font-semibold">{game.score}</span>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {guest && view.going && (
            <section>
              <div className={`${sectionTitle} flex items-center gap-1.5`}>
                <Users size={12} /> Кто идёт · {view.going.length}
              </div>
              <div className={`${surface} space-y-2`}>
                {view.going.length === 0 && <div className="text-sm text-pb-subtext">Пока никто не отметился.</div>}
                {view.going.map((person, index) => (
                  <div key={`${person.nickname}-${index}`} className="flex items-center gap-2">
                    <img
                      src={
                        person.avatar ||
                        `https://ui-avatars.com/api/?name=${encodeURIComponent(person.name)}&background=0F0F0F&color=fff`
                      }
                      alt=""
                      loading="lazy"
                      className="w-7 h-7 rounded-full object-cover shrink-0"
                    />
                    <span className="text-sm text-white truncate flex-1">{person.name}</span>
                    {person.guest && <span className="text-[11px] text-pb-subtext">гость</span>}
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </SlotsFrame>
  );
};
