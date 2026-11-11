// ui-kit-allow-file: знак команды (фигура и краска), а не значок из набора Lucide; фигуры считаются в пикселях блока
// Знак команды: фигура из девяти силуэтов в цвете краски и две тёмные буквы.
// Пока у команды нет своих фигуры и краски, они выбираются по id команды.

export const TEAM_PAINTS = ['#FF8A1F', '#4FC3F7', '#FF6B57', '#A58BFF', '#FFD23F', '#FF6FB0', '#F2F3F5', '#D9B98A', '#4F7CFF'] as const;

export const TEAM_SHAPE_COUNT = 9;

export const TEAM_INK = '#0B0F14';

type Shape = { name: string; d: (s: number) => string; ty: number };

const p = (s: number, v: number) => +(v * s).toFixed(2);
const pts = (s: number, list: [number, number][]) =>
  list.map(([x, y], i) => `${i ? 'L' : 'M'}${p(s, x)} ${p(s, y)}`).join(' ') + ' Z';

/** Девять силуэтов; `ty` — высота центра букв в долях знака. */
export const TEAM_SHAPES: Shape[] = [
  {
    name: 'щит',
    ty: 0.46,
    d: (s) => `M${p(s, 0.1)} ${p(s, 0.05)} H${p(s, 0.9)} V${p(s, 0.55)} Q${p(s, 0.9)} ${p(s, 0.8)} ${p(s, 0.5)} ${p(s, 0.97)} Q${p(s, 0.1)} ${p(s, 0.8)} ${p(s, 0.1)} ${p(s, 0.55)} Z`,
  },
  {
    name: 'круг',
    ty: 0.5,
    d: (s) => `M${p(s, 0.04)} ${p(s, 0.5)} A${p(s, 0.46)} ${p(s, 0.46)} 0 1 1 ${p(s, 0.96)} ${p(s, 0.5)} A${p(s, 0.46)} ${p(s, 0.46)} 0 1 1 ${p(s, 0.04)} ${p(s, 0.5)} Z`,
  },
  {
    name: 'вымпел с ласточкиным хвостом',
    ty: 0.42,
    d: (s) => pts(s, [[0.1, 0.06], [0.9, 0.06], [0.9, 0.95], [0.5, 0.72], [0.1, 0.95]]),
  },
  {
    name: 'ромб',
    ty: 0.5,
    d: (s) => pts(s, [[0.5, 0.02], [0.98, 0.5], [0.5, 0.98], [0.02, 0.5]]),
  },
  {
    name: 'щит с шевроном',
    ty: 0.4,
    d: (s) => pts(s, [[0.08, 0.05], [0.92, 0.05], [0.92, 0.6], [0.5, 0.97], [0.08, 0.6]]),
  },
  {
    name: 'квадрат со срезанными углами',
    ty: 0.5,
    d: (s) => pts(s, [[0.26, 0.06], [0.94, 0.06], [0.94, 0.74], [0.74, 0.94], [0.06, 0.94], [0.06, 0.26]]),
  },
  {
    name: 'щит с вырезом сверху',
    ty: 0.5,
    d: (s) => `M${p(s, 0.06)} ${p(s, 0.06)} H${p(s, 0.36)} L${p(s, 0.5)} ${p(s, 0.18)} L${p(s, 0.64)} ${p(s, 0.06)} H${p(s, 0.94)} V${p(s, 0.56)} Q${p(s, 0.94)} ${p(s, 0.82)} ${p(s, 0.5)} ${p(s, 0.96)} Q${p(s, 0.06)} ${p(s, 0.82)} ${p(s, 0.06)} ${p(s, 0.56)} Z`,
  },
  {
    name: 'щит с полукруглым низом',
    ty: 0.42,
    d: (s) => `M${p(s, 0.08)} ${p(s, 0.06)} H${p(s, 0.92)} V${p(s, 0.5)} A${p(s, 0.42)} ${p(s, 0.42)} 0 0 1 ${p(s, 0.08)} ${p(s, 0.5)} Z`,
  },
  {
    name: 'вымпел-треугольник',
    ty: 0.34,
    d: (s) => pts(s, [[0.06, 0.06], [0.94, 0.06], [0.5, 0.96]]),
  },
];

function hash(id: string | number): number {
  let h = 0x811c9dc5;
  const str = String(id);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function teamShapeIndex(teamId: string | number): number {
  return hash(teamId) % TEAM_SHAPE_COUNT;
}

/** Краска команды (hex) по id; пока у команды нет своей. */
export function teamPaint(teamId: string | number): string {
  return TEAM_PAINTS[Math.floor(hash(teamId) / TEAM_SHAPE_COUNT) % TEAM_PAINTS.length];
}

/** Две буквы знака: из короткого кода, иначе из названия. */
export function teamLetters(name?: string | null, code?: string | null): string {
  const c = (code ?? '').trim();
  if (c) return Array.from(c).slice(0, 2).join('').toUpperCase();
  const words = (name ?? '')
    .replace(/[«»"'()]/g, ' ')
    .split(/[\s\-–—_]+/)
    .filter(Boolean);
  if (words.length === 0) return '·';
  if (words.length === 1) return Array.from(words[0]).slice(0, 2).join('').toUpperCase();
  return (Array.from(words[0])[0] + Array.from(words[1])[0]).toUpperCase();
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export type TeamMarkSpec = {
  teamId: string | number;
  name?: string | null;
  code?: string | null;
  size?: number;
  /** Своя краска (hex) вместо выбранной по id. */
  paint?: string;
};

/** Разметка знака в пикселях блока: width, height и viewBox равны `size`. */
export function teamMarkSvg({ teamId, name, code, size = 40, paint }: TeamMarkSpec): string {
  const shape = TEAM_SHAPES[teamShapeIndex(teamId)];
  const fill = /^#[0-9a-fA-F]{3,8}$/.test(paint ?? '') ? (paint as string) : teamPaint(teamId);
  const letters = esc(teamLetters(name, code));
  const fs = +(size * 0.34).toFixed(1);
  const label = esc(name ?? '');
  return (
    `<svg class="pbth-teammark" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${label}" focusable="false">` +
    `<path d="${shape.d(size)}" fill="${fill}"/>` +
    `<text x="${size / 2}" y="${+(size * shape.ty).toFixed(2)}" text-anchor="middle" dominant-baseline="central" fill="${TEAM_INK}" font-family="inherit" font-weight="800" font-size="${fs}">${letters}</text>` +
    `</svg>`
  );
}

/** Инициалы человека: первые буквы имени и фамилии. */
export function initialsOf(name?: string | null): string {
  const words = (name ?? '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return '·';
  if (words.length === 1) return Array.from(words[0]).slice(0, 2).join('').toUpperCase();
  return (Array.from(words[0])[0] + Array.from(words[1])[0]).toUpperCase();
}

/** Разметка аватара: круг на втором слое стекла с инициалами. */
export function avatarHtml(name?: string | null, size = 40): string {
  const fs = size >= 56 ? 20 : size >= 40 ? 14 : 12;
  return (
    `<span class="ui-glass2" role="img" aria-label="${esc(name ?? '')}" style="display:inline-flex;align-items:center;justify-content:center;flex:none;` +
    `width:${size}px;height:${size}px;border-radius:50%;font-size:${fs}px;font-weight:700;color:var(--ui-text)">${esc(initialsOf(name))}</span>`
  );
}
