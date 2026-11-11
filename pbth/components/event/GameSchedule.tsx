import React from 'react';
import type { Game } from '../../types';
import { Button, Glass, Row } from '../../ui';
import { parseScore } from '../GameScoreLine';
import {
  GAME_PAIR_LABELS,
  PIT_ZONE_BADGE,
  normalizeTimeForInput,
} from '../../lib/event-view';

type Props = {
  games: Game[];
  teamName: string;
  canTable: boolean;
  canAdd: boolean;
  onTable: () => void;
  onAdd: () => void;
  onOpenGame: (game: Game) => void;
  onPoints: (game: Game) => void;
};

/** «Мы N:N соперник»: имена переносятся по словам, счёт — чипом (победа, поражение, ничья). */
const GameLine: React.FC<{ teamName: string; opponent: string; score?: string | null }> = ({ teamName, opponent, score }) => {
  const parsed = parseScore(score);
  const tone = !parsed ? 'ui-chip--muted' : parsed.ours > parsed.theirs ? 'ui-chip--success' : parsed.ours < parsed.theirs ? 'ui-chip--danger' : 'ui-chip--muted';
  return (
    <span className="pbth-event__gameline">
      <span>{teamName}</span>
      <span className={`ui-chip ${tone}`}>{parsed ? `${parsed.ours}:${parsed.theirs}` : '—'}</span>
      <span>{opponent}</span>
    </span>
  );
};

/** Расписание игр события: время, счёт, пара и пит-зона; пойнты и карточка игры. */
export const GameSchedule: React.FC<Props> = ({ games, teamName, canTable, canAdd, onTable, onAdd, onOpenGame, onPoints }) => (
  <Glass layer={1} className="pbth-event__panel" data-testid="event-games">
    <div className="pbth-event__blockhead">
      <h2 className="pbth-event__h">Расписание игр</h2>
      <div className="pbth-event__actions">
        {canTable ? (
          <Button variant="ghost" size="sm" icon="clipboard-list" onClick={onTable}>
            Разбор
          </Button>
        ) : null}
        {canAdd ? (
          <Button variant="ghost" size="sm" icon="plus" onClick={onAdd}>
            Добавить
          </Button>
        ) : null}
      </div>
    </div>
    {games.length === 0 ? <div className="pbth-event__empty">Расписание пока не добавлено.</div> : null}
    <div className="pbth-event__games">
      {games.map((game) => (
        <Row
          key={game.id}
          lead={<span className="pbth-event__gametime">{normalizeTimeForInput(game.time) || game.time}</span>}
          title={
            <button type="button" className="pbth-event__linkbtn" onClick={() => onOpenGame(game)}>
              <GameLine teamName={teamName} opponent={game.opponent} score={game.score} />
            </button>
          }
          sub={[game.gamePair ? GAME_PAIR_LABELS[game.gamePair] : 'Пара не указана', game.pitZone ? `${PIT_ZONE_BADGE[game.pitZone]} пит-зона` : '']
            .filter(Boolean)
            .join(' · ')}
          trailing={
            <Button variant="glass2" size="sm" icon="swords" onClick={() => onPoints(game)}>
              Пойнты
            </Button>
          }
        />
      ))}
    </div>
  </Glass>
);
