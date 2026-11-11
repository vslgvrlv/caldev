import React from 'react';
import { month, useUiMount } from './uikit';

export type MonthProps = {
  year: number;
  /** 1–12. */
  month: number;
  /** ISO-дата сегодняшнего дня, `2026-11-11`. */
  today?: string;
  selected?: string;
  /** Цвета точек под числом по ISO-дате: до трёх, дальше «+». */
  marks?: Record<string, string[]>;
  onSelect?: (iso: string) => void;
  onNav?: (to: { year: number; month: number }) => void;
};

export const mountMonth = (el: HTMLElement, c: MonthProps) => month.mount(el, c as unknown as Record<string, unknown>);

/** Сетка месяца ui-kit (`UI.month`). */
export const Month: React.FC<MonthProps> = (props) => {
  const cfg = React.useMemo(() => ({ ...props }), [props.year, props.month, props.today, props.selected, props.marks, props.onSelect, props.onNav]); // eslint-disable-line react-hooks/exhaustive-deps
  const ref = useUiMount(mountMonth, cfg);
  return <div ref={ref} />;
};
