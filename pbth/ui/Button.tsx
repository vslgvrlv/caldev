import React from 'react';
import { Icon } from './Icon';

export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'glass2' | 'light' | 'danger';

export type ButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & {
  /** `primary` — зелёная, одна на экран; `glass2` — на стеклянной панели; `light` — светлая сплошная. */
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  /** Имя значка ui-kit перед подписью. */
  icon?: string;
  /** На всю ширину ряда. */
  block?: boolean;
  as?: React.ElementType;
  className?: string;
  [key: string]: unknown;
};

// Светлая сплошная — это главная кнопка ui-kit с акцентом, переопределённым только на ней.
const LIGHT: React.CSSProperties = {
  ['--ui-accent' as string]: 'var(--ui-text)',
  ['--ui-accent-text' as string]: 'var(--ui-bg)',
};

export const buttonClass = (variant: ButtonVariant = 'default', size: 'md' | 'sm' = 'md') =>
  ['ui-btn', variant === 'light' ? 'ui-btn--primary' : variant !== 'default' ? `ui-btn--${variant}` : '', size === 'sm' ? 'ui-btn--sm' : '']
    .filter(Boolean)
    .join(' ');

export const Button: React.FC<ButtonProps> = ({
  variant = 'default',
  size = 'md',
  icon,
  block,
  as: As = 'button',
  className,
  style,
  children,
  type,
  ...rest
}) => {
  const cls = `${buttonClass(variant, size)}${className ? ` ${className}` : ''}`;
  const st: React.CSSProperties = {
    ...(variant === 'light' ? LIGHT : null),
    ...(block ? { width: '100%' } : null),
    ...(style as React.CSSProperties),
  };
  return (
    <As className={cls} style={st} {...(As === 'button' ? { type: type ?? 'button' } : {})} {...rest}>
      {icon ? <Icon name={icon} size={18} /> : null}
      {children}
    </As>
  );
};
