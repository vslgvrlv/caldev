// Проверка повторов элементов ui-kit в продукте: ловит НОВЫЙ самописный тост, окно, подсказку при наведении, кнопку/сегменты/чип, вставной SVG-значок, растянутую SVG-графику,
// бублик на conic-gradient, полосу-рейтинг, ужатую карточку UI.stat (с 0.36.0; и в стилях строкой из JS — вид <вид>-js),
// родные alert/confirm/prompt (native-dialog, с 0.41.0). Читает и React: .tsx/.jsx, классы Tailwind в строках, import из lucide-react (с 0.38.0).
// Без зависимостей, запускается и node, и bun.
// Использование: node guard.js <корень продукта> [--write-baseline] [--json] [--warnings] [--speed] [--coverage]
//   без флага        — сравнение с <корень>/ui-kit-guard.json: новая находка или рост счётчика → exit 1
//   --write-baseline — записать текущие счётчики блокирующих находок в ui-kit-guard.json
//   --json           — машинный вывод (предупреждения — в поле warnings)
//   --warnings       — напечатать каждое предупреждение построчно
//   --speed          — только предупреждения скорости, без файла базы и без блокирующих правил; работает в любом репо, даже без ui-kit
//   --coverage       — покрытие: по 8 элементам и файлам, где стоит ui-kit, а где самописное; без базы, код возврата 0 (с --json — объект coverage)
// Предупреждения вкуса (level: 'warn') не блокируют и в базу не пишутся: caps, font-frac, font-small, glow, gradient, gradient-text, hex, blur, transition-all, hover-scale, pulse, emoji, rub, stat-tones, stat-bare, icon-lib.
// Предупреждения скорости (level: 'warn', с 0.29.0): img-heavy, img-lazy, script-blocking, font-cdn, select-star, no-timeout — 31 механика, спека «Скорость продуктов» 09.11.2026, docs/speed.md.
// Каждое правило — отдельный kind, чтобы поднимать их до блокировки по одному (у правила убрать level: 'warn').
// Правила вкуса адаптированы из unslop (Damir Sokolovsky, лицензия CC BY 4.0, https://github.com/heydamir/unslop).
// Исключение: комментарий `ui-kit-allow: <причина>` в строке находки или `ui-kit-allow-file: <причина>` в первых 5 строках файла.
// Комментарии (`//`, `/* */`, `{/* */}`, `<!-- -->`) не считаются ни использованием ui-kit, ни кодом продукта (с 0.41.0); сами маркеры ui-kit-allow читаются как раньше.
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASELINE_FILE = 'ui-kit-guard.json';
const EXTS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.svelte', '.html', '.css', '.jinja', '.j2', '.py']);
// .py проверяют только правила с py: true (запросы к базе и внешним API); остальные правила Python не смотрят.
const IMG_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp']);
export const IMG_HEAVY_BYTES = 200 * 1024;
export const SPEED_KINDS = new Set(['img-heavy', 'img-lazy', 'script-blocking', 'font-cdn', 'select-star', 'no-timeout']);
const SKIP_DIRS = new Set(['node_modules', 'vendor', 'dist', 'build', '.git', 'coverage', 'tests', 'test', '__tests__', '.demo-data', '.shots', '.claude']);
const STYLE_IN_MARKUP = new Set(['.html', '.svelte', '.jinja', '.j2']);

// ours — префикс (или список префиксов) классов самого ui-kit: они не находки.
const CSS_CLASS = (words, ours) => ({
  re: new RegExp(`(?<![\\w-])\\.((?:[\\w-]*)(?:${words})(?:[\\w-]*))(?=[\\s{,:.>+~\\[)]|$)`, 'gi'),
  skip: (m) => [].concat(ours).some((p) => m[1].toLowerCase().startsWith(p)),
});

// Самописная подсказка при наведении: класс с tooltip или tip отдельным словом (tooltip, my-tooltip, chart-tip, spark__tip), у которого в том же правиле position: absolute | fixed.
// Свои классы ui-kit (ui-*) не находка. Правило CSS ищется от селектора до ближайшей закрывающей скобки.
const TIP_NAME = /^(?:[\w-]*tooltip[\w-]*|(?:[\w-]*(?:-|__))?tip(?:(?:-|__)[\w-]*)?)$/i;
function tipRuleIsFloating(m, text) {
  const open = text.indexOf('{', m.index);
  if (open < 0) return false;
  if (/[};]/.test(text.slice(m.index, open))) return false;
  const close = text.indexOf('}', open);
  return /position\s*:\s*(?:absolute|fixed)/i.test(text.slice(open, close < 0 ? text.length : close));
}

