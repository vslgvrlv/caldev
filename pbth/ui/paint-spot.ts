// Пятна красок за стеклом: насколько ярким можно сделать пятно краски, чтобы
// приглушённый текст на стекле над его центром читался (контраст не ниже 4,5).
// Белая и жёлтая краски светлые, поэтому их пятно слабее, чем у тёмно-синей.

/** Фон страницы в новом виде: тёмный с лёгким зелёным тоном (см. pbth-ui.css). */
export const PAGE_BG = '#070B09';
/** Приглушённый текст темы pbth. */
export const MUTED_TEXT = '#C0C6CE';
/** Акцент темы: его тонкая дымка лежит вверху фона. */
export const ACCENT = '#00E676';
/**
 * Дымка акцента там, где пик первого пятна. В CSS дымка 12 % в левом верхнем углу (6% 0, радиус 560×520,
 * тает к 72 %), пятно — справа (74% 230px): на ширине 320–480 px в центре пятна от дымки остаётся 1–2 %.
 * Берём 3 % с запасом.
 */
export const ACCENT_WASH = 0.03;
/** Непрозрачность белого стекла первого слоя (pbth-ui.css: --ui-glass-bg). */
export const GLASS_ALPHA = 0.06;
/** Непрозрачность первого пятна в CSS (pbth-ui.css: 32%); краска приходит с альфой, которая её ослабляет. */
export const SPOT_PEAK = 0.32;
/** Запас к порогу 4,5: размытие и сглаживание не должны его съесть. */
export const MIN_CONTRAST = 4.6;

type Rgb = [number, number, number];

export function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

const channel = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return a.map((v, i) => v * (1 - t) + b[i] * t) as Rgb;
}

const WHITE: Rgb = [255, 255, 255];

/** Цвет стекла над центром пятна краски `paint` силой `alpha`. */
export function glassOverSpot(paint: string, alpha: number): Rgb {
  const base = mix(parseHex(PAGE_BG)!, parseHex(ACCENT)!, ACCENT_WASH);
  const under = mix(base, parseHex(paint) ?? base, alpha);
  return mix(under, WHITE, GLASS_ALPHA);
}

/**
 * Сила пятна краски (0…SPOT_PEAK): самая большая, при которой приглушённый
 * текст на стекле над центром пятна держит контраст MIN_CONTRAST.
 */
export function paintStrength(paint: string): number {
  if (!parseHex(paint)) return 0;
  const muted = parseHex(MUTED_TEXT)!;
  let best = 0;
  for (let step = 0; step <= Math.round(SPOT_PEAK * 100); step += 1) {
    const alpha = step / 100;
    if (contrastRatio(muted, glassOverSpot(paint, alpha)) >= MIN_CONTRAST) best = alpha;
    else break;
  }
  return best;
}

/**
 * Значение переменной `--ui-paint-N`: краска с альфой, которая ослабляет
 * пятно до безопасной силы. CSS смешивает её с прозрачным на SPOT_PEAK,
 * поэтому итоговая сила пятна — `paintStrength(paint)`.
 */
export function spotColor(paint: string): string {
  const rgb = parseHex(paint);
  if (!rgb) return paint;
  const k = Math.min(1, paintStrength(paint) / SPOT_PEAK);
  return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]} / ${+k.toFixed(3)})`;
}
