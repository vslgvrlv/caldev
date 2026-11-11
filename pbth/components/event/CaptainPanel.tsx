import React from 'react';
import { Button, Glass, Icon } from '../../ui';

export type PanelTile = {
  key: string;
  icon: string;
  title: string;
  sub: string;
  onClick: () => void;
  disabled?: boolean;
};

type Props = {
  title: string;
  /** Справа в шапке панели, например «3 не ответили». */
  aside?: string;
  tiles: PanelTile[];
  onMore?: () => void;
};

/** Одна панель управления вместо россыпи кнопок: плитки 2×2 и «Ещё». */
export const CaptainPanel: React.FC<Props> = ({ title, aside, tiles, onMore }) => (
  <Glass layer={1} className="pbth-event__panel" data-testid="event-captain-panel">
    <div className="pbth-event__head">
      <h2 className="pbth-event__h">{title}</h2>
      {aside ? <span className="pbth-event__muted">{aside}</span> : null}
    </div>
    {tiles.length > 0 ? (
      <div className="pbth-event__tiles">
        {tiles.map((tile) => (
          <Button key={tile.key} variant="glass2" className="pbth-event__tile" disabled={tile.disabled} onClick={tile.onClick}>
            <Icon name={tile.icon} size={20} />
            <span className="pbth-event__tile-text">
              <span className="pbth-event__tile-title">{tile.title}</span>
              <span className="pbth-event__tile-sub">{tile.sub}</span>
            </span>
          </Button>
        ))}
      </div>
    ) : null}
    {onMore ? (
      <Button variant="ghost" icon="ellipsis" onClick={onMore}>
        Ещё
      </Button>
    ) : null}
  </Glass>
);
