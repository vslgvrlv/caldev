import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, type SavedPlace } from '../api';
import { Button, Glass, Icon } from '../ui';
import { Field, TextInput } from './form';

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
    <div className="pbth-place" ref={containerRef}>
      <Field label="Место" htmlFor="place-name">
        <TextInput
          id="place-name"
          value={name}
          onChange={handleNameChange}
          onFocus={() => setOpen(true)}
          placeholder="Адрес или название клуба"
          autoComplete="off"
        />
      </Field>

      {open && matches.length > 0 && (
        <Glass layer={2} className="pbth-place__list">
          {matches.map((place) => (
            <button key={place.id} type="button" className="pbth-place__item" onClick={() => selectPlace(place)}>
              <Icon name="map-pin" size={18} />
              <span className="pbth-place__text">
                <span className="pbth-place__name">{place.name}</span>
                {place.address && <span className="pbth-place__addr">{place.address}</span>}
              </span>
              {place.yandexUrl && <Icon name="link" size={16} />}
            </button>
          ))}
        </Glass>
      )}

      {/* Новое место: можно приложить ссылку на Яндекс.Карты, чтобы напоминания вели на карту */}
      {query.length > 0 && !exactMatch && (
        <>
          {url ? (
            <Glass layer={2} className="pbth-place__url">
              <Icon name="link" size={16} />
              <span className="pbth-place__urltext">{url}</span>
              <Button
                variant="ghost"
                icon="x"
                aria-label="Убрать ссылку"
                onClick={() => {
                  onChange({ name, address, url: '' });
                  setShowNewUrl(false);
                }}
              />
            </Glass>
          ) : showNewUrl ? (
            <Field label="Ссылка на Яндекс.Карты" htmlFor="place-url" hint="Необязательно">
              <TextInput id="place-url" value={url} onChange={(v) => onChange({ name, address, url: v })} placeholder="https://yandex.ru/maps/…" autoComplete="off" />
            </Field>
          ) : (
            <Button variant="ghost" icon="plus" onClick={() => setShowNewUrl(true)}>
              Добавить ссылку на Яндекс.Карты
            </Button>
          )}
        </>
      )}
    </div>
  );
};
