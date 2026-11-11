import React from 'react';
import { Button, Glass, TeamMark } from '../ui';
import type { TeamContext } from '../types';
import { teamCodeOf } from '../lib/team-url';
import { shouldCompact } from './section-head';
import './home.css';

export type SectionHeaderProps = {
  title: string;
  subtitle?: string;
  /** Тихая строка под подписью: режим, в котором человек смотрит команду («Владелец платформы»). */
  note?: string;
  teams: TeamContext[];
  /** Код текущей команды: её знак в ряду отмечен. Нет — не отмечен ни один. */
  currentCode?: string | null;
  /** Значки справа (расширения шапки: заявки, слоты). */
  badges?: React.ReactNode;
  onPickTeam: (team: TeamContext) => void;
  onOpenTeams: () => void;
  /** Высота шапки (с вырезом сверху) — под неё экран отступает. */
  onHeight?: (px: number) => void;
};

/** Прокручивает ряд знаков так, чтобы текущая команда была видна целиком. */
export function scrollMarkIntoView(row: HTMLElement, mark: HTMLElement) {
  const left = mark.offsetLeft - row.offsetLeft;
  if (left < row.scrollLeft) row.scrollLeft = left;
  else if (left + mark.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = left + mark.offsetWidth - row.clientWidth;
}

/**
 * Стеклянная шапка раздела (Моё, Календарь, Команда, Казна, Профиль): закреплена
 * сверху и закрывает своим стеклом вырез и часы, содержимое уходит под неё
 * размытым. Крупное название экрана, подпись, справа значки и «Команды», ниже
 * ряд знаков команд. Название и инструменты всегда в одной строке: не хватает
 * места — «Команды» остаётся значком без подписи.
 */
export const SectionHeader: React.FC<SectionHeaderProps> = ({ title, subtitle, note, teams, currentCode, badges, onPickTeam, onOpenTeams, onHeight }) => {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const topRef = React.useRef<HTMLDivElement>(null);
  const titlesRef = React.useRef<HTMLDivElement>(null);
  const toolsRef = React.useRef<HTMLDivElement>(null);
  const rowRef = React.useRef<HTMLDivElement>(null);
  const labelWidth = React.useRef(96);
  const [compact, setCompact] = React.useState(false);
  const compactRef = React.useRef(compact);
  compactRef.current = compact;

  React.useLayoutEffect(() => {
    const row = rowRef.current;
    const mark = row?.querySelector<HTMLElement>('[aria-current="true"]');
    if (row && mark) scrollMarkIntoView(row, mark);
  }, [currentCode, teams.length]);

  React.useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const top = topRef.current;
    const titles = titlesRef.current;
    const tools = toolsRef.current;
    if (!wrap || !top || !titles || !tools) return;
    const measure = () => {
      const btn = tools.querySelector<HTMLElement>('.pbth-sectionhead__teams');
      if (btn && !compactRef.current) labelWidth.current = Math.max(0, btn.offsetWidth - 44);
      const titleWidth = Math.max(0, ...Array.from(titles.children).map((el) => (el as HTMLElement).scrollWidth));
      const next = shouldCompact({
        rowWidth: top.clientWidth,
        titleWidth,
        toolsWidth: tools.offsetWidth,
        labelWidth: labelWidth.current,
        compact: compactRef.current,
      });
      if (next !== compactRef.current) setCompact(next);
      onHeight?.(wrap.offsetHeight);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    ro.observe(top);
    ro.observe(tools);
    return () => ro.disconnect();
  }, [onHeight, title, subtitle]);

  return (
    <div ref={wrapRef} className="pbth-sectionhead">
      <Glass as="header" className="pbth-sectionhead__bar">
        <div ref={topRef} className="pbth-sectionhead__top">
          <div ref={titlesRef} className="pbth-sectionhead__titles">
            <h1 className="pbth-sectionhead__title">{title}</h1>
            {subtitle ? <div className="pbth-sectionhead__sub">{subtitle}</div> : null}
          </div>
          <div ref={toolsRef} className="pbth-sectionhead__tools">
            {badges}
            <Button
              variant="ghost"
              icon="sliders-horizontal"
              className="pbth-sectionhead__teams"
              aria-label={compact ? 'Команды' : undefined}
              onClick={onOpenTeams}
            >
              {compact ? null : 'Команды'}
            </Button>
          </div>
        </div>
        {note ? <div className="pbth-sectionhead__note">{note}</div> : null}
        {teams.length > 0 && (
          <div ref={rowRef} className="pbth-sectionhead__marks" role="list" aria-label="Команды">
            {teams.map((t) => {
              const current = Boolean(currentCode) && teamCodeOf({ teamId: t.teamId, shortCode: t.shortCode }) === currentCode;
              return (
                <button
                  key={t.teamId}
                  type="button"
                  role="listitem"
                  className="pbth-sectionhead__mark"
                  aria-current={current ? 'true' : undefined}
                  aria-label={`Команда ${t.teamName}`}
                  onClick={() => onPickTeam(t)}
                >
                  <TeamMark teamId={t.teamId} name={t.teamName} code={t.shortCode} size={32} />
                </button>
              );
            })}
          </div>
        )}
      </Glass>
    </div>
  );
};
