import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { slotsApi, slotsPath, type SlotOffer } from '../../api/track4';
import { guestBookingLabel, upcomingGuestBookings } from './slot-format';

// Записи гостем в слоты чужих команд: раньше их было видно только на экране
// «Свободные слоты» (`/teams`). Теперь — небольшой карточкой вверху главной
// своей команды и в профиле, по каждой будущей записи, с переходом на
// страницу события гостя. Данные — из той же ленты `/slots/feed`, что
// кормит «Мои записи»; своей ручки у карточки нет.

export const GuestBookingCards: React.FC<{ bookings: SlotOffer[]; onOpen: (eventId: string) => void }> = ({
  bookings,
  onOpen,
}) => {
  if (bookings.length === 0) return null;
  return (
    <div className="space-y-2">
      {bookings.map((offer) => (
        <button
          key={offer.eventId}
          type="button"
          onClick={() => onOpen(offer.eventId)}
          className="w-full text-left bg-pb-surface rounded-2xl border border-white/5 p-4 flex items-center gap-3"
        >
          <span className="flex-1 min-w-0 text-sm text-white">{guestBookingLabel(offer)}</span>
          <ChevronRight size={16} className="text-pb-subtext shrink-0" />
        </button>
      ))}
    </div>
  );
};

/**
 * Карточки с загрузкой ленты. Нет записей или нет сети — ничего не показывает.
 * `isShown` — фильтр команд «Моё»: запись в выключенной команде не показываем.
 */
export const GuestBookingsBlock: React.FC<{ isShown?: (teamId: string) => boolean }> = ({ isShown }) => {
  const navigate = useNavigate();
  const [bookings, setBookings] = React.useState<SlotOffer[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    slotsApi
      .feed()
      .then((feed) => {
        if (!cancelled) setBookings(upcomingGuestBookings(feed?.bookings));
      })
      .catch(() => {
        // Карточка — подсказка, а не экран: без ленты её просто нет.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const shown = isShown ? bookings.filter((offer) => isShown(offer.teamId)) : bookings;
  return <GuestBookingCards bookings={shown} onOpen={(eventId) => navigate(slotsPath.event(eventId))} />;
};
