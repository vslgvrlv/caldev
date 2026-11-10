import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { landingPrerender } from './prerender/vite-plugin';

const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
const apiTarget = runtimeProcess?.env?.VITE_BACKEND_TARGET || 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [
    react(),
    // Без сервис-воркера приложение на турнире не открывается вообще: манифест
    // даёт иконку на домашнем экране, но за ней всё равно уходит запрос в сеть.
    VitePWA({
      // Новая версия ждёт, пока человек нажмёт «Обновить» (lib/register-sw.ts).
      // При autoUpdate она включалась молча и стирала старые куски кода из-под
      // открытого приложения: экран, который не успели открыть, после выката
      // грузился по несуществующему адресу — белый экран.
      registerType: 'prompt',
      // Манифест уже лежит в public/ и ведётся руками — плагин его не трогает.
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        // Любой навигационный запрос отдаём из оболочки: без сети маршрут
        // /app/... иначе упирается в 404 сервера, которого нет.
        navigateFallback: '/index.html',
        // Запросы к API кешировать нельзя — данные приложение держит само, в
        // снимках IndexedDB, где видно их возраст. Кеш ответов дал бы вторую,
        // невидимую копию правды.
        navigateFallbackDenylist: [/^\/api\//, /^\/calendar\//],
        cleanupOutdatedCaches: true,
        // Push-уведомления (#36): отдельного service worker'а не заводим —
        // обработчик push/notificationclick вшивается в тот же Workbox SW.
        importScripts: ['/push-sw-handler.js'],
      },
      devOptions: { enabled: false },
    }),
    landingPrerender(),
  ],
  build: {
    rollupOptions: {
      onwarn(warning, warn) {
        const message = typeof warning === 'string' ? warning : warning.message || '';
        if (
          message.includes('/api/v1/vendor/tailwindcss.js') ||
          message.includes('/api/v1/vendor/telegram-web-app.js')
        ) {
          return;
        }
        warn(warning);
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: ['pbthub.ru', 'www.pbthub.ru', 'localhost', '127.0.0.1'],
    // Ключи со слешем на конце: Vite сравнивает ключ с началом адреса, и
    // '/api' забирал в бэкенд модуль /api.ts — страница оставалась пустой.
    proxy: {
      '/api/': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/calendar/': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: ['pbthub.ru', 'www.pbthub.ru', 'localhost', '127.0.0.1'],
  },
});
