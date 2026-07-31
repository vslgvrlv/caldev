import React from 'react';

// Счёт гейма читается так же, как на regevent.ru, откуда капитан переносит
// результаты: «наша команда [очки][очки] соперник», зелёный бейдж — победа,
// красный — поражение, серый — ничья либо счёт ещё не проставлен.
//
// Раньше в расписании была только строка `{opponent}` и «4:3» сбоку: чьи 4 —
// непонятно, а длинное имя соперника обрезалось через truncate. Здесь имена
// переносятся по словам и не теряются.

type Props = {
  teamName: string;
  opponent: string;
  /** Формат «наш:чужой» (backend/src/lib/game-points.ts). */
  score?: string | null;
  size?: 'sm' | 'md';
};

export const parseScore = (score?: string | null): { ours: number; theirs: number } | null => {
  const match = String(score ?? '').match(/^\s*(\d+)\s*:\s*(\d+)\s*$/);
  if (!match) return null;
  return { ours: Number(match[1]), theirs: Number(match[2]) };
};

const badgeClass = (self: number | null, other: number | null) => {
  if (self === null || other === null) return 'bg-white/10 text-pb-subtext border-white/10';
  if (self > other) return 'bg-pb-primary text-pb-background border-pb-primary';
  if (self < other) return 'bg-pb-danger/20 text-pb-danger border-pb-danger/40';
  return 'bg-white/15 text-white border-white/20';
};

export const GameScoreLine: React.FC<Props> = ({ teamName, opponent, score, size = 'sm' }) => {
  const parsed = parseScore(score);
  const ours = parsed ? parsed.ours : null;
  const theirs = parsed ? parsed.theirs : null;

  const nameClass = size === 'md' ? 'text-base font-bold' : 'text-sm font-bold';
  const badgeSize = size === 'md' ? 'w-8 h-8 text-sm' : 'w-6 h-6 text-xs';

  return (
    <div className="flex items-center gap-1 min-w-0">
      <span className={`flex-1 min-w-0 text-right text-white break-words ${nameClass}`}>{teamName}</span>
      <span className="flex items-center gap-0.5 shrink-0">
        <span
          className={`${badgeSize} rounded-md border font-mono font-bold flex items-center justify-center ${badgeClass(ours, theirs)}`}
        >
          {ours ?? '–'}
        </span>
        <span
          className={`${badgeSize} rounded-md border font-mono font-bold flex items-center justify-center ${badgeClass(theirs, ours)}`}
        >
          {theirs ?? '–'}
        </span>
      </span>
      <span className={`flex-1 min-w-0 text-left text-white break-words ${nameClass}`}>{opponent}</span>
    </div>
  );
};

export default GameScoreLine;
