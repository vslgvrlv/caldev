import React from 'react';
import { Clock, MapPin } from 'lucide-react';
import type { SlotOffer } from '../../api/track4';
import { bookButtonLabel, freeSlotsLabel, slotPriceLabel, slotWhenLabel } from './slot-format';

// Карточка события со слотами в ленте `/teams`: команда, название, время,
// место, цена, свободные места. У записанного — пометка «гость».

export const SlotOfferCard: React.FC<{
  offer: SlotOffer;
  busy?: boolean;
  onOpen: () => void;
  onBook?: () => void;
}> = ({ offer, busy, onOpen, onBook }) => (
  <div className="bg-pb-surface rounded-2xl border border-white/5 overflow-hidden">
    <button type="button" onClick={onOpen} className="w-full text-left p-4 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-pb-subtext truncate">{offer.teamName}</span>
        {offer.booked ? (
          <span className="shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full bg-pb-primary/15 text-pb-primary border border-pb-primary/30">
            гость
          </span>
        ) : (
          <span className={`shrink-0 text-xs ${offer.free > 0 ? 'text-pb-primary' : 'text-pb-subtext'}`}>
            {freeSlotsLabel(offer.free, offer.capacity)}
          </span>
        )}
      </div>
      <div className="text-white font-bold">{offer.title}</div>
      <div className="flex items-center gap-1.5 text-sm text-pb-subtext">
        <Clock size={14} className="shrink-0" /> {slotWhenLabel(offer.startAt, offer.timezone)}
      </div>
      {offer.location && (
        <div className="flex items-center gap-1.5 text-sm text-pb-subtext">
          <MapPin size={14} className="shrink-0" /> <span className="truncate">{offer.location}</span>
        </div>
      )}
      <div className="text-sm text-white">{slotPriceLabel(offer.booked ? offer.myBooking?.price : offer.price)}</div>
    </button>
    {onBook && !offer.booked && offer.free > 0 && (
      <div className="px-4 pb-4">
        <button
          type="button"
          disabled={busy}
          onClick={onBook}
          className="w-full py-2.5 rounded-xl bg-pb-primary text-pb-background font-bold hover:bg-opacity-90 transition-colors disabled:opacity-60"
        >
          {bookButtonLabel(offer.price)}
        </button>
      </div>
    )}
  </div>
);
