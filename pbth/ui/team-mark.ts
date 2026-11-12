// ui-kit-allow-file: знак команды (фигура и краска), а не значок из набора Lucide; фигуры считаются в пикселях блока
// Знак команды: фигура из девяти силуэтов в цвете краски и две тёмные буквы.
// Капитан может выбрать краску, фигуру и буквы (оформление команды); пока поле
// не выбрано, краска и фигура берутся по id команды, буквы — из названия.

export const TEAM_PAINTS = ['#FF8A1F', '#4FC3F7', '#FF6B57', '#A58BFF', '#FFD23F', '#FF6FB0', '#F2F3F5', '#D9B98A', '#4F7CFF'] as const;

export const TEAM_SHAPE_COUNT = 9;

export const TEAM_INK = '#0B0F14';

type Shape = { name: string; d: (s: number) => string; ty: number };

const p = (s: number, v: number) => +(v * s).toFixed(2);
const pts = (s: number, list: [number, number][]) =>
  list.map(([x, y], i) => `${i ? 'L' : 'M'}${p(s, x)} ${p(s, y)}`).join(' ') + ' Z';

/**
 * Девять силуэтов семейства щитов; `ty` — высота центра букв в долях знака.
 * В каждом две самые широкие буквы («WW», «ЩЩ») при размерах текста из `markLetterSize` помещаются целиком:
 * у острых фигур (треугольник, ромб) для этого не хватало места, они заменены на шестиугольник и щит со скошенными плечами.
 */
