import React from 'react';
import { ICONS_HREF } from './uikit';

export type IconProps = {
  /** Имя из набора Lucide в `icons.list` ui-kit, например `calendar`. */
  name: string;
  size?: number;
  /** Подпись для скринридера; без неё значок скрыт от него. */
  label?: string;
  className?: string;
};

/** Значок ui-kit (Lucide). Своих SVG-значков рисовать нельзя. */
export const Icon: React.FC<IconProps> = ({ name, size = 20, label, className }) => {
  if (!/^[a-z0-9-]+$/.test(name)) return null;
  return (
    <svg
      className={`ui-icon ui-icon-${name}${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      <use href={`${ICONS_HREF}#ui-i-${name}`} />
    </svg>
  );
};
