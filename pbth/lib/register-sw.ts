// Регистрация сервис-воркера вынесена из index.tsx, чтобы виртуальный модуль
// vite-plugin-pwa грузился лениво: в тестах и в dev-сборке его не существует, и
// статический импорт уронил бы точку входа.
//
// Новая версия не включается молча. При autoUpdate она сразу забирала управление
// и стирала старые куски кода из-под открытого приложения; экран, который ещё не
// успели открыть, грузился уже по несуществующему адресу — белый экран после
// каждого выката. Теперь новая версия ждёт, пока человек сам нажмёт «Обновить»,
// а до тех пор открытое приложение целиком живёт на старой, и все его экраны на
// месте. Нажать можно между играми: перезагрузка на месте среди заполнения
// рефлексии стёрла бы незаконченную форму, поэтому решает человек.
//
// Плашка рисуется прямым DOM, без React: она должна работать и тогда, когда само
// приложение уже упало.

export const UPDATE_PROMPT_ID = 'pbth-update-prompt';
export const UPDATE_PROMPT_TEXT = 'Доступна новая версия';

// Открытое приложение на телефоне может висеть сутками, и браузер за это время
// сам не спросит, нет ли новой версии: проверка идёт при переходе на страницу, а
// в приложении переходов нет. Поэтому спрашиваем сами.
export const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;
// При возврате в приложение проверяем не чаще раза в пять минут: переключения
// между приложениями на телефоне частые, а ответ всякий раз тот же.
const VISIBILITY_CHECK_MIN_GAP_MS = 5 * 60 * 1000;
// Если после «Обновить» страница так и не перезагрузилась, возвращаем кнопку.
const ACCEPT_RETRY_AFTER_MS = 8000;

export function showUpdatePrompt(doc: Document, onAccept: () => void | Promise<void>): void {
  if (doc.getElementById(UPDATE_PROMPT_ID)) return;

  const bar = doc.createElement('div');
  bar.id = UPDATE_PROMPT_ID;
  bar.setAttribute('role', 'status');
  bar.setAttribute('aria-live', 'polite');
  bar.className =
    'fixed left-1/2 top-0 z-[300] flex w-full max-w-md -translate-x-1/2 items-center justify-between gap-3 border-b border-pb-primary/30 bg-pb-surface px-4 pb-2 text-sm font-bold text-white shadow-lg shadow-black/50';
  bar.setAttribute('style', 'padding-top: calc(var(--pb-safe-top, 0px) + 0.5rem)');

  const text = doc.createElement('span');
  text.textContent = UPDATE_PROMPT_TEXT;
  bar.appendChild(text);

  const actions = doc.createElement('div');
  actions.className = 'flex shrink-0 items-center gap-2';

  const later = doc.createElement('button');
  later.setAttribute('type', 'button');
  later.className = 'rounded-lg px-2 py-1.5 text-xs font-bold text-pb-subtext';
  later.textContent = 'Позже';
  later.addEventListener('click', () => bar.remove());

  const accept = doc.createElement('button');
  accept.setAttribute('type', 'button');
  accept.className = 'rounded-lg bg-pb-primary px-3 py-1.5 text-xs font-bold text-pb-background disabled:opacity-60';
  accept.textContent = 'Обновить';

  const restore = () => {
    accept.disabled = false;
    accept.textContent = 'Обновить';
  };
  accept.addEventListener('click', () => {
    if (accept.disabled) return;
    accept.disabled = true;
    accept.textContent = 'Обновляем…';
    // Обычно страница перезагружается сама, и дальше этот код не доживает. Если
    // нет — не оставляем человека перед мёртвой кнопкой.
    setTimeout(restore, ACCEPT_RETRY_AFTER_MS);
    try {
      Promise.resolve(onAccept()).catch(restore);
    } catch {
      restore();
    }
  });

  actions.appendChild(later);
  actions.appendChild(accept);
  bar.appendChild(actions);
  doc.body.appendChild(bar);
}

export function watchForUpdates(
  registration: Pick<ServiceWorkerRegistration, 'update'> | undefined,
  doc: Pick<Document, 'addEventListener' | 'visibilityState'> = document
): void {
  if (!registration) return;
  let lastCheckAt = Date.now();
  const check = () => {
    lastCheckAt = Date.now();
    // Без сети проверка падает — это не событие, шуметь незачем.
    registration.update().catch(() => undefined);
  };
  setInterval(check, UPDATE_CHECK_INTERVAL_MS);
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState !== 'visible') return;
    if (Date.now() - lastCheckAt < VISIBILITY_CHECK_MIN_GAP_MS) return;
    check();
  });
}

type RegisterSW = (options: {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
  onRegisteredSW?: (swScriptUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
}) => (reloadPage?: boolean) => Promise<void>;

// Отдельно от динамического импорта, чтобы вся связка проверялась без
// виртуального модуля плагина.
export function startServiceWorker(registerSW: RegisterSW, doc: Document = document): void {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      showUpdatePrompt(doc, () => updateSW(true));
    },
    onOfflineReady() {},
    onRegisteredSW(_swScriptUrl, registration) {
      watchForUpdates(registration, doc);
    },
  });
}

export function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      startServiceWorker(registerSW);
    })
    .catch(() => {
      // Сборка без плагина (dev, тесты) — приложение работает как раньше.
    });
}
