import React from 'react';
import { ArrowLeftRight } from 'lucide-react';
import type { FieldPosition } from '../types';
import { buildFieldLayout, type FieldRow } from '../lib/field-schema-layout';

// Схема поля целиком, 9 рядов. Выбор позиции — тап по клетке, клавиатура не
// открывается: печатать «полтинник» человеку после пойнта нечем и незачем.
// Раскладка рядов — в lib/field-schema-layout.

type Props = {
  positions: FieldPosition[];
  value: string | null;
  onChange: (positionId: string | null) => void;
  swapped: boolean;
  onSwap: () => void;
};

export const FieldSchema: React.FC<Props> = ({ positions, value, onChange, swapped, onSwap }) => {
  const { far: farRows, center, near: nearRows } = buildFieldLayout(positions, swapped);

  const cell = (position?: FieldPosition) => {
    if (!position) return <div />;
    const selected = position.id === value;
    return (
      <button
        type="button"
        key={position.id}
        // Половина поля подписана заголовком схемы, поэтому на кнопке короткий
        // код без Б/Д. Полный код остаётся в подсказке — им говорят на разборе.
        title={`${position.label} · ${position.code}`}
        onClick={() => onChange(selected ? null : position.id)}
        className={`h-9 rounded-lg text-[11px] font-mono font-bold transition-colors border ${
          selected
            ? 'bg-pb-primary text-pb-background border-pb-primary'
            : 'bg-white/5 text-pb-subtext border-white/10 hover:border-pb-primary/40'
        }`}
      >
        {position.shortCode}
      </button>
    );
  };

  const renderRow = (row: FieldRow) => (
    <div key={row.key} className="grid grid-cols-7 gap-1">
      {cell(row.left)}
      {row.grid.length ? row.grid.map((p) => cell(p)) : <div className="col-span-5" />}
      {cell(row.right)}
    </div>
  );

  return (
    <div className="space-y-1">
      <div className="text-center text-[10px] uppercase tracking-wider text-pb-subtext">База противника</div>
      {farRows.map(renderRow)}

      <div className="flex items-center gap-2 py-1">
        <div className="h-px flex-1 bg-pb-primary/30" />
        <span className="text-[9px] uppercase tracking-wider text-pb-subtext">центр · общая</span>
        <div className="h-px flex-1 bg-pb-primary/30" />
      </div>
      <div className="grid grid-cols-7 gap-1">
        <div />
        {center.map((p) => cell(p))}
        <div />
      </div>
      <div className="h-px bg-pb-primary/30 my-1" />

      {nearRows.map(renderRow)}
      <div className="text-center text-[10px] uppercase tracking-wider text-pb-subtext">Наша база</div>

      <button
        type="button"
        onClick={onSwap}
        className="w-full mt-2 flex items-center justify-center gap-2 text-xs text-pb-subtext hover:text-pb-primary py-2"
      >
        <ArrowLeftRight size={14} />
        Поменять фланги местами
      </button>
    </div>
  );
};
