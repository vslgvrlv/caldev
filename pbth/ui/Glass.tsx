import React from 'react';

export type GlassProps = React.HTMLAttributes<HTMLElement> & {
  /** 1 — панель на фоне, 2 — карточка поверх панели. */
  layer?: 1 | 2;
  as?: React.ElementType;
};

/** Стеклянная панель ui-kit (`.ui-glass`, `.ui-glass2`). */
export const Glass: React.FC<GlassProps> = ({ layer = 1, as: As = 'div', className, children, ...rest }) => (
  <As className={`${layer === 2 ? 'ui-glass2' : 'ui-glass'}${className ? ` ${className}` : ''}`} {...rest}>
    {children}
  </As>
);
