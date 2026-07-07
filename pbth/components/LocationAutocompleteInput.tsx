import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, Link2, Plus, X } from 'lucide-react';
import { api, type SavedPlace } from '../api';

interface LocationAutocompleteInputProps {
  name: string;
  address: string;
  url: string;
  onChange: (next: { name: string; address: string; url: string }) => void;
}

export const LocationAutocompleteInput: React.FC<LocationAutocompleteInputProps> = ({
  name,
  address,
  url,
  onChange,
}) => {
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [open, setOpen] = useState(false);
  const [showNewUrl, setShowNewUrl] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    api
      .listPlaces()
      .then((items) => {
        if (alive) setPlaces(items);
      })
      .catch(() => {
        /* silent — autocomplete is a nicety, not a blocker */
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const query = name.trim().toLowerCase();
  const matches = useMemo(() => {
    const filtered = query
      ? places.filter(
          (p) =>
            p.name.toLowerCase().includes(query) ||
            (p.address || '').toLowerCase().includes(query),
        )
      : places;
    return filtered.slice(0, 6);
  }, [places, query]);

  const exactMatch = places.some((p) => p.name.trim().toLowerCase() === query && query.length > 0);

  const selectPlace = (place: SavedPlace) => {
    onChange({
      name: place.name,
      address: place.address || '',
      url: place.yandexUrl || '',
    });
    setShowNewUrl(false);
    setOpen(false);
  };

  const handleNameChange = (value: string) => {
    // Typing a new/edited name detaches from any picked place's saved url/address
    onChange({ name: value, address, url });
    setOpen(true);
  };

  return (
    <div className="space-y-2" ref={containerRef}>
      <label className="text-pb-subtext text-xs uppercase font-bold tracking-wider flex items-center">
        <MapPin size={14} className="mr-1" /> Место проведения
      </label>

      <div className="relative">
        <input
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="Адрес или название клуба"
          autoComplete="off"
          className="w-full bg-pb-surface border border-white/10 rounded-xl p-4 text-white focus:border-pb-primary focus:outline-none transition-colors placeholder:text-white/20"
        />

        {open && matches.length > 0 && (
          <div className="absolute z-20 mt-1 w-full rounded-xl border border-white/10 bg-pb-surface shadow-lg overflow-hidden">
            {matches.map((place) => (
              <button
                key={place.id}
                type="button"
                onClick={() => selectPlace(place)}
                className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors border-b border-white/5 last:border-b-0"
              >
                <MapPin size={16} className="mt-0.5 shrink-0 text-pb-primary" />
                <div className="min-w-0">
                  <div className="font-semibold text-white truncate">{place.name}</div>
                  {place.address && (
                    <div className="text-pb-subtext text-xs truncate">{place.address}</div>
                  )}
                </div>
                {place.yandexUrl && (
                  <Link2 size={14} className="ml-auto mt-1 shrink-0 text-pb-subtext" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* New place — offer to attach a Yandex Maps link so future reminders are clickable */}
      {query.length > 0 && !exactMatch && (
        <div className="space-y-2">
          {url ? (
            <div className="flex items-center gap-2 rounded-lg bg-pb-primary/10 border border-pb-primary/30 px-3 py-2">
              <Link2 size={14} className="shrink-0 text-pb-primary" />
              <span className="text-pb-primary text-xs truncate flex-1">{url}</span>
              <button
                type="button"
                onClick={() => {
                  onChange({ name, address, url: '' });
                  setShowNewUrl(false);
                }}
                className="text-pb-subtext hover:text-white"
              >
                <X size={14} />
              </button>
            </div>
          ) : showNewUrl ? (
            <input
              value={url}
              onChange={(e) => onChange({ name, address, url: e.target.value })}
              placeholder="Ссылка на Яндекс.Карты (необязательно)"
              autoComplete="off"
              className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white text-sm focus:border-pb-primary focus:outline-none placeholder:text-white/20"
            />
          ) : (
            <button
              type="button"
              onClick={() => setShowNewUrl(true)}
              className="flex items-center gap-1.5 text-pb-subtext text-xs hover:text-pb-primary transition-colors"
            >
              <Plus size={14} /> Добавить ссылку на Яндекс.Карты
            </button>
          )}
        </div>
      )}
    </div>
  );
};
