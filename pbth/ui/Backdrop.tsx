import React from 'react';

export type BackdropProps = {
  /** До трёх цветов красок экрана (hex); не заданы — только слабое холодное пятно. */
  paints?: string[];
};

const VARS = ['--ui-paint-1', '--ui-paint-2', '--ui-paint-3'];

/**
 * Фон со смазанными пятнами красок за стеклом. Тема читает краски с корня
 * страницы, поэтому переменные выставляются на `<html>` и снимаются при уходе.
 */
export const Backdrop: React.FC<BackdropProps> = ({ paints }) => {
  const key = (paints ?? []).join('|');
  React.useLayoutEffect(() => {
    const root = document.documentElement;
    const list = key ? key.split('|') : [];
    VARS.forEach((v, i) => {
      if (list[i]) root.style.setProperty(v, list[i]);
      else root.style.removeProperty(v);
    });
    return () => VARS.forEach((v) => root.style.removeProperty(v));
  }, [key]);
  return <div className="ui-backdrop" aria-hidden="true" />;
};
