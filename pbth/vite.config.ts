import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
const apiTarget = runtimeProcess?.env?.VITE_BACKEND_TARGET || 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [
    react(),
    // Без сервис-воркера приложение на турнире не открывается вообще: манифест
    // даёт иконку на домашнем экране, но за ней всё равно уходит запрос в сеть.
    VitePWA({
      registerType: 'autoUpdate',
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
      },
      devOptions: { enabled: false },
    }),
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
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/calendar': {
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
