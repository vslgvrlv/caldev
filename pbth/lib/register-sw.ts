// Регистрация сервис-воркера вынесена из index.tsx, чтобы виртуальный модуль
// vite-plugin-pwa грузился лениво: в тестах и в dev-сборке его не существует, и
// статический импорт уронил бы точку входа.
export function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      registerSW({
        immediate: true,
        // Новая версия применяется молча и только при следующем открытии.
        // Перезагружать страницу на месте нельзя: обновление прилетит посреди
        // заполнения рефлексии между играми и сотрёт незаконченную форму.
        onNeedRefresh() {},
        onOfflineReady() {},
      });
    })
    .catch(() => {
      // Сборка без плагина (dev, тесты) — приложение работает как раньше.
    });
}
