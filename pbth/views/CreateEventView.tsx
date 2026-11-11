import React, { useContext, useMemo, useRef, useState } from 'react';
import { EventType } from '../types';
import { EVENT_LABELS } from '../constants';
import type { Weekday } from '../lib/recurrence';
import { validateCreateEvent, type CreateEventDraft, type CreateEventErrors } from '../lib/event-create-form';
import { notify } from '../lib/notify';
import { LocationAutocompleteInput } from '../components/LocationAutocompleteInput';
import { DateInput, Field, FormSection, MoneyInput, TextInput, TimeInput } from '../components/form';
import { createSingleFlight } from '../lib/single-flight';
import { ShellContext } from '../shell/context';
import { Button, Glass, Screen, ScreenBar, Switch, TeamMark, teamPaint } from '../ui';
import './create-event-view.css';

const WEEKDAYS: { key: Weekday; label: string }[] = [
  { key: 'MON', label: 'Пн' },
  { key: 'TUE', label: 'Вт' },
  { key: 'WED', label: 'Ср' },
  { key: 'THU', label: 'Чт' },
  { key: 'FRI', label: 'Пт' },
  { key: 'SAT', label: 'Сб' },
  { key: 'SUN', label: 'Вс' },
];

const TYPE_ICONS: Record<EventType, string> = {
  [EventType.TRAINING]: 'dumbbell',
  [EventType.TOURNAMENT]: 'trophy',
  [EventType.CHAMPIONSHIP]: 'shield',
  [EventType.FRIENDLY_MATCH]: 'swords',
  [EventType.MEETING]: 'users',
  [EventType.MAINTENANCE]: 'settings',
  [EventType.OTHER]: 'ellipsis',
};

interface CreateEventViewProps {
  onBack: () => void;
  /** Промис завершается, когда запрос создания завершился. */
  onCreate: (eventData: any) => void | Promise<unknown>;
  allowedTypes: EventType[];
  defaultType: EventType;
}

