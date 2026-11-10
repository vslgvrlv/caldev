// Короткий код команды из названия: латиница, большие буквы, до 8 знаков.
// «Дневной Дозор» → DNEVDOZ… — по первым буквам слов, если слов несколько.

const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

function toLatin(text: string): string {
  return Array.from(text.toLowerCase())
    .map((ch) => (ch in TRANSLIT ? TRANSLIT[ch] : ch))
    .join("")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function suggestShortCode(name: string): string {
  const words = toLatin(name).split(/\s+/).filter(Boolean);
  if (!words.length) return "TEAM";
  let code: string;
  if (words.length === 1) {
    code = words[0].slice(0, 6);
  } else {
    // По три буквы с первых двух слов и по букве с остальных: узнаваемо и коротко.
    code = words[0].slice(0, 3) + words[1].slice(0, 3) + words.slice(2).map((w) => w[0]).join("");
  }
  code = code.slice(0, 8).toUpperCase();
  return code.length >= 2 ? code : `${code}TEAM`.slice(0, 4);
}
