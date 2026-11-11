import React from 'react';
import { Button, Glass, Icon, Row } from '../../ui';

type Props = {
  location?: string;
  locationUrl?: string;
  description?: string;
};

/** Место со ссылкой «Маршрут» и заметка капитана (описание события). */
export const EventPlace: React.FC<Props> = ({ location, locationUrl, description }) => (
  <>
    <Glass layer={1} className="pbth-event__line" data-testid="event-place">
      <Row
        lead={
          <Glass layer={2} className="pbth-event__icon">
            <Icon name="map-pin" size={20} />
          </Glass>
        }
        title={location || 'Место не указано'}
        trailing={
          location && locationUrl ? (
            <Button variant="glass2" as="a" icon="route" href={locationUrl} target="_blank" rel="noopener noreferrer">
              Маршрут
            </Button>
          ) : null
        }
      />
    </Glass>
    {description ? (
      <Glass layer={1} className="pbth-event__note" data-testid="event-note">
        <Icon name="message-circle" size={20} />
        <span>{description}</span>
      </Glass>
    ) : null}
  </>
);