export const CreateEventView: React.FC<CreateEventViewProps> = ({ onBack, onCreate, allowedTypes, defaultType }) => {
  // Команду берём из оболочки, но без неё экран тоже рисуется (тесты, сбой загрузки): знак и краска просто не показываются.
  const team = useContext(ShellContext)?.team ?? null;
  const [formData, setFormData] = useState<CreateEventDraft>({
    title: '',
    type: defaultType,
    date: '',
    time: '19:00',
    location: '',
    locationUrl: '',
    locationAddress: '',
    description: '',
    cost: '',
  });
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [repeatWeekdays, setRepeatWeekdays] = useState<Weekday[]>([]);
  const [repeatUntil, setRepeatUntil] = useState('');
  const [errors, setErrors] = useState<CreateEventErrors>({});

  const paints = useMemo(() => (team ? [teamPaint(team.id)] : undefined), [team]);

  const setField = (key: keyof CreateEventDraft) => (value: string) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    if (key === 'title' || key === 'date') setErrors((prev) => ({ ...prev, [key]: undefined }));
  };
  const toggleWeekday = (day: Weekday) => {
    setRepeatWeekdays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
    setErrors((prev) => ({ ...prev, weekdays: undefined }));
  };

  // Пока событие создаётся, кнопка недоступна и второе нажатие ничего не
  // отправляет: иначе получался дубль (ключа идемпотентности у сервера нет).
  const submitFlight = useRef(createSingleFlight()).current;
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (submitFlight.busy) return;

    const result = validateCreateEvent(formData, { enabled: repeatEnabled, weekdays: repeatWeekdays, untilDate: repeatUntil });
    if (!result.ok) {
      setErrors(result.errors);
      const first = Object.values(result.errors).find(Boolean);
      if (first) notify.error(first);
      const focusId = result.errors.title ? 'ne-title' : result.errors.date ? 'ne-date' : result.errors.until ? 'ne-until' : null;
      if (focusId) document.getElementById(focusId)?.focus();
      return;
    }
    setErrors({});
    setIsSubmitting(true);
    void submitFlight
      .run(() => onCreate(result.payload))
      .catch((error) => console.error('Failed to create event', error))
      .finally(() => setIsSubmitting(false));
  };

  return (
    <Screen paints={paints} className="pbth-newevent">
      <ScreenBar
        onBack={onBack}
        mark={team ? <TeamMark teamId={team.id} name={team.name} code={team.shortCode} size={32} /> : undefined}
        title="Новое событие"
        subtitle={team?.name}
      />

      <form id="create-event-form" className="pbth-newevent__form" onSubmit={handleSubmit} noValidate>
        <FormSection title="Что">
          <div className="pbth-newevent__types" role="radiogroup" aria-label="Тип события">
            {allowedTypes.map((key) => (
              <Button
                key={key}
                variant={formData.type === key ? 'light' : 'glass2'}
                icon={TYPE_ICONS[key]}
                role="radio"
                aria-checked={formData.type === key}
                onClick={() => setFormData((prev) => ({ ...prev, type: key }))}
              >
                {EVENT_LABELS[key]}
              </Button>
            ))}
          </div>
          <Field label="Название" htmlFor="ne-title" error={errors.title}>
            <TextInput id="ne-title" value={formData.title} onChange={setField('title')} placeholder="Например: Тренировка в Бункере" error={errors.title} />
          </Field>
        </FormSection>

        <FormSection title="Когда">
          <div className="pbth-newevent__two">
            <Field label="Дата" htmlFor="ne-date" error={errors.date}>
              <DateInput id="ne-date" value={formData.date} onChange={setField('date')} error={errors.date} />
            </Field>
            <Field label="Начало" htmlFor="ne-time">
              <TimeInput id="ne-time" value={formData.time} onChange={setField('time')} />
            </Field>
          </div>
          <div className="pbth-newevent__repeat">
            <label htmlFor="ne-repeat" className="pbth-newevent__repeatlabel">
              <span className="pbth-newevent__repeattitle">Повторять</span>
              <span className="pbth-newevent__repeathint">По дням недели до выбранной даты</span>
            </label>
            <Switch id="ne-repeat" checked={repeatEnabled} onChange={setRepeatEnabled} />
          </div>
          {repeatEnabled && (
            <>
              <Field label="Дни недели" error={errors.weekdays}>
                <div className="pbth-newevent__days" role="group" aria-label="Дни недели">
                  {WEEKDAYS.map((d) => (
                    <Button
                      key={d.key}
                      variant={repeatWeekdays.includes(d.key) ? 'light' : 'glass2'}
                      role="checkbox"
                      aria-checked={repeatWeekdays.includes(d.key)}
                      onClick={() => toggleWeekday(d.key)}
                    >
                      {d.label}
                    </Button>
                  ))}
                </div>
              </Field>
              <Field label="Повторять до" htmlFor="ne-until" error={errors.until}>
                <DateInput
                  id="ne-until"
                  value={repeatUntil}
                  onChange={(v) => {
                    setRepeatUntil(v);
                    setErrors((prev) => ({ ...prev, until: undefined }));
                  }}
                  error={errors.until}
                />
              </Field>
            </>
          )}
        </FormSection>

        <FormSection title="Где">
          <LocationAutocompleteInput
            name={formData.location}
            address={formData.locationAddress}
            url={formData.locationUrl}
            onChange={({ name, address, url }) => setFormData((prev) => ({ ...prev, location: name, locationAddress: address, locationUrl: url }))}
          />
        </FormSection>

        <FormSection title="Условия">
          <Field label="Стоимость с человека" htmlFor="ne-cost" hint="Пусто — бесплатно">
            <MoneyInput id="ne-cost" value={formData.cost} onChange={setField('cost')} placeholder="0" />
          </Field>
        </FormSection>

        <FormSection title="Заметка">
          <Field label="Описание" htmlFor="ne-desc">
            <TextInput id="ne-desc" multiline rows={4} value={formData.description} onChange={setField('description')} placeholder="План тренировки, список снаряжения…" />
          </Field>
        </FormSection>
      </form>

      <div className="pbth-newevent__bar">
        <Glass className="pbth-newevent__barglass">
          <Button variant="primary" block disabled={isSubmitting} aria-busy={isSubmitting} onClick={handleSubmit}>
            {isSubmitting ? 'Создаём…' : 'Создать событие'}
          </Button>
        </Glass>
      </div>
    </Screen>
  );
};
