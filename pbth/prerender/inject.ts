const EMPTY_ROOT = '<div id="root"></div>';

// Вставляет готовую разметку в оболочку index.html. Ровно один пустой
// корень, иначе сборка падает: тихо выпустить главную без разметки хуже.
export function injectLanding(indexHtml: string, markup: string): string {
  const first = indexHtml.indexOf(EMPTY_ROOT);
  if (first === -1 || indexHtml.indexOf(EMPTY_ROOT, first + 1) !== -1) {
    throw new Error('landing prerender: index.html must contain exactly one empty <div id="root"></div>');
  }
  if (!markup.trim()) {
    throw new Error('landing prerender: empty markup');
  }
  return indexHtml.replace(EMPTY_ROOT, `<div id="root">${markup}</div>`);
}

// "/" и "/?…" отдаются как landing.html; всё остальное — оболочка index.html.
export function rewriteRootToLanding(url: string): string {
  if (url === '/' || url.startsWith('/?')) return `/landing.html${url.slice(1)}`;
  return url;
}
