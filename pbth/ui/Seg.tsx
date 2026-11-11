import React from 'react';
import { UI, useUiMount, type Handle } from './uikit';

export type SegItem = { value: string; label: string; icon?: string };

export type SegProps = {
  items: SegItem[];
  value: string;
  onChange: (value: string) => void;
  /** Подпись группы для скринридера. */
  label?: string;
  /** Раздельные кнопки с рамкой вместо общей дорожки. */
  split?: boolean;
  /** Растянуть на ширину ряда. */
  fill?: boolean;
};

type Cfg = { items: SegItem[]; value: string; label?: string; onChange: (v: string) => void; split?: boolean; fill?: boolean };

export const mountSeg = (el: HTMLElement, cfg: Cfg): Handle => {
  const s = UI.seg.mount(el, { items: cfg.items, value: cfg.value, label: cfg.label, onChange: (v: string) => cfgRef.get(el)?.onChange(v) });
  cfgRef.set(el, cfg);
  if (cfg.split) s.el.classList.add('ui-seg--split');
  if (cfg.fill) s.el.classList.add('ui-seg--fill');
  return {
    el: s.el,
    update: (c: Cfg) => {
      cfgRef.set(el, c);
      if (s.get() !== c.value) s.set(c.value);
    },
    destroy: () => {
      cfgRef.delete(el);
      s.el.remove();
    },
  };
};
// Свежий onChange на каждый рендер без перемонтирования сегментов.
const cfgRef = new WeakMap<HTMLElement, Cfg>();

const SegInner: React.FC<SegProps> = (props) => {
  const cfg = React.useMemo(() => props, [props.items, props.value, props.label, props.onChange, props.split, props.fill]); // eslint-disable-line react-hooks/exhaustive-deps
  const ref = useUiMount<Cfg>(mountSeg, cfg);
  return <div ref={ref} />;
};

/** Сегменты ui-kit. Набор вариантов поменялся — сегменты строятся заново. */
export const Seg: React.FC<SegProps> = (props) => (
  <SegInner key={props.items.map((i) => `${i.value}:${i.label}:${i.icon ?? ''}`).join('|')} {...props} />
);