export const TEAM_SHAPES: Shape[] = [
  {
    name: 'щит',
    ty: 0.36,
    d: (s) => `M${p(s, 0.1)} ${p(s, 0.05)} H${p(s, 0.9)} V${p(s, 0.55)} Q${p(s, 0.9)} ${p(s, 0.8)} ${p(s, 0.5)} ${p(s, 0.97)} Q${p(s, 0.1)} ${p(s, 0.8)} ${p(s, 0.1)} ${p(s, 0.55)} Z`,
  },
  {
    name: 'круг',
    ty: 0.48,
    d: (s) => `M${p(s, 0.04)} ${p(s, 0.5)} A${p(s, 0.46)} ${p(s, 0.46)} 0 1 1 ${p(s, 0.96)} ${p(s, 0.5)} A${p(s, 0.46)} ${p(s, 0.46)} 0 1 1 ${p(s, 0.04)} ${p(s, 0.5)} Z`,
  },
  {
    name: 'вымпел с ласточкиным хвостом',
    ty: 0.38,
    d: (s) => pts(s, [[0.06, 0.06], [0.94, 0.06], [0.94, 0.95], [0.5, 0.72], [0.06, 0.95]]),
  },
  {
    name: 'шестиугольник',
    ty: 0.5,
    d: (s) => pts(s, [[0.5, 0.02], [0.96, 0.26], [0.96, 0.74], [0.5, 0.98], [0.04, 0.74], [0.04, 0.26]]),
  },
  {
    name: 'щит с шевроном',
    ty: 0.38,
    d: (s) => pts(s, [[0.06, 0.05], [0.94, 0.05], [0.94, 0.6], [0.5, 0.97], [0.06, 0.6]]),
  },
  {
    name: 'квадрат со срезанными углами',
    ty: 0.5,
    d: (s) => pts(s, [[0.24, 0.06], [0.94, 0.06], [0.94, 0.76], [0.76, 0.94], [0.06, 0.94], [0.06, 0.24]]),
  },
  {
    name: 'щит с вырезом сверху',
    ty: 0.42,
    d: (s) => `M${p(s, 0.06)} ${p(s, 0.06)} H${p(s, 0.36)} L${p(s, 0.5)} ${p(s, 0.16)} L${p(s, 0.64)} ${p(s, 0.06)} H${p(s, 0.94)} V${p(s, 0.58)} Q${p(s, 0.94)} ${p(s, 0.82)} ${p(s, 0.5)} ${p(s, 0.96)} Q${p(s, 0.06)} ${p(s, 0.82)} ${p(s, 0.06)} ${p(s, 0.58)} Z`,
  },
  {
    name: 'щит с полукруглым низом',
    ty: 0.38,
    d: (s) => `M${p(s, 0.06)} ${p(s, 0.06)} H${p(s, 0.94)} V${p(s, 0.5)} A${p(s, 0.44)} ${p(s, 0.44)} 0 0 1 ${p(s, 0.06)} ${p(s, 0.5)} Z`,
  },
  {
    name: 'щит со скошенными плечами',
    ty: 0.4,
    d: (s) => pts(s, [[0.04, 0.22], [0.2, 0.05], [0.8, 0.05], [0.96, 0.22], [0.96, 0.62], [0.5, 0.97], [0.04, 0.62]]),
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

/** Оформление, которое выбрал капитан. Пустое поле — расчёт по умолчанию. */
export type TeamLook = {
  paint?: string | null;
  shape?: number | null;
  letters?: string | null;
  /** Свой логотип: адрес в приложении. Встаёт на место фигуры с буквами. */
  logo?: string | null;
};

/** Фигура по id команды — когда капитан свою не выбрал. */
export function defaultTeamShapeIndex(teamId: string | number): number {
  return hash(teamId) % TEAM_SHAPE_COUNT;
}

/** Краска по id команды — когда капитан свою не выбрал. */
export function defaultTeamPaint(teamId: string | number): string {
  return TEAM_PAINTS[Math.floor(hash(teamId) / TEAM_SHAPE_COUNT) % TEAM_PAINTS.length];
}

/** Краска из палитры (в верхнем регистре) или `null`: чужой цвет в знак не попадает. */
export function validPaint(paint: unknown): string | null {
  const value = String(paint ?? '').trim().toUpperCase();
  return (TEAM_PAINTS as readonly string[]).includes(value) ? value : null;
}

export function validShape(shape: unknown): number | null {
  return typeof shape === 'number' && Number.isInteger(shape) && shape >= 0 && shape < TEAM_SHAPE_COUNT ? shape : null;
}

/** Буквы знака, как их ввели: одна или две буквы или цифры, заглавными; иначе `null`. */
export function validLetters(letters: unknown): string | null {
  const chars = Array.from(String(letters ?? '').trim().toUpperCase());
  if (chars.length < 1 || chars.length > 2) return null;
  return chars.every((ch) => /^[\p{L}\p{N}]$/u.test(ch)) ? chars.join('') : null;
}

/**
 * Адрес логотипа или `null`. Берём только путь, под которым сервер отдаёт
 * перекодированный логотип (`/api/v1/teams/logo/<имя>.webp`): внешняя ссылка,
 * `javascript:` и любой другой адрес в знак не попадают.
 */
export function validLogo(logo: unknown): string | null {
  const value = String(logo ?? '');
  return /^\/api\/v1\/teams\/logo\/[0-9a-f]{32}\.webp$/.test(value) ? value : null;
}

// Сохранённое оформление команд: приходит с сервера вместе с командой
// (`look`) или событием (`teamLook`) и складывается сюда, чтобы знак и краска
// по id команды были одинаковыми на любом экране.
const looks = new Map<string, { paint: string | null; shape: number | null; letters: string | null; logo: string | null }>();
const listeners = new Set<() => void>();
let looksVersion = 0;

/** Запомнить оформление команды; `null` или пустое — вернуть расчёт по умолчанию. */
export function setTeamLook(teamId: string | number, look: TeamLook | null | undefined): void {
  const key = String(teamId);
  const next = {
    paint: validPaint(look?.paint),
    shape: validShape(look?.shape),
    letters: validLetters(look?.letters),
    logo: validLogo(look?.logo),
  };
  const empty = next.paint === null && next.shape === null && next.letters === null && next.logo === null;
  const prev = looks.get(key);
  const same = prev && prev.paint === next.paint && prev.shape === next.shape && prev.letters === next.letters && prev.logo === next.logo;
  if (empty ? !prev : same) return;
  if (empty) looks.delete(key);
  else looks.set(key, next);
  looksVersion += 1;
  listeners.forEach((fn) => fn());
}

export function savedTeamLook(teamId: string | number): TeamLook | null {
  return looks.get(String(teamId)) ?? null;
}

/** Подписка на смену оформления (для `useSyncExternalStore`). */
export function subscribeTeamLooks(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function teamLooksVersion(): number {
  return looksVersion;
}

/** Только для тестов: забыть всё сохранённое оформление. */
export function resetTeamLooks(): void {
  looks.clear();
  looksVersion += 1;
}

const isLook = (v: unknown): v is TeamLook | null => v === null || (typeof v === 'object' && !Array.isArray(v));

/**
 * Собрать оформление команд из ответа сервера: `{ id | teamId, look }` — команда,
 * `{ teamId, teamLook }` — событие, приглашение, слот. Обходит ответ целиком,
 * поэтому новая ручка с командой внутри не требует своей строки здесь.
 */
export function harvestTeamLooks(data: unknown, depth = 0): void {
  if (!data || typeof data !== 'object' || depth > 6) return;
  if (Array.isArray(data)) {
    for (const item of data) harvestTeamLooks(item, depth + 1);
    return;
  }
  const o = data as Record<string, unknown>;
  const id = typeof o.teamId === 'string' ? o.teamId : typeof o.id === 'string' ? o.id : null;
  if ('look' in o && id && isLook(o.look)) setTeamLook(id, o.look);
  if ('teamLook' in o && typeof o.teamId === 'string' && isLook(o.teamLook)) setTeamLook(o.teamId, o.teamLook);
  for (const key in o) {
    const value = o[key];
    if (value && typeof value === 'object') harvestTeamLooks(value, depth + 1);
  }
}

export function teamShapeIndex(teamId: string | number): number {
  return looks.get(String(teamId))?.shape ?? defaultTeamShapeIndex(teamId);
}

/** Краска команды (hex): выбранная капитаном, иначе по id. */
export function teamPaint(teamId: string | number): string {
  return looks.get(String(teamId))?.paint ?? defaultTeamPaint(teamId);
}

/** Первые буквы названия: два первых слова без слов в скобках, одно слово — его две первые буквы. */
function lettersOf(text?: string | null): string {
  const clean = (raw: string) => raw.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const source = String(text ?? '');
  const words = clean(source.replace(/\([^)]*(\)|$)/g, ' '));
  const use = words.length > 0 ? words : clean(source);
  if (use.length === 0) return '';
  const letters = use.length === 1 ? Array.from(use[0]).slice(0, 2).join('') : Array.from(use[0])[0] + Array.from(use[1])[0];
  return letters.toUpperCase();
}

/**
 * Две буквы знака, одни и те же для команды на любом экране: из названия, без слова в скобках
 * («Гроза (тест)» — «ГР», «Северный ветер (тест)» — «СВ», «Holy Guns» — «HG», «Тест · Гроза» — «ТГ»).
 * Короткий код нужен, только если в названии нет ни букв, ни цифр.
 */
export function teamLetters(name?: string | null, code?: string | null): string {
  return lettersOf(name) || lettersOf(code) || '·';
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export type TeamMarkSpec = {
  teamId: string | number;
  name?: string | null;
  code?: string | null;
  size?: number;
  /** Своя краска (hex) вместо краски команды. */
  paint?: string;
  /** Оформление вместо сохранённого: живой знак в настройке, пока капитан выбирает. */
  look?: TeamLook | null;
};

/** Размер букв знака из шкалы текста приложения. */
export function markLetterSize(size: number): number {
  if (size >= 96) return 28;
  if (size >= 52) return 20;
  if (size >= 38) return 14;
  return 12;
}

/** Заглавные Manrope 800: высота 0.72 em, у «Щ» и «Ц» хвостик ниже линии на 0.12 em, самая широкая буква («W») — 0.99 em. */
export const MARK_CAP_HEIGHT = 0.72;
export const MARK_TAIL = 0.12;
export const MARK_MAX_ADVANCE = 0.99;

/** Линия письма: заглавные стоят по центру `ty` (явная линия вместо `dominant-baseline`, он в Safari считается иначе). */
export function markBaseline(size: number, ty: number, fontSize: number): number {
  return +(size * ty + (MARK_CAP_HEIGHT / 2) * fontSize).toFixed(2);
}

/** Рамка текста знака (в пикселях блока): ширина по самым широким буквам, снизу с запасом на хвостики. */
export function markTextBox(shapeIndex: number, size: number, count = 2): { left: number; right: number; top: number; bottom: number } {
  const fs = markLetterSize(size);
  const base = markBaseline(size, TEAM_SHAPES[shapeIndex].ty, fs);
  const half = (count * MARK_MAX_ADVANCE * fs) / 2;
  return { left: size / 2 - half, right: size / 2 + half, top: base - MARK_CAP_HEIGHT * fs, bottom: base + MARK_TAIL * fs };
}

/** Скругление углов логотипа в долях стороны — как у фигур семейства щитов. */
export const LOGO_RADIUS = 0.22;

/**
 * Разметка знака в пикселях блока: width, height и viewBox равны `size`.
 * У команды со своим логотипом вместо фигуры с буквами — картинка того же размера.
 */
export function teamMarkSvg({ teamId, name, code, size = 40, paint, look }: TeamMarkSpec): string {
  const saved = look === undefined ? savedTeamLook(teamId) : look;
  const logo = validLogo(saved?.logo);
  if (logo) {
    return (
      `<img class="pbth-teammark" src="${logo}" width="${size}" height="${size}" alt="${esc(name ?? '')}" ` +
      `loading="lazy" decoding="async" draggable="false" ` +
      `style="display:block;flex:none;width:${size}px;height:${size}px;object-fit:cover;border-radius:${Math.round(size * LOGO_RADIUS)}px"/>`
    );
  }
  const shape = TEAM_SHAPES[validShape(saved?.shape) ?? defaultTeamShapeIndex(teamId)];
  const fill = /^#[0-9a-fA-F]{3,8}$/.test(paint ?? '') ? (paint as string) : (validPaint(saved?.paint) ?? defaultTeamPaint(teamId));
  const letters = esc(validLetters(saved?.letters) ?? teamLetters(name, code));
  // Размер букв — из шкалы 12/14/20/28: мелкий знак в ряду — 12, в строке — 14, крупный — 20, огромный — 28.
  const fs = markLetterSize(size);
  const label = esc(name ?? '');
  return (
    `<svg class="pbth-teammark" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${label}" focusable="false">` +
    `<path d="${shape.d(size)}" fill="${fill}"/>` +
    `<text x="${size / 2}" y="${markBaseline(size, shape.ty, fs)}" text-anchor="middle" fill="${TEAM_INK}" font-family="inherit" font-weight="800" font-size="${fs}">${letters}</text>` +
    `</svg>`
  );
}

/**
 * Адрес фотографии для круга аватара или `null` — тогда остаются инициалы.
 * Берём только http(s), data:image и пути приложения; пустое значение и
 * внешний генератор ui-avatars.com не используем.
 */
export function avatarPhotoSrc(src?: string | null): string | null {
  const value = String(src ?? '').trim();
  if (!value) return null;
  if (/ui-avatars\.com/i.test(value)) return null;
  if (/^(https?:\/\/|data:image\/|\/(?!\/))/i.test(value)) return value;
  return null;
}

/** Инициалы человека: первые буквы имени и фамилии. */
export function initialsOf(name?: string | null): string {
  return lettersOf(name) || '·';
}

/** Разметка аватара: круг на втором слое стекла с инициалами. */
export function avatarHtml(name?: string | null, size = 40): string {
  // Крупный аватар (профиль): буквы растут вместе с кругом; до 80px размеры прежние.
  const fs = size >= 80 ? 28 : size >= 56 ? 20 : size >= 40 ? 14 : 12;
  return (
    `<span class="ui-glass2" role="img" aria-label="${esc(name ?? '')}" style="display:inline-flex;align-items:center;justify-content:center;flex:none;` +
    `width:${size}px;height:${size}px;border-radius:50%;font-size:${fs}px;font-weight:700;color:var(--ui-text)">${esc(initialsOf(name))}</span>`
  );
}