// --- Помощники правил вкуса ---
const ZERO_SPACING = /^\s*(?:0(?:\.0+)?(?:px|em|rem)?|normal)\s*(?:!important)?\s*$/i;
const PULSE_OK = /spin|rotat|load|skeleton|shimmer|progress|live|typing|caret/i;
// Тело блока объявлений вокруг позиции: от ближайшей `{` до `}`.
function declBlock(text, idx) {
  const o = text.lastIndexOf('{', idx), c = text.indexOf('}', idx);
  return text.slice(o + 1, c < 0 ? text.length : c);
}
function balanced(text, open) { // индекс закрывающей скобки для `(` в позиции open
  let d = 0;
  for (let i = open; i < text.length; i++) { if (text[i] === '(') d++; else if (text[i] === ')' && --d === 0) return i; }
  return text.length;
}
function topSplit(v) {
  const out = []; let d = 0, from = 0;
  for (let i = 0; i < v.length; i++) { if (v[i] === '(') d++; else if (v[i] === ')') d--; else if (v[i] === ',' && d === 0) { out.push(v.slice(from, i)); from = i + 1; } }
  out.push(v.slice(from));
  return out;
}
const NAMED = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgreen darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkturquoise darkviolet deeppink deepskyblue dodgerblue firebrick floralwhite forestgreen fuchsia gold goldenrod green greenyellow honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgreen lightpink lightsalmon lightseagreen lightskyblue lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna skyblue slateblue springgreen steelblue tan teal thistle tomato turquoise violet wheat yellow yellowgreen').split(' '));
const CHROMA_VAR = /accent|primary|brand|blue|green|violet|purple|pink|cyan|teal|glow|(?<![a-z])ok(?![a-z])|warn|danger/i;
const COLOR_RE = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])|(?:rgba?|hsla?)\((?:[^()]|\([^()]*\))*\)|var\(\s*--[\w-]+[^)]*\)|(?<![\w-])[a-z]+(?![\w(-])/gi;
function rgbInfo(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d <= 24) return null;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { hue: (h * 60 + 360) % 360, key: null };
}
// Ступени одного тона (--primary и --primary-2, --accent-dim) — один ключ: переход между ними не градиент по тону.
const TONE_STEP = /(?:-(?:\d+|dim|soft|strong|light|lighter|dark|darker|deep|hover|active|muted|weak|alt))+$/;
const varInfo = (name) => (CHROMA_VAR.test(name) ? { hue: null, key: name.toLowerCase().replace(TONE_STEP, '') } : null);
// Хроматический ли цвет-токен: { hue } для hex/rgb/hsl, { key } для var()/имени; null — нейтральный или не цвет.
function colorInfo(tok) {
  const t = tok.toLowerCase();
  if (t[0] === '#') {
    let h = t.slice(1);
    if (h.length < 6) h = [...h].slice(0, 3).map((c) => c + c).join('');
    return rgbInfo(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16));
  }
  if (/^(?:rgb|hsl)a?\(/.test(t)) {
    const v = t.match(/var\(\s*(--[\w-]+)/);
    if (v) return varInfo(v[1]);
    const n = t.slice(t.indexOf('(') + 1).match(/-?\d*\.?\d+%?/g) || [];
    if (n.length < 3) return null;
    if (t[0] === 'r') { const c = n.slice(0, 3).map((x) => (x.endsWith('%') ? parseFloat(x) * 2.55 : parseFloat(x))); return rgbInfo(...c); }
    return parseFloat(n[1]) > 15 ? { hue: ((parseFloat(n[0]) % 360) + 360) % 360, key: null } : null;
  }
  if (t.startsWith('var(')) return varInfo(t.match(/var\(\s*(--[\w-]+)/)[1]);
  return NAMED.has(t) ? { hue: null, key: t } : null;
}
function chromatics(value) {
  const out = [];
  for (const m of value.matchAll(COLOR_RE)) { const c = colorInfo(m[0]); if (c) out.push(c); }
  return out;
}
const differentTone = (a, b) => (a.hue != null && b.hue != null ? Math.min(Math.abs(a.hue - b.hue), 360 - Math.abs(a.hue - b.hue)) > 30 : a.key !== b.key || a.hue !== b.hue);

function matchGlow(text) {
  const out = [], re = /(?<![\w-])(box-shadow|text-shadow|filter)\s*:\s*([^;{}]+)/gi;
  let m;
  while ((m = re.exec(text))) {
    let layers;
    if (m[1].toLowerCase() === 'filter') {
      layers = []; const ds = /drop-shadow\(/gi; let d;
      while ((d = ds.exec(m[2]))) layers.push(m[2].slice(d.index, balanced(m[2], d.index + d[0].length - 1) + 1));
    } else layers = topSplit(m[2]);
    // слой-свечение: хроматический цвет и длина от 8px
    const glow = layers.some((l) => chromatics(l).length && [...l.matchAll(/(-?\d*\.?\d+)px/gi)].some((x) => Math.abs(parseFloat(x[1])) >= 8));
    if (glow) out.push({ index: m.index, snippet: m[0] });
  }
  return out;
}
function matchGradient(text) {
  const out = [], re = /(?:linear|radial|conic)-gradient\(/gi;
  let m;
  while ((m = re.exec(text))) {
    const inner = text.slice(m.index + m[0].length, balanced(text, m.index + m[0].length - 1));
    const cs = chromatics(inner);
    if (cs.some((a, i) => cs.slice(0, i).some((b) => differentTone(a, b)))) out.push({ index: m.index, snippet: m[0] + inner });
  }
  return out;
}
function matchHoverScale(text) {
  const out = [], re = /transform\s*:[^;}]*scale\(\s*(?!1\s*\))/gi;
  let m;
  while ((m = re.exec(text))) {
    const open = text.lastIndexOf('{', m.index);
    const sel = text.slice(Math.max(text.lastIndexOf('}', open), text.lastIndexOf('{', open - 1), text.lastIndexOf(';', open)) + 1, open);
    if (/:hover/i.test(sel)) out.push({ index: m.index, snippet: `${sel.trim()} { ${m[0]}` });
  }
  return out;
}
// Цветные тона карточек показателей: больше одного тона (кроме сигнальных warn/danger) в файле с UI.stat → одна находка на втором тоне.
function matchStatTones(text, ext, ctx) {
  text = ctx?.noComments ?? text;
  if (!/UI\.stat|stat\.mount|ui-stat/.test(text)) return [];
  const hits = [];
  for (const re of [/tone\s*:\s*(['"])(accent|blue|violet|green)\1/g, /ui-stat--(accent|blue|violet|green)(?![\w-])/g]) {
    let m;
    while ((m = re.exec(text))) hits.push({ index: m.index, tone: m[m.length - 1], snippet: m[0] });
  }
  hits.sort((a, b) => a.index - b.index);
  const second = hits.find((h) => h.tone !== hits[0].tone);
  return second ? [{ index: second.index, snippet: `${hits[0].snippet} + ${second.snippet}` }] : [];
}

// --- Повторы элементов панелей (0.36.0): то, что guard не видел на P&L дашбордов ZP 10.11.2026 ---
// Конец выражения `${…}` с вложенными скобками и строками: индекс закрывающей `}` для `${` в позиции open (open указывает на `$`).
function exprEnd(text, open) {
  let d = 0;
  for (let i = open + 1; i < text.length; i++) {
    const c = text[i];
    if (c === '{') d++;
    else if (c === '}' && --d === 0) return i;
    else if (c === "'" || c === '"') { const j = text.indexOf(c, i + 1); if (j < 0) return text.length; i = j; }
  }
  return text.length;
}
// Конец открывающего тега: первая `>` вне `${…}`.
function tagEnd(text, from) {
  for (let i = from; i < text.length; i++) {
    if (text[i] === '$' && text[i + 1] === '{') i = exprEnd(text, i);
    else if (text[i] === '>') return i;
  }
  return text.length;
}
// Заливка полосы в строке шаблона: style="…width:${…}%…".
const FILL_WIDTH = /\bstyle\s*=\s*["'][^"'<>]*?\bwidth\s*:\s*\$\{/i;
function fillWidthAt(tag, text, tagStart) {
  const m = tag.match(FILL_WIDTH);
  if (!m) return false;
  const open = tagStart + m.index + m[0].length - 2;
  return text[exprEnd(text, open) + 1] === '%';
}
// Закрывающий тег элемента name, открытого перед позицией from (вложенные теги того же имени учитываются).
function closeTag(text, name, from) {
  const re = new RegExp(`<(/?)${name}\\b`, 'gi');
  re.lastIndex = from;
  let d = 1, m;
  while ((m = re.exec(text))) { if (m[1]) { if (--d === 0) return m.index; } else d++; }
  return -1;
}
// Самописная полоса: дорожка, внутри которой первой стоит заливка `width:${…}%` (UI.barlist рисует то же: подпись, дорожка, полоса, число).
// pair — сразу за первой заливкой вторая такая же, обе пустые (факт и план, факт и pipeline): у UI.barlist это второй слой `ghost` (с 0.38.0).
// Две заливки с текстом внутри — составная полоса (части целого), не находка ни одного вида.
// Одна находка на дорожку. Строки через `+` не смотрятся.
const TRACK_FILL = /<(div|span)\b[^<>]*>\s*<(div|span)\b/gi;
function barTracks(text) {
  const out = [];
  TRACK_FILL.lastIndex = 0;
  let m;
  while ((m = TRACK_FILL.exec(text))) {
    const fillStart = m.index + m[0].lastIndexOf('<');
    const fillTagEnd = tagEnd(text, fillStart);
    const fillTag = text.slice(fillStart, fillTagEnd + 1);
    if (!fillWidthAt(fillTag, text, fillStart)) { TRACK_FILL.lastIndex = fillStart; continue; }
    let pair = false;
    const close = closeTag(text, m[2], fillTagEnd + 1);
    if (close >= 0) {
      const sibStart = close + text.slice(close).match(/^<\/\w+\s*>\s*/)[0].length;
      const sib = text.slice(sibStart).match(/^<(div|span)\b/i);
      const sibTagEnd = sib ? tagEnd(text, sibStart) : -1;
      if (sib && fillWidthAt(text.slice(sibStart, sibTagEnd + 1), text, sibStart)) {
        // Составная полоса (части целого рядом, подписи внутри заливок) — другой элемент, не находка; факт и план — две пустые заливки друг на друге.
        const sibClose = closeTag(text, sib[1], sibTagEnd + 1);
        const empty = /^\s*$/.test(text.slice(fillTagEnd + 1, close)) && sibClose >= 0 && /^\s*$/.test(text.slice(sibTagEnd + 1, sibClose));
        if (!empty) { TRACK_FILL.lastIndex = fillTagEnd; continue; }
        pair = true;
      }
    }
    out.push({ index: fillStart, snippet: text.slice(m.index, Math.min(fillTagEnd + 1, m.index + 160)), pair });
    TRACK_FILL.lastIndex = fillTagEnd;
  }
  return out;
}
// Одна заливка — рейтинг (вид bar, с 0.36.0); две — факт и план (вид bar-ghost, с 0.38.0: отдельный вид, чтобы раскатка записала старые места долгом).
const matchBars = (text) => barTracks(text).filter((t) => !t.pair);
const matchBarPairs = (text) => barTracks(text).filter((t) => t.pair);

// Размер карточки UI.stat своим CSS: часть карточки (.ui-stat__value, __label, __spark…) с font-size, line-height, высотой, шириной или отступами;
// сама .ui-stat — с font-size, min/max-height, высотой или шириной не 100%/auto и ненулевыми отступами. Растянуть карточку на ячейку (height: 100%) и снять рамку (padding: 0) можно.
const STAT_PART_PROPS = /^(?:font-size|font|line-height|(?:min-|max-)?(?:height|width)|padding(?:-[a-z-]+)?)$/;
const STAT_ROOT_PROPS = /^(?:font-size|font|(?:min-|max-)?(?:height|width)|padding(?:-[a-z-]+)?)$/;
const NEUTRAL_SIZE = /^(?:100%|auto|inherit|initial|unset|none|0(?:px|rem|em)?(?:\s+0(?:px|rem|em)?)*)\s*(?:!important)?$/i;
function matchStatSize(text) {
  const out = [], re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text))) {
    const parts = m[1].split(',').map((s) => s.trim().split(/\s*[>+~]\s*|\s+/).pop() || '');
    const hits = parts.map((c) => c.match(/\.ui-stat(?:__([\w-]+))?(?![\w-])/)).filter(Boolean);
    if (!hits.length) continue;
    const isPart = hits.some((h) => h[1]);
    const bodyAt = m.index + m[1].length + 1;
    for (const d of m[2].matchAll(/(?:^|;)\s*([a-z-]+)\s*:\s*([^;]*)/gi)) {
      const prop = d[1].toLowerCase(), value = d[2].trim();
      if (!(isPart ? STAT_PART_PROPS : STAT_ROOT_PROPS).test(prop) || NEUTRAL_SIZE.test(value)) continue;
      const sel = m[1].trim().split('\n').pop().trim();
      out.push({ index: bodyAt + d.index + d[0].indexOf(d[1]), snippet: `${sel.slice(-60)} { ${prop}: ${value} }` });
      break;
    }
  }
  return out;
}

// Аргументы вызова верхнего уровня: запятые вне скобок, строк и шаблонов.
function splitArgs(s) {
  const out = []; let d = 0, from = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" || c === '"' || c === '`') { const j = s.indexOf(c, i + 1); i = j < 0 ? s.length : j; }
    else if ('([{'.includes(c)) d++;
    else if (')]}'.includes(c)) d--;
    else if (c === ',' && d === 0) { out.push(s.slice(from, i)); from = i + 1; }
  }
  out.push(s.slice(from));
  return out.map((x) => x.trim());
}
// UI.stat.mount без info и без icon: у карточки нет «?» с формулой и значка (дизайн-система ZP требует «?»). Опции не литералом или со spread — не судим.
function matchStatBare(text, ext, ctx) {
  text = ctx?.noComments ?? text;
  const out = [], re = /\bUI\.stat\.mount\s*\(/g;
  let m;
  while ((m = re.exec(text))) {
    const open = m.index + m[0].length - 1;
    const args = splitArgs(text.slice(open + 1, balanced(text, open)));
    const opts = args[1];
    if (!opts || opts[0] !== '{') continue;
    const keys = splitArgs(opts.slice(1, opts.lastIndexOf('}')));
    if (keys.some((k) => k.startsWith('...'))) continue;
    if (keys.some((k) => /^['"]?(?:info|icon)['"]?\s*(?:[:(]|$)/.test(k))) continue;
    out.push({ index: m.index, snippet: 'UI.stat.mount без info и icon' });
  }
  return out;
}

// Вызов внешнего API без таймаута: Python requests/httpx/urlopen без timeout=, JS fetch по абсолютному http(s)-адресу без signal.
// Висящий внешний сервис без таймаута держит ответ пользователю до обрыва соединения (механика 12).
const CALL_PY = /\b(?:(?:requests|httpx)\.(?:get|post|put|patch|delete|head|request)|urlopen)\s*\(/g;
const CALL_JS = /\bfetch\s*\(\s*[`'"]https?:\/\//g;
function matchNoTimeout(text, ext) {
  const out = [];
  const py = ext === '.py';
  const re = py ? CALL_PY : CALL_JS;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) {
    const open = text.indexOf('(', m.index);
    const close = balanced(text, open);
    const call = text.slice(open, close < 0 ? text.length : close + 1);
    if (py ? /\btimeout\s*=/.test(call) : /\bsignal\s*:|\bsignal\b\s*[,}]/.test(call)) continue;
    out.push({ index: m.index, snippet: m[0] });
  }
  return out;
}

// --- Разбор исходника (0.41.0): комментарии и строки ---
// Комментарий не использование: `UI.toast` в комментарии, `alert(` в строке не должны ни засчитывать ui-kit, ни давать находку.
// lexSource возвращает: noComments — текст без комментариев; code — ещё и без содержимого строк (кроме разметки вне <script>, где в атрибутах живут обработчики);
// strings — все строки и шаблоны (в шаблоне — статические куски через пробел). Длина и переводы строк сохраняются, индексы и номера строк те же.
function tagRanges(text, tag) {
  const ranges = [], re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  let m;
  while ((m = re.exec(text))) ranges.push([m.index + m[0].indexOf('>') + 1, m.index + m[0].length - tag.length - 3]);
  return ranges;
}
export function lexSource(text, ext) {
  if (ext === '.py') return { noComments: text, code: text, strings: [] };
  const n = text.length, noComments = text.split(''), code = text.split(''), strings = [];
  const markup = STYLE_IN_MARKUP.has(ext), css = ext === '.css';
  const scripts = markup ? tagRanges(text, 'script') : [];
  const inScript = (i) => scripts.some(([a, b]) => i >= a && i < b);
  const jsHere = (i) => !css && (!markup || inScript(i));
  const blank = (arr, a, b) => { for (let i = a; i < b; i++) if (arr[i] !== '\n') arr[i] = ' '; };
  const drop = (a, b) => { blank(noComments, a, b); blank(code, a, b); return b; };
  function template(i) {
    let j = i + 1, from = j;
    const segs = [];
    while (j < n && text[j] !== '`') {
      if (text[j] === '\\') { j += 2; continue; }
      if (text[j] === '$' && text[j + 1] === '{') {
        segs.push(text.slice(from, j)); blank(code, from, j);
        j = walk(j + 2, true); from = ++j;
        continue;
      }
      j++;
    }
    j = Math.min(j, n);
    segs.push(text.slice(from, j)); blank(code, from, j);
    strings.push({ index: i + 1, value: segs.join(' '), template: segs.length > 1 });
    return j + 1;
  }
  function walk(i, nested) {
    let depth = 0;
    while (i < n) {
      const c = text[i], d = text[i + 1];
      if (c === '/' && d === '*') { const j = text.indexOf('*/', i + 2); i = drop(i, j < 0 ? n : j + 2); continue; }
      if (c === '/' && d === '/' && jsHere(i) && text[i - 1] !== ':') { const j = text.indexOf('\n', i); i = drop(i, j < 0 ? n : j); continue; }
      if (markup && c === '<' && text.startsWith('<!--', i)) { const j = text.indexOf('-->', i + 4); i = drop(i, j < 0 ? n : j + 3); continue; }
      if ((c === '"' || c === "'") && !css) {
        let j = i + 1;
        while (j < n && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
        if (j < n && text[j] === c) {
          strings.push({ index: i + 1, value: text.slice(i + 1, j), template: false });
          if (!markup || inScript(i)) blank(code, i + 1, j);
          i = j + 1; continue;
        }
      } else if (c === '`' && jsHere(i)) { i = template(i); continue; }
      else if (nested) { if (c === '{') depth++; else if (c === '}') { if (depth === 0) return i; depth--; } }
      i++;
    }
    return i;
  }
  walk(0, false);
  if (css) for (const m of text.matchAll(/@apply\s+([^;}]+)/g)) strings.push({ index: m.index + m[0].indexOf(m[1]), value: m[1].replace(/\s*!important\s*$/, ''), template: false });
  return { noComments: noComments.join(''), code: code.join(''), strings };
}

// --- Классы Tailwind (0.41.0): те же предупреждения вкуса, что для CSS, но по спискам классов в строках и @apply ---
const TW_CHROMA = new Set('red orange amber yellow lime green emerald teal cyan sky blue indigo violet purple fuchsia pink rose primary secondary accent brand destructive success warning danger info highlight'.split(' '));
const TW_NEUTRAL = new Set('black white transparent current inherit slate gray grey zinc neutral stone background foreground surface muted border card popover input text subtext'.split(' '));
const TW_SHADOW_SIZE = /^(?:sm|md|lg|xl|2xl|inner|none)$/;
// Токен без вариантов (md:hover:), без `!` и ведущего `-`.
function twBase(tok) {
  let t = tok;
  for (;;) { const m = t.match(/^(?:[\w/-]+|\[[^\]\s]*\]|\([^)\s]*\)):/); if (!m) break; t = t.slice(m[0].length); }
  return t.replace(/^[!-]+/, '').replace(/!$/, '');
}
const twPx = (num, unit) => parseFloat(num) * (unit === 'px' ? 1 : 16);
// Цвет из имени токена (`blue-500/30`, `pb-primary`, `[#3b82f6]`): { hue } | { key } | null для нейтрального.
function twColor(name) {
  const arb = name.match(/^\[(.+)\](?:\/.*)?$/);
  if (arb) return colorInfo(arb[1].replace(/_/g, ' ').replace(/^(?:color|length):/, ''));
  const fam = name.replace(/\/.*$/, '').replace(/-(?:\d{2,3}|950)$/, '').toLowerCase();
  if (!fam || /^\d+%?$/.test(fam)) return null;
  return fam.split('-').every((s) => TW_NEUTRAL.has(s)) ? null : { hue: null, key: fam };
}
const twIsChromaName = (name) => name.replace(/\/.*$/, '').replace(/-(?:\d{2,3}|950)$/, '').toLowerCase().split('-').some((s) => TW_CHROMA.has(s));

function twList(value, lineText) {
  const toks = value.split(/\s+/).filter(Boolean).map((raw) => ({ raw, base: twBase(raw) }));
  const out = [];
  const add = (kind, snippet) => out.push({ kind, snippet });
  const upper = toks.find((t) => t.base === 'uppercase');
  const track = toks.find((t) => /^tracking-(?:wide|wider|widest)$/.test(t.base) || /^tracking-\[(?!-|0(?:\.0*)?[a-z]*\])[^\]]+\]$/.test(t.base));
  if (upper && track) add('caps', `${upper.raw} ${track.raw}`);
  for (const t of toks) {
    let m;
    if ((m = t.base.match(/^text-\[(\d*\.?\d+)(px|rem|em)\]$/))) {
      add('font-frac', t.raw);
      if (twPx(m[1], m[2]) < 12) add('font-small', t.raw);
    } else if ((m = t.base.match(/^(?:drop-)?shadow-\[(.+)\]$/))) {
      const layers = topSplit(m[1].replace(/_/g, ' '));
      if (layers.some((l) => chromatics(l).length && [...l.matchAll(/(-?\d*\.?\d+)px/gi)].some((x) => Math.abs(parseFloat(x[1])) >= 8))) add('glow', t.raw);
    } else if ((m = t.base.match(/^(?:drop-)?shadow-(.+)$/))) {
      if (!TW_SHADOW_SIZE.test(m[1]) && twIsChromaName(m[1])) add('glow', t.raw);
    } else if (/^backdrop-blur(?:-|$)/.test(t.base)) { if (!toks.some((x) => /^ui-(?:glass|glass2|lglass)$/.test(x.base))) add('blur', t.raw); }
    else if (t.base === 'transition-all') add('transition-all', t.raw);
    else if (t.base === 'animate-pulse' || t.base === 'animate-ping') { if (!PULSE_OK.test(value) && !PULSE_OK.test(lineText)) add('pulse', t.raw); }
    else if (t.base === 'bg-clip-text') add('gradient-text', t.raw);
    else if (/^(?:bg|text|border(?:-[trblxyse])?|ring|ring-offset|fill|stroke|from|via|to|outline|divide|decoration|caret|accent|placeholder|shadow)-\[#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\](?:\/\d+)?$/i.test(t.base)) add('hex', t.raw);
  }
  // градиент: направление + две краски разного тона (серый, чёрный, белый и transparent — не краски: затемнение под текстом не градиент вкуса)
  const dir = toks.find((t) => /^bg-(?:gradient-to-|linear-|radial|conic)/.test(t.base));
  if (dir) {
    const cs = toks.map((t) => t.base.match(/^(?:from|via|to)-(.+)$/)).filter(Boolean).map((m) => twColor(m[1])).filter(Boolean);
    if (cs.some((a, i) => cs.slice(0, i).some((b) => differentTone(a, b)))) add('gradient', toks.filter((t) => /^(?:from|via|to)-/.test(t.base)).map((t) => t.raw).join(' ').trim());
  }
  return out;
}
// Все находки Tailwind файла: [{ kind, index, snippet }] (index — начало строки с классами; в шаблоне с ${…} строка целиком).
export function tailwindFindings(text, lex) {
  const out = [];
  for (const s of lex.strings) {
    if (s.value.length < 4 || !/[a-z]/.test(s.value)) continue;
    const ls = text.lastIndexOf('\n', s.index) + 1, le = text.indexOf('\n', s.index);
    const lineText = text.slice(ls, le < 0 ? text.length : le);
    for (const f of twList(s.value, lineText)) {
      const at = s.template ? -1 : s.value.indexOf(f.snippet.split(' ')[0]);
      out.push({ kind: f.kind, index: s.index + Math.max(at, 0), snippet: f.snippet });
    }
  }
  return out;
}
const twRule = (kind) => (text, ext, ctx) => ctx.tailwind().filter((f) => f.kind === kind);

// Родные alert / confirm / prompt (в том числе window.alert) — самописная замена окна ui-kit. Определения функций, методы, строки и комментарии — не вызов.
function matchNativeDialog(text, ext, ctx) {
  const out = [], re = /(?<![\w$.])(?:(?:window|globalThis|self)\s*\.\s*)?(alert|confirm|prompt)\s*\(/g, code = ctx.code;
  let m;
  while ((m = re.exec(code))) {
    if (/\b(?:function\*?|get|set|new)\s+$/.test(code.slice(Math.max(0, m.index - 20), m.index))) continue;
    const rest = code.slice(balanced(code, m.index + m[0].length - 1) + 1, m.index + m[0].length + 300);
    if (/^\s*(?::\s*[^{};=()]+)?\{/.test(rest) && /(?:^|[;{},]|\b(?:async|static|public|private|protected))\s*$/.test(code.slice(0, m.index))) continue; // метод класса или объекта: alert(msg) { … }
    out.push({ index: m.index, snippet: m[0] });
  }
  return out;
}
// Иконки Lucide мимо ui-kit: import из lucide-react (lucide-vue-next, lucide-svelte, @lucide/…) — одно предупреждение на файл.
function matchIconLib(text, ext, ctx) {
  const m = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])(lucide(?:-[a-z-]+)?|@lucide\/[\w-]+)(?:\/[^'"]*)?\1/.exec(ctx.noComments);
  return m ? [{ index: m.index, snippet: m[0].replace(/\s+/g, ' ').trim() }] : [];
}

// Таблица правил: kind — вид; scope — 'code' (вне CSS), 'css' (файл .css и блоки <style>) или 'any'; level — 'warn' для предупреждений (по умолчанию блокирующее);
// re — регулярка, либо match(text, ext) => [{ index, snippet }] для проверки по файлу; skip — исключение по совпадению.
export const RULES = [
  { kind: 'toast', scope: 'code', re: /function\s+\w*toast\w*\s*\(/gi },
  { kind: 'toast', scope: 'code', re: /(?:const|let|var)\s+\w*toast\w*\s*=\s*(?:\(|function|async)/gi },
  { kind: 'toast', scope: 'code', re: /class\s+\w*Toast/g },
  { kind: 'toast', scope: 'css', ...CSS_CLASS('toast', 'ui-toast') },

  { kind: 'dialog', scope: 'code', re: /\.showModal\(/g },
  { kind: 'dialog', scope: 'code', re: /<dialog[\s>]/gi },
  { kind: 'dialog', scope: 'code', re: /createElement\(['"]dialog['"]\)/g },
  { kind: 'dialog', scope: 'code', re: /function\s+\w*(?:modal|dialog|(?<!un)confirm(?!ed)|sheet)\w*\s*\(/gi },
  { kind: 'dialog', scope: 'css', ...CSS_CLASS('modal|overlay|dialog|sheet|backdrop', ['ui-dialog', 'ui-backdrop']) },
  // React (0.41.0): свой компонент окна стрелкой — const ConfirmModal = ({ … }) => …; только .tsx/.jsx, имя с заглавной (обработчик confirmDelete — не окно).
  { kind: 'dialog', scope: 'code', exts: ['.tsx', '.jsx'], re: /(?:const|let|var)\s+(?=\w*(?:Modal|Dialog|Sheet))[A-Z]\w*\s*(?::[^=\n]+)?=\s*(?:\(|async\b|function\b|React\.|memo\(|forwardRef\()/g },
  // Родные alert / confirm / prompt (0.41.0) — самописная замена окна ui-kit.
  { kind: 'native-dialog', scope: 'code', match: matchNativeDialog },

  { kind: 'icon', scope: 'code', re: /<path\s[^>]*\bd=/g },

  // Контролы (0.13.0): свой CSS-класс кнопки, сегментов или чипа — повтор .ui-btn / .ui-seg / .ui-chip; rnp-* в ZP — прокладка на ядро, не находка.
  { kind: 'control', scope: 'css', re: /(?<![\w-])\.((?:[\w-]+-)?(?:btn|button|buttons|segmented|segment|chip|chips)(?:-[\w-]+)?)(?=[\s{,:.>+~\[)]|$)/gi,
    skip: (m) => ['ui-btn', 'ui-seg', 'ui-chip', 'rnp-button', 'rnp-segmented'].some((p) => m[1].toLowerCase().startsWith(p)) },

  // Подсказка при наведении (0.21.0): своя карточка-подсказка в CSS продукта — повтор UI.tip.
  { kind: 'tip', scope: 'css', re: /(?<![\w-])\.([A-Za-z_][\w-]*)(?=[\s{,:.>+~\[)]|$)/g,
    skip: (m, text) => m[1].toLowerCase().startsWith('ui-') || !TIP_NAME.test(m[1]) || !tipRuleIsFloating(m, text) },

  // Растянутая векторная графика: viewBox под preserveAspectRatio="none" плющит углы и круги (спарклайны «Пульса» ZP, 29.10.2026).
  { kind: 'stretch', scope: 'code', re: /preserveAspectRatio["']?\s*[=:,]\s*\{?\s*["']none["']/gi },

  // Повторы элементов панелей (0.36.0) — их не видел guard на P&L дашбордов ZP 10.11.2026.
  // Бублик или кольцо на CSS conic-gradient — повтор UI.chart.donut / UI.ring (repeating-conic-gradient — узор, не находка).
  { kind: 'donut', scope: 'any', re: /(?<![\w-])conic-gradient\(/gi },
  // Своя полоса-рейтинг: дорожка с одной заливкой width:${…}% в строке шаблона — повтор UI.barlist.
  { kind: 'bar', scope: 'code', match: matchBars },
  { kind: 'bar-ghost', scope: 'code', match: matchBarPairs },
  // Размер карточки UI.stat своим CSS (.ui-stat__value { font-size }, .ui-stat__spark { height }…) — карточка выглядит не как в остальных экранах.
  { kind: 'stat-size', scope: 'css', match: matchStatSize },

  // --- Предупреждения вкуса (level: 'warn'): не блокируют, в базу не попадают. Адаптировано из unslop (Damir Sokolovsky, CC BY 4.0). ---
  { kind: 'caps', scope: 'css', level: 'warn', re: /text-transform\s*:\s*uppercase/gi,
    skip: (m, text) => { const ls = declBlock(text, m.index).match(/letter-spacing\s*:\s*([^;}]+)/i); return !ls || ZERO_SPACING.test(ls[1]); } },
  { kind: 'font-frac', scope: 'any', level: 'warn', re: /(?<![\w-])font-size\s*:\s*\d*\.\d*[1-9]\d*px/gi },
  { kind: 'font-frac', scope: 'any', level: 'warn', re: /fontSize\s*:\s*(['"]?)\d*\.\d*[1-9]\d*(?:px)?\1(?![\w%.])/g },
  { kind: 'glow', scope: 'css', level: 'warn', match: matchGlow },
  { kind: 'gradient', scope: 'css', level: 'warn', match: matchGradient },
  { kind: 'gradient-text', scope: 'any', level: 'warn', re: /(?:-webkit-)?background-clip\s*:\s*text|(?:webkit)?backgroundClip\s*:\s*['"]text['"]|(?:-webkit-text-fill-color|WebkitTextFillColor)\s*:\s*['"]?transparent/gi },
  { kind: 'hex', scope: 'css', level: 'warn', re: /(?<![\w&#-])(?<!url\(['"]?)#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi,
    skip: (m, text) => {
      const i = m.index, b = Math.max(text.lastIndexOf(';', i), text.lastIndexOf('{', i), text.lastIndexOf('}', i));
      const before = text.slice(b + 1, i);
      if (!before.includes(':') || /^\s*--/.test(before)) return true;
      const rest = text.slice(i + m[0].length), e = rest.search(/[;{}]/);
      return e >= 0 && rest[e] === '{';
    } },
  { kind: 'transition-all', scope: 'any', level: 'warn', re: /(?<![\w])transition(?:-property)?\s*:\s*['"]?all\b/gi },
  { kind: 'hover-scale', scope: 'css', level: 'warn', match: matchHoverScale },
  { kind: 'hover-scale', scope: 'code', level: 'warn', re: /hover:scale-/g, skip: (m, text) => /^hover:scale-100(?![\d.])/.test(text.slice(m.index)) },
  { kind: 'pulse', scope: 'css', level: 'warn', re: /(?<![\w])animation(?:-iteration-count)?\s*:\s*[^;}]*\binfinite\b/gi,
    skip: (m, text) => PULSE_OK.test(/iteration/i.test(m[0]) ? declBlock(text, m.index) : m[0]) },
  { kind: 'emoji', scope: 'code', level: 'warn', re: /(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}️)/gu,
    skip: (m, text) => /^(?:\/\/|\*|\/\*|<!--|#)/.test(text.slice(text.lastIndexOf('\n', m.index - 1) + 1, m.index + 1).trim()) },
  { kind: 'rub', scope: 'any', level: 'warn', re: /[^\s]{0,8}[\d)}](?<!\\u00a0|\\xa0|\\u202f)₽/g },
  { kind: 'stat-tones', scope: 'code', level: 'warn', match: matchStatTones },
  { kind: 'stat-bare', scope: 'code', level: 'warn', match: matchStatBare },
  // Классы Tailwind (0.41.0): те же виды, что для CSS, по спискам классов в строках .tsx/.jsx/.html/.svelte/.js и по @apply. hover:scale-* уже ловит правило выше.
  { kind: 'caps', scope: 'any', level: 'warn', match: twRule('caps') },
  { kind: 'font-frac', scope: 'any', level: 'warn', match: twRule('font-frac') },
  { kind: 'font-small', scope: 'any', level: 'warn', match: twRule('font-small') },
  { kind: 'glow', scope: 'any', level: 'warn', match: twRule('glow') },
  { kind: 'gradient', scope: 'any', level: 'warn', match: twRule('gradient') },
  { kind: 'gradient-text', scope: 'any', level: 'warn', match: twRule('gradient-text') },
  { kind: 'hex', scope: 'any', level: 'warn', match: twRule('hex') },
  { kind: 'blur', scope: 'any', level: 'warn', match: twRule('blur') },
  { kind: 'transition-all', scope: 'any', level: 'warn', match: twRule('transition-all') },
  { kind: 'pulse', scope: 'any', level: 'warn', match: twRule('pulse') },
  // Иконки Lucide мимо ui-kit (0.41.0): lucide-react и родственные пакеты.
  { kind: 'icon-lib', scope: 'code', level: 'warn', match: matchIconLib },

  // --- Предупреждения скорости (level: 'warn'): механики из спеки «Скорость продуктов», docs/speed.md. img-heavy считается по размеру файлов в scan(). ---
  { kind: 'img-lazy', scope: 'code', level: 'warn', re: /<img\b(?![^>]*\bloading\s*=)[^>]*>/gi },
  { kind: 'script-blocking', scope: 'code', level: 'warn', re: /<script\b(?=[^>]*\bsrc\s*=\s*["']?(?:https?:)?\/\/)(?![^>]*\b(?:defer|async)\b)(?![^>]*\btype\s*=\s*["']?module)[^>]*>/gi },
  { kind: 'font-cdn', scope: 'any', level: 'warn', re: /\bfonts\.(?:googleapis|gstatic)\.com\b/g },
  { kind: 'select-star', scope: 'code', level: 'warn', py: true, re: /\bSELECT\s+(?:DISTINCT\s+)?\*\s+FROM\b/gi },
  { kind: 'no-timeout', scope: 'code', level: 'warn', py: true, match: matchNoTimeout },
];

const HINTS = {
  toast: 'взять UI.toast.show({ text, kind, action, timeout }) из ui-kit; свои .toast-стили и функции не заводить',
  dialog: 'взять UI.dialog.open({ title, content, actions, onClose }) из ui-kit; свои модальные окна и подложки не заводить',
  tip: 'взять UI.tip.create(host) (карточка { title, rows }, плавный ход, границы блока), подсказку графика UI.chart.tooltip или спарклайна UI.stat.spark({ tip }); свои .tooltip и абсолютно позиционированные подсказки не заводить',
  control: 'взять классы ui-kit: .ui-btn (--primary, --danger, --ghost, --sm), .ui-seg или UI.seg.mount, .ui-chip; свои кнопки, сегменты и чипы не стилить',
  icon: 'взять UI.icon(name) и подходящее имя из icons.list ui-kit; если значка нет — добавить имя в icons.list ui-kit, а не вставлять SVG',
  caps: 'подписи обычным регистром; капс с разрядкой — только короткая метка в 1–2 слова, не длинные строки',
  'font-frac': 'целые px из шкалы токенов (12, 13, 14…), без дробных размеров вроде 13.5px; в Tailwind — text-xs/sm/base из шкалы, не text-[11px]',
  'font-small': 'текст мельче 12px читается плохо, особенно на телефоне: от text-xs (12px) и крупнее',
  blur: 'стекло в продуктах разрешено, но только из ui-kit: .ui-glass / UI.glass (второй слой — .ui-glass2, жидкое — .ui-lglass), а не свой backdrop-blur',
  'icon-lib': 'значки — UI.icon(name) из Lucide через ui-kit; пакет lucide-react (и родственные) тянет Lucide мимо ui-kit; нужного имени нет в icons.list — добавить его туда',
  'native-dialog': 'вместо alert/confirm/prompt — UI.dialog.open({ title, content, actions }) для вопроса и UI.toast.show({ text }) для сообщения; системные окна не вызывать',
  glow: 'цветных свечений не делать: глубина — нейтральной тенью или слоем стекла ui-kit',
  gradient: 'градиенты между разными тонами не делать; фон — токен темы',
  'gradient-text': 'текст одним цветом из токенов, без background-clip: text',
  hex: 'цвет брать из токенов var(--ui-*) или темы продукта, не писать hex в значениях; в Tailwind — цвет темы, не bg-[#…]',
  'transition-all': 'перечислить свойства (opacity, transform, background-color) и токен длительности, не transition: all',
  'hover-scale': 'наведение — цвет фона или подъём из ui-kit, без увеличения (scale)',
  pulse: 'бесконечная анимация только у живого состояния (загрузка, идёт запись); у статичного блока — без пульсации',
  emoji: 'значки — UI.icon(name) из Lucide, эмодзи в интерфейсе не ставить',
  rub: 'между числом и ₽ — неразрывный пробел; формат денег — fmt из UI.stat',
  'stat-tones': 'у карточек показателей на экране один цветной тон (accent); цвет — только сигнал warn/danger',
  'img-heavy': 'картинку больше 200 КБ перевести в WebP или AVIF и ужать под размер показа; большие исходники — вне каталога, который раздаётся (механика 2)',
  'img-lazy': 'у картинки ниже первого экрана — loading="lazy" (и decoding="async"); у главной картинки первого экрана — loading="eager" и fetchpriority="high" (механика 15)',
  'script-blocking': 'сторонний скрипт — с defer или async, либо подключать после загрузки страницы (механика 21)',
  'font-cdn': 'шрифты хранить у себя (woff2 в статике продукта) и подключать только нужные начертания; ui-kit уже несёт свои шрифты (механика 29)',
  'select-star': 'выбирать из базы только нужные колонки, без SELECT * (механика 24)',
  'no-timeout': 'у запроса к внешнему API — таймаут: timeout= в requests/httpx/urlopen, AbortSignal.timeout(мс) в fetch (механика 12)',
  donut: 'бублик — UI.chart.donut(prev, canvas, { items, total, centerLabel }) (в теме zp — ZPDonut), кольцо выполнения плана — UI.ring.mount; conic-gradient для графиков не рисовать',
  bar: 'рейтинг с полосами — UI.barlist.mount(el, { items: [{ label, value, display, share, tone }], sorted, max }); своих дорожек с width:${…}% не верстать',
  'bar-ghost': 'полоса «факт и план» — UI.barlist.mount(el, { items: [{ label, display, share: факт, ghost: план или pipeline, tone }], sorted: false }); две свои заливки в дорожке не верстать',
  'stat-size': 'карточку UI.stat не ужимать своим CSS: размер числа, подписи и спарклайна задаёт ui-kit; плотная сетка — колонки .zp-dash-stats, не font-size и height у .ui-stat__*',
  'stat-bare': 'у карточки UI.stat — info (формула, «?» по клику, onInfo) и icon (имя Lucide), как в Пульсе: дизайн-система ZP требует «?» с формулой',
  stretch: 'svg не растягивать: спарклайн — UI.stat.spark(el, values) или UI.stat.core.sparkSvg под размер блока в px; график — в реальных пикселях (canvas, viewBox равен размеру)',
};

// Подсказка по виду; вид <вид>-js (стили строкой из JS) берёт подсказку исходного вида.
export const hintOf = (kind) => HINTS[kind] || HINTS[String(kind).replace(/-js$/, '')] || '';

function stripComment(s) { return s.replace(/(?:-->|\*\/)\}?\s*$/, '').trim(); }
function hasReason(text, marker) {
  const re = new RegExp(`${marker}:([^\\n]*)`, 'g');
  let m;
  while ((m = re.exec(text))) if (stripComment(m[1]).length > 0) return true;
  return false;
}

// Скрытые каталоги (.worktrees, .venv) и окружения Python — чужие копии и зависимости, не код продукта.
const skipDir = (name, exts) => SKIP_DIRS.has(name) || name.startsWith('.') || /^(?:venv|env|__pycache__|site-packages)$/.test(name) || (exts === IMG_EXTS && name === 'docs');
function walk(dir, out, exts = EXTS) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!skipDir(e.name, exts)) walk(join(dir, e.name), out, exts); continue; }
    if (!e.isFile()) continue;
    if (!exts.has(extname(e.name).toLowerCase())) continue;
    if (/\.(min|test)\./.test(e.name)) continue;
    out.push(join(dir, e.name));
  }
}

function cssRanges(text, ext) {
  if (ext === '.css') return [[0, text.length]];
  if (!STYLE_IN_MARKUP.has(ext)) return [];
  const ranges = [];
  const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = re.exec(text))) ranges.push([m.index + m[0].indexOf('>') + 1, m.index + m[0].length - '</style>'.length]);
  return ranges;
}

// Стили, вставленные строкой из JS: строка начинается с селектора и содержит `{` ('.zpm-chip{height:24px;…}', `.x { … }`).
// Блокирующие CSS-правила видят их отдельным видом <вид>-js (JS_CSS_KINDS): раскатка принимает новый вид долгом старого кода, рост старого вида её роняет.
const JS_CSS = /(['"`])\s*((?:[.#][\w-]|@media\b|@supports\b|:root\b)[^'"`\n{}]*\{[^'"`]*)\1/g;
export const JS_CSS_KINDS = [{ kind: 'toast-js' }, { kind: 'dialog-js' }, { kind: 'control-js' }, { kind: 'tip-js' }, { kind: 'stat-size-js' }];
const JS_CSS_OF = new Set(JS_CSS_KINDS.map((k) => k.kind.replace(/-js$/, '')));
function jsCssRanges(text, ext, cssR) {
  if (ext === '.css' || ext === '.py') return [];
  const out = [];
  JS_CSS.lastIndex = 0;
  let m;
  while ((m = JS_CSS.exec(text))) {
    const a = m.index + 1, b = m.index + m[0].length - 1;
    if (!cssR.some(([x, y]) => a >= x && a < y)) out.push([a, b]);
    JS_CSS.lastIndex = b; // закрывающая кавычка не начинает следующую строку
  }
  return out;
}

export function scanFile(text, ext) {
  const lines = text.split('\n');
  if (hasReason(lines.slice(0, 5).join('\n'), 'ui-kit-allow-file')) return [];
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  const lineOf = (idx) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= idx) lo = mid; else hi = mid - 1; } return lo; };
  const ranges = cssRanges(text, ext);
  const inCss = (idx) => ranges.some(([a, b]) => idx >= a && idx < b);
  const jsRanges = jsCssRanges(text, ext, ranges);
  const inJsCss = (idx) => jsRanges.some(([a, b]) => idx >= a && idx < b);
  const found = [];
  const lex = lexSource(text, ext);
  let tw;
  const ctx = { noComments: lex.noComments, code: lex.code, strings: lex.strings, tailwind: () => (tw ||= tailwindFindings(text, lex)) };
  const inCssComment = (idx) => text.lastIndexOf('/*', idx) > text.lastIndexOf('*/', idx);
  for (const rule of RULES) {
    if (ext === '.py' && !rule.py) continue;
    if (rule.exts && !rule.exts.includes(ext)) continue;
    const level = rule.level || 'block';
    const hits = [];
    if (rule.match) for (const h of rule.match(text, ext, ctx)) hits.push({ index: h.index, snippet: h.snippet ?? '' });
    else {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(text))) {
        if (m[0].length === 0) { rule.re.lastIndex++; continue; }
        if (rule.skip && rule.skip(m, text)) continue;
        hits.push({ index: m.index, snippet: m[0] });
      }
    }
    for (const h of hits) {
      const css = inCss(h.index);
      let kind = rule.kind;
      if (rule.scope === 'css' && !css && level === 'block' && JS_CSS_OF.has(rule.kind) && inJsCss(h.index)) kind = `${rule.kind}-js`;
      else if (rule.scope !== 'any' && (rule.scope === 'css') !== css) continue;
      if (level === 'warn' && css && inCssComment(h.index)) continue;
      const li = lineOf(h.index);
      if (hasReason(lines[li], 'ui-kit-allow')) continue;
      if (ext === '.py' && /^\s*#/.test(lines[li])) continue;
      found.push({ kind, level, line: li + 1, snippet: h.snippet.replace(/\s+/g, ' ').trim().slice(0, 80) });
    }
  }
  return found.sort((a, b) => a.line - b.line);
}

export function scan(root) {
  const files = [];
  walk(root, files);
  const findings = [];
  for (const f of files.sort()) {
    const rel = relative(root, f).split(sep).join('/');
    for (const x of scanFile(readFileSync(f, 'utf8'), extname(f))) findings.push({ file: rel, ...x });
  }
  const images = [];
  walk(root, images, IMG_EXTS);
  for (const f of images.sort()) {
    const size = statSync(f).size;
    if (size > IMG_HEAVY_BYTES) findings.push({ file: relative(root, f).split(sep).join('/'), kind: 'img-heavy', level: 'warn', line: 1, snippet: `${Math.round(size / 1024)} КБ` });
  }
  const counts = {}, warnCounts = {};
  for (const f of findings) { const t = f.level === 'warn' ? warnCounts : counts, k = `${f.file}::${f.kind}`; t[k] = (t[k] || 0) + 1; }
  return { findings, counts, warnCounts };
}

const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));

export function compare(counts, base) {
  const grown = [], shrunk = [];
  for (const [k, n] of Object.entries(counts)) if (!(k in base) || n > base[k]) grown.push({ key: k, was: base[k] || 0, now: n });
  for (const [k, n] of Object.entries(base)) if ((counts[k] || 0) < n) shrunk.push({ key: k, was: n, now: counts[k] || 0 });
  return { grown, shrunk };
}

// Предупреждения вкуса: по виду — число, файлы, подсказка и до 3 примеров; с all — каждая находка построчно.
function warnSummary(warns) {
  const by = {};
  for (const f of warns) (by[f.kind] ||= []).push(f);
  return by;
}
function printWarnings(warns, log, all) {
  if (!warns.length) return;
  const groups = [['вкуса', warns.filter((f) => !SPEED_KINDS.has(f.kind))], ['скорости', warns.filter((f) => SPEED_KINDS.has(f.kind))]];
  for (const [title, group] of groups) {
    if (!group.length) continue;
    log('');
    log(`ui-kit guard: предупреждения ${title} (не блокируют) — ${group.length}`);
    for (const [kind, list] of Object.entries(warnSummary(group))) {
      log(`  [${kind}] ${list.length} в файлах: ${new Set(list.map((f) => f.file)).size} — ${hintOf(kind)}`);
      for (const f of list.slice(0, 3)) log(`    ${f.file}:${f.line} ${f.snippet}`);
    }
  }
  if (all) { log(''); for (const f of warns) log(`${f.file}:${f.line} [${f.kind}] ${f.snippet}`); }
  else log('Все места построчно: флаг --warnings.');
}
const warnJson = (warns) => ({ counts: Object.fromEntries(Object.entries(warnSummary(warns)).map(([k, v]) => [k, v.length])), findings: warns });

// ── Покрытие: где в продукте стоит ui-kit, а где самописное (с 0.34.0) ──────────────────────────────────────────
// Самописное берётся из блокирующих правил RULES (kinds) и COVER[].own; использование ui-kit — из COVER[].use. RULES не меняются.
export const COVER = [
  { id: 'control', title: 'Кнопки, сегменты, чипы', kit: '.ui-btn · UI.seg · .ui-chip', kinds: ['control', 'control-js'],
    use: new RegExp(`(?<![\\w-])(?:ui-btn|ui-seg|ui-chip|ui-input|ui-select|ui-check)(?![\\w-])|\\bUI\\.seg\\b`, 'g') },
  { id: 'dialog', title: 'Окна', kit: 'UI.dialog', kinds: ['dialog', 'dialog-js', 'native-dialog'], use: new RegExp(`\\bUI\\.dialog\\b|(?<![\\w-])ui-dialog(?![\\w-])`, 'g') },
  { id: 'toast', title: 'Тосты', kit: 'UI.toast', kinds: ['toast', 'toast-js'], use: new RegExp(`\\bUI\\.toast\\b|(?<![\\w-])ui-toast(?![\\w-])`, 'g') },
  { id: 'tip', title: 'Подсказки', kit: 'UI.tip', kinds: ['tip', 'tip-js'], use: new RegExp(`\\bUI\\.tip\\b|\\bUI\\.chart\\.tooltip\\b|(?<![\\w-])ui-tip(?![\\w-])`, 'g') },
  { id: 'icon', title: 'Значки', kit: 'UI.icon', kinds: ['icon'], use: new RegExp(`\\bUI\\.(?:iconsMount|icons|icon)\\b|(?<![\\w-])ui-icon(?![\\w-])`, 'g') },
  { id: 'chart', title: 'Графики', kit: 'UI.chart · UI.stat.spark · UI.ring', kinds: ['stretch', 'donut'],
    use: new RegExp(`\\bUI\\.(?:chart|ring)\\b|\\bUI\\.stat\\.spark\\b|\\bZPSpark\\.|(?<![\\w-])(?:ui-chart|ui-spark|ui-ring)(?![\\w-])`, 'g'),
    own: /(?<![\w.])new\s+Chart\s*\(/g },
  { id: 'bar', title: 'Полосы-рейтинги', kit: 'UI.barlist', kinds: ['bar', 'bar-ghost'], use: new RegExp(`\\bUI\\.barlist\\b|(?<![\\w-])ui-barlist(?![\\w-])`, 'g') },
  { id: 'stat', title: 'Карточки показателей', kit: 'UI.stat', kinds: ['stat-size', 'stat-size-js'], use: new RegExp(`\\bUI\\.stat\\.mount\\b`, 'g') },
];
export const MODULES = [
  { id: 'stat', title: 'Карточка показателя', use: new RegExp(`\\bUI\\.stat\\b|(?<![\\w-])ui-stat(?![\\w-])`, 'g') },
  { id: 'period', title: 'Период', use: new RegExp(`\\bUI\\.period\\b|\\bZPPeriod\\b|(?<![\\w-])ui-period(?![\\w-])`, 'g') },
  { id: 'drill', title: 'Из чего цифра', use: new RegExp(`\\bUI\\.drill\\b|(?<![\\w-])ui-drill(?![\\w-])`, 'g') },
  { id: 'skeleton', title: 'Скелетоны', use: new RegExp(`\\bUI\\.skeleton\\b|(?<![\\w-])(?:ui-skeleton|ui-skel)(?![\\w-])`, 'g') },
  { id: 'sidenav', title: 'Сайдбар', use: new RegExp(`\\bUI\\.sidenav\\b|(?<![\\w-])ui-sidenav(?![\\w-])`, 'g') },
  { id: 'palette', title: 'Палитра и клавиши', use: new RegExp(`\\bUI\\.(?:palette|keys)\\b|(?<![\\w-])ui-pal(?![\\w-])`, 'g') },
  { id: 'barlist', title: 'Список с полосами', use: new RegExp(`\\bUI\\.barlist\\b|(?<![\\w-])ui-barlist(?![\\w-])`, 'g') },
  { id: 'ring', title: 'Кольцо', use: new RegExp(`\\bUI\\.ring\\b|(?<![\\w-])ui-ring(?![\\w-])`, 'g') },
  { id: 'feed', title: 'Лента', use: new RegExp(`\\bUI\\.feed\\b|(?<![\\w-])ui-feed(?![\\w-])`, 'g') },
  { id: 'reader', title: 'Режим чтения', use: new RegExp(`\\bUI\\.reader\\b|(?<![\\w-])(?:ui-reader|ui-prose)(?![\\w-])`, 'g') },
  { id: 'panel', title: 'Панель и шапка', use: new RegExp(`(?<![\\w-])(?:ui-panel|ui-topbar)(?![\\w-])`, 'g') },
  { id: 'glass', title: 'Стекло', use: new RegExp(`(?<![\\w-])(?:ui-glass|ui-lglass)(?![\\w-])`, 'g') },
];

const CHART_HINT = 'график рисовать через UI.chart (пресеты и UI.chart.draw), а не new Chart() напрямую; бублик — UI.chart.donut, кольцо плана — UI.ring, не conic-gradient; спарклайн — UI.stat.spark(el, values); svg не растягивать';
export const coverHint = (id) => (id === 'chart' ? CHART_HINT : id === 'stat' ? HINTS['stat-size'] : HINTS[id]);

// Номера строк по смещению; строка с ui-kit-allow не считается.
function lineTools(text) {
  const lines = text.split('\n'), starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  const lineOf = (idx) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= idx) lo = mid; else hi = mid - 1; } return lo; };
  return { lines, lineOf };
}
function reHits(re, text, allowed) {
  const out = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    const li = allowed.lineOf(m.index);
    if (hasReason(allowed.lines[li], 'ui-kit-allow')) continue;
    out.push({ line: li + 1, snippet: m[0].replace(/\s+/g, ' ').trim().slice(0, 80) });
  }
  return out;
}

// Покрытие одного файла: по элементам — самописное (own) и из ui-kit (kit), модули ui-kit, число предупреждений, самописное по строкам.
export function coverFile(text, ext) {
  const found = scanFile(text, ext);
  const warnings = found.filter((f) => f.level === 'warn').length;
  if (ext === '.py') return { elements: {}, modules: [], warnings, findings: [] };
  const elements = {}, findings = [];
  const bump = (id, key) => { (elements[id] ||= { own: 0, kit: 0 })[key]++; };
  const kindToId = new Map(COVER.flatMap((c) => c.kinds.map((k) => [k, c.id])));
  for (const f of found) {
    if (f.level === 'warn' || !kindToId.has(f.kind)) continue;
    const id = kindToId.get(f.kind);
    bump(id, 'own');
    findings.push({ element: id, line: f.line, snippet: f.snippet });
  }
  const allowed = lineTools(text);
  const bare = lexSource(text, ext).noComments; // комментарий не использование: `UI.toast` в пояснении не значит, что тост взят из ui-kit
  const fileAllowed = hasReason(allowed.lines.slice(0, 5).join('\n'), 'ui-kit-allow-file');
  for (const c of COVER) {
    if (c.own && !fileAllowed) for (const h of reHits(c.own, bare, allowed)) { bump(c.id, 'own'); findings.push({ element: c.id, ...h }); }
    for (let i = reHits(c.use, bare, allowed).length; i > 0; i--) bump(c.id, 'kit');
  }
  const modules = MODULES.filter((m) => reHits(m.use, bare, allowed).length > 0).map((m) => m.id);
  findings.sort((a, b) => a.line - b.line);
  return { elements, modules, warnings, findings };
}

const SCREEN_EXTS = new Set(['.html', '.jinja', '.j2']);
const REACT_EXTS = new Set(['.tsx', '.jsx']);
function fileGroup(rel, ext) {
  if (rel.startsWith('docs/') || `/${rel}`.includes('/mockups/')) return 'docs';
  const base = rel.split('/').pop();
  if (REACT_EXTS.has(ext) && /(?:^|\/)(?:views|screens|pages)\//.test(rel)) return 'screen'; // React: файлы в views/, screens/, pages/ — экраны (манифеста экранов нет)
  if (SCREEN_EXTS.has(ext) || base === '+page.svelte' || base === '+layout.svelte' || (ext === '.svelte' && /(?:^|\/)routes\//.test(rel))) return 'screen';
  return 'shared';
}
function fileTitle(text, ext, rel) {
  const base = rel.split('/').pop();
  if (!SCREEN_EXTS.has(ext)) return base;
  const m = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const t = m ? m[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 60).trim() : '';
  return !t || /\{\{|\{%|\$\{/.test(t) ? base : t; // шаблонные скобки и ${…} из строки JS (<title> внутри svg) — не название экрана
}
export const elementState = (own, kit) => (own > 0 && kit > 0 ? 'mixed' : own > 0 ? 'own' : kit > 0 ? 'kit' : 'none');

export function coverage(root, { paths } = {}) {
  const abs = [];
  for (const p of paths && paths.length ? paths : ['.']) {
    const dir = resolve(root, p);
    if (existsSync(dir) && statSync(dir).isDirectory()) walk(dir, abs);
  }
  const files = [];
  for (const f of [...new Set(abs)].sort()) {
    const rel = relative(root, f).split(sep).join('/'), ext = extname(f).toLowerCase();
    const text = readFileSync(f, 'utf8');
    const c = coverFile(text, ext), group = fileGroup(rel, ext);
    const own = Object.values(c.elements).reduce((n, e) => n + e.own, 0), kit = Object.values(c.elements).reduce((n, e) => n + e.kit, 0);
    if (group !== 'screen' && !own && !kit && !c.modules.length) continue;
    files.push({ file: rel, group, title: fileTitle(text, ext, rel), own, kit, warnings: c.warnings, elements: c.elements, modules: c.modules, findings: c.findings });
  }
  files.sort((a, b) => b.own - a.own || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  // В итоги идёт код продукта; витрины, документы и макеты (group docs) остаются в files, но не считаются.
  const counted = files.filter((f) => f.group !== 'docs');
  const elements = {};
  for (const c of COVER) {
    const own = counted.reduce((n, f) => n + (f.elements[c.id]?.own || 0), 0), kit = counted.reduce((n, f) => n + (f.elements[c.id]?.kit || 0), 0);
    const ownFiles = counted.filter((f) => f.elements[c.id]?.own > 0).length, kitFiles = counted.filter((f) => f.elements[c.id]?.kit > 0).length;
    elements[c.id] = { own, kit, ownFiles, kitFiles, state: elementState(own, kit) };
  }
  const screens = counted.filter((f) => f.group === 'screen');
  const totals = {
    own: counted.reduce((n, f) => n + f.own, 0), kit: counted.reduce((n, f) => n + f.kit, 0), warnings: counted.reduce((n, f) => n + f.warnings, 0),
    screens: screens.length, clean: screens.filter((f) => f.own === 0).length, elements,
  };
  return { files, totals };
}

const STATE_WORD = { kit: 'раскатано', mixed: 'смешано', own: 'самописное', none: 'не встречается' };
function printCoverage(cov, log) {
  const t = cov.totals;
  log(`ui-kit guard: покрытие — самописных мест ${t.own}, из ui-kit ${t.kit}.`);
  for (const c of COVER) {
    const e = t.elements[c.id];
    log(`  ${c.title}: самописных ${e.own}, из ui-kit ${e.kit} — ${STATE_WORD[e.state]}`);
  }
  log(`Экранов без самописного ${t.clean} из ${t.screens}.`);
  const top = cov.files.filter((f) => f.own > 0).slice(0, 10);
  if (top.length) {
    log('Файлы с наибольшим числом самописного:');
    for (const f of top) log(`  ${f.own}\t${f.file}`);
  }
}

export function run(argv, log = console.log) {
  const args = argv.filter((a) => !a.startsWith('--'));
  const write = argv.includes('--write-baseline');
  const json = argv.includes('--json');
  const allWarns = argv.includes('--warnings');
  const speedOnly = argv.includes('--speed');
  const coverOnly = argv.includes('--coverage');
  if (args.length !== 1) { log('использование: node guard.js <корень продукта> [--write-baseline] [--json] [--warnings] [--speed] [--coverage]'); return 2; }
  const root = resolve(args[0]);
  if (!existsSync(root) || !statSync(root).isDirectory()) { log(`нет каталога: ${root}`); return 2; }
  if (coverOnly) {
    const cov = coverage(root);
    if (json) log(JSON.stringify(cov, null, 2)); else printCoverage(cov, log);
    return 0;
  }
  const { findings: all, counts } = scan(root);
  if (speedOnly) {
    const speed = all.filter((f) => SPEED_KINDS.has(f.kind));
    if (json) log(JSON.stringify({ status: 'speed', warnings: warnJson(speed) }, null, 2));
    else if (!speed.length) log('ui-kit guard: предупреждений скорости нет.');
    else printWarnings(speed, log, allWarns);
    return 0;
  }
  const findings = all.filter((f) => f.level !== 'warn'), warns = all.filter((f) => f.level === 'warn');
  const basePath = join(root, BASELINE_FILE);

  if (write) {
    const data = { version: 1, generated: new Date().toISOString(), counts: sortKeys(counts) };
    writeFileSync(basePath, JSON.stringify(data, null, 2) + '\n');
    const total = findings.length;
    log(json ? JSON.stringify({ status: 'baseline-written', keys: Object.keys(counts).length, total, path: basePath }) : `База записана: ${basePath} (ключей ${Object.keys(counts).length}, находок ${total}).`);
    return 0;
  }
  if (!existsSync(basePath)) {
    const msg = `Нет файла базы ${BASELINE_FILE} в ${root}. Создай: node guard.js ${args[0]} --write-baseline`;
    log(json ? JSON.stringify({ status: 'no-baseline', message: msg, warnings: warnJson(warns) }) : msg);
    return 2;
  }
  const base = JSON.parse(readFileSync(basePath, 'utf8')).counts || {};
  const { grown, shrunk } = compare(counts, base);
  const growKeys = new Set(grown.map((g) => g.key));
  const fresh = findings.filter((f) => growKeys.has(`${f.file}::${f.kind}`));
  if (json) {
    log(JSON.stringify({ status: grown.length ? 'new-findings' : 'ok', grown, shrunk, findings: fresh, warnings: warnJson(warns) }, null, 2));
    return grown.length ? 1 : 0;
  }
  if (grown.length) {
    log(`ui-kit guard: найдено новых повторов элементов ui-kit — ключей ${grown.length}.`);
    for (const g of grown) log(`  ${g.key}: было ${g.was}, стало ${g.now}`);
    log('');
    for (const f of fresh) {
      log(`${f.file}:${f.line} [${f.kind}] ${f.snippet}`);
      log(`  Что взять из ui-kit: ${hintOf(f.kind)}.`);
    }
    log('');
    log('Каталог готовых элементов: 02_PROJECTS/Personal OS/00_overview/reusable_elements_catalog.md (vault).');
    log('Если повтор осознанный — в этой строке добавь комментарий `// ui-kit-allow: <причина>` (в HTML `<!-- ui-kit-allow: <причина> -->`, в CSS `/* ui-kit-allow: <причина> */`);');
    log('для всего файла — `ui-kit-allow-file: <причина>` в первых 5 строках. Без причины исключение не работает.');
    log('Базу ui-kit-guard.json не обновлять, пока дубль не убран.');
    printWarnings(warns, log, allWarns);
    return 1;
  }
  if (shrunk.length) log(`ui-kit guard: ок. Повторов стало меньше (ключей ${shrunk.length}) — обнови базу: node guard.js ${args[0]} --write-baseline`);
  else log('ui-kit guard: ок, новых повторов нет.');
  printWarnings(warns, log, allWarns);
  return 0;
}

if (import.meta.main ?? (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))) {
  process.exitCode = run(process.argv.slice(2)); // не process.exit: большой вывод в пайп обрезался бы
}
