import React from 'react';
import { Backdrop } from './Backdrop';
import './pbth-ui.css';

export type ScreenProps = {
  /** Краски экрана за стеклом (до трёх hex). */
  paints?: string[];
  className?: string;
  children?: React.ReactNode;
};

/** Обёртка нового экрана: тёмный фон темы, шрифт Manrope, краски за стеклом. Старые экраны её не используют. */
export const Screen: React.FC<ScreenProps> = ({ paints, className, children }) => (
  <div className={`pbth-ui${className ? ` ${className}` : ''}`}>
    <Backdrop paints={paints} />
    <div className="pbth-ui__content">{children}</div>
  </div>
);
