import React from 'react';
import { Button, Sheet } from '../../ui';

export type MoreItem = { key: string; icon: string; label: string; danger?: boolean; onClick: () => void };

/** «Ещё» капитана: остальные действия списком, чтобы не раскладывать их по экрану. */
export const MoreSheet: React.FC<{ items: MoreItem[]; onClose: () => void }> = ({ items, onClose }) => (
  <Sheet open onClose={onClose} title="Ещё">
    <div className="pbth-event__menu">
      {items.map((item) => (
        <Button
          key={item.key}
          variant={item.danger ? 'danger' : 'glass2'}
          icon={item.icon}
          onClick={() => {
            onClose();
            item.onClick();
          }}
        >
          {item.label}
        </Button>
      ))}
    </div>
  </Sheet>
);
