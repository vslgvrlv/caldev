import React from 'react';
import { RSVPStatus } from '../../types';
import { Button, Glass, Icon } from '../../ui';
import { seriesUpcomingText, type OwnAnswer } from '../../lib/event-view';

export type SeriesState = {
  committed: boolean;
  upcomingCount: number;
  busy: boolean;
  onCommit: () => void;
  onLeave: () => void;
};

type Props = {
  dateLabel: string;
  clock: string;
  until: string;
  /** Название события, если оно говорит больше типа («Тренировка» не повторяем). */
  title?: string;
  location?: string;
  typeIcon: string;
  isSeries: boolean;
  canAnswer: boolean;
  answer: OwnAnswer;
  onAnswer: (status: RSVPStatus) => void;
  series: SeriesState | null;
};

/** Первый блок: когда и где, и сразу свой ответ. */
export const EventHero: React.FC<Props> = ({
  dateLabel,
  clock,
  until,
  title,
  location,
  typeIcon,
  isSeries,
  canAnswer,
  answer,
  onAnswer,
  series,
}) => {
  const [changing, setChanging] = React.useState(false);
  const pick = (status: RSVPStatus) => {
    setChanging(false);
    onAnswer(status);
  };
  const settled = (answer === 'going' || answer === 'declined') && !changing;

  return (
    <Glass layer={1} className="pbth-event__hero" data-testid="event-hero">
      <div className="pbth-event__when">
        <Icon name={typeIcon} size={20} />
        <span>{dateLabel}</span>
        {isSeries ? <span className="ui-chip">Серия</span> : null}
      </div>
      {title ? <div className="pbth-event__title">{title}</div> : null}
      <div className="pbth-event__time">
        <span className="pbth-event__clock">{clock}</span>
        {until ? <span className="pbth-event__until">{until}</span> : null}
      </div>
      <div className="pbth-event__place">
        <Icon name="map-pin" size={20} />
        <span>{location || 'Место не указано'}</span>
      </div>

      {canAnswer ? (
        settled ? (
          <>
            <Glass layer={2} className="pbth-event__answered" data-testid="event-answered">
              <span className={`pbth-event__answered-text${answer === 'going' ? ' pbth-event__answered-text--yes' : ''}`}>
                <Icon name={answer === 'going' ? 'check' : 'x'} size={20} />
                {answer === 'going' ? 'Ты идёшь' : isSeries ? 'Ты не придёшь' : 'Ты не идёшь'}
              </span>
              <Button variant="glass2" onClick={() => setChanging(true)}>
                Передумал
              </Button>
            </Glass>
            {isSeries && series?.committed ? (
              <div className="pbth-event__caption">Это меняет только это занятие. На серию ты по-прежнему записан.</div>
            ) : null}
          </>
        ) : (
          <>
            {isSeries ? <div className="pbth-event__caption">Только это занятие</div> : null}
            <div className="pbth-event__answer">
              <Button variant="primary" icon="check" onClick={() => pick(RSVPStatus.CONFIRMED)}>
                Иду
              </Button>
              <Button variant="glass2" onClick={() => pick(RSVPStatus.DECLINED)}>
                {isSeries ? 'Не приду' : 'Не иду'}
              </Button>
            </div>
            <div className="pbth-event__quiet">
              <span className="pbth-event__caption">{answer === 'pending' ? 'Сейчас стоит «Думаю»' : ' '}</span>
              {answer === 'pending' ? null : (
                <Button variant="ghost" size="sm" onClick={() => pick(RSVPStatus.PENDING)}>
                  Пока думаю
                </Button>
              )}
            </div>
          </>
        )
      ) : null}

      {canAnswer && series ? (
        <Glass layer={2} className="pbth-event__series" data-testid="event-series">
          <Icon name="repeat" size={20} />
          <span className="pbth-event__series-text">
            <span className="pbth-event__series-title">{series.committed ? 'Ты ходишь на серию' : 'Это серия занятий'}</span>
            <span className="pbth-event__caption">
              {series.committed
                ? 'По умолчанию ты идёшь на каждое занятие. На любом можно отметить «сегодня не приду».'
                : seriesUpcomingText(series.upcomingCount)}
            </span>
          </span>
          {series.committed ? (
            <Button variant="glass2" size="sm" disabled={series.busy} onClick={series.onLeave}>
              {series.busy ? 'Сохраняем…' : 'Выйти'}
            </Button>
          ) : (
            <Button variant="glass2" size="sm" disabled={series.busy} onClick={series.onCommit}>
              {series.busy ? 'Записываем…' : 'Иду на все'}
            </Button>
          )}
        </Glass>
      ) : null}
    </Glass>
  );
};
