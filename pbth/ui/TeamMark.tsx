import React from 'react';
import { teamMarkSvg, type TeamMarkSpec } from './team-mark';

export { teamPaint } from './team-mark';

export type TeamMarkProps = TeamMarkSpec & { className?: string };

/** Знак команды: фигура цвета краски и две буквы. Размер — сторона квадрата в пикселях. */
export const TeamMark: React.FC<TeamMarkProps> = ({ className, ...spec }) => (
  <span
    className={className}
    style={{ display: 'inline-flex', flex: 'none', lineHeight: 0 }}
    dangerouslySetInnerHTML={{ __html: teamMarkSvg(spec) }}
  />
);

export type TeamMarkPairProps = {
  a: Omit<TeamMarkSpec, 'size'>;
  b: Omit<TeamMarkSpec, 'size'>;
  size?: number;
};

/** Два знака внахлёст: для встречи двух команд. Второй лежит поверх первого. */
export const TeamMarkPair: React.FC<TeamMarkPairProps> = ({ a, b, size = 40 }) => (
  <span style={{ display: 'inline-flex', flex: 'none', alignItems: 'center' }}>
    <TeamMark {...a} size={size} />
    <span style={{ marginLeft: -Math.round(size * 0.3), display: 'inline-flex' }}>
      <TeamMark {...b} size={size} />
    </span>
  </span>
);
