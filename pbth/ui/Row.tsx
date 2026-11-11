import React from 'react';
import { Icon } from './Icon';

export type RowProps = {
  /** Слева: Avatar, TeamMark или значок. */
  lead?: React.ReactNode;
  title: React.ReactNode;
  sub?: React.ReactNode;
  /** Справа: время, сумма, отметка. */
  trailing?: React.ReactNode;
  /** Стрелка справа: строка ведёт на другой экран. */
  chevron?: boolean;
  /** Элемент строки: `Link` из react-router, `a` или `button`. Без него и без onClick — обычный div. */
  as?: React.ElementType;
  onClick?: React.MouseEventHandler;
  className?: string;
  [key: string]: unknown;
};

/** Плотная строка списка: слева знак, по центру название и подпись, справа значение. Делится линией с соседней. */
export const Row: React.FC<RowProps> = ({ lead, title, sub, trailing, chevron, as, onClick, className, ...rest }) => {
  const As: React.ElementType = as ?? (onClick ? 'button' : 'div');
  return (
    <As
      className={`pbth-row${className ? ` ${className}` : ''}`}
      onClick={onClick}
      {...(As === 'button' ? { type: 'button' } : {})}
      {...rest}
    >
      {lead ? <span className="pbth-row__lead">{lead}</span> : null}
      <span className="pbth-row__main">
        <span className="pbth-row__title">{title}</span>
        {sub ? <span className="pbth-row__sub">{sub}</span> : null}
      </span>
      {trailing ? <span className="pbth-row__trail">{trailing}</span> : null}
      {chevron ? <Icon name="chevron-right" size={20} className="pbth-row__chev" /> : null}
    </As>
  );
};
