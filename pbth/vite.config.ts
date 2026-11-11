// @ts-ignore: в проекте нет @types/node, Node-модули в конфиге берём как есть
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { landingPrerender } from './prerender/vite-plugin';

// Страницы инструкций (public/guide/*.html) статичные и открываются без входа, но вид берут у ui-kit.
// Бандл кладёт ui-kit в хешированные файлы, поэтому статичной странице нужны свои адреса: этот плагин отдаёт
// файлы закреплённой копии из vendor/ui-kit/<версия>/ (и раскладку нового слоя ui/pbth-ui.css) по адресам
// /guide/ui-kit/* — в dev и preview из памяти, в сборке файлами в dist/guide/ui-kit/. Руками ничего не копируется;
// версия ui-kit задана здесь и в index.tsx, при обновлении правятся оба места.
const UI_KIT_VERSION = '0.43.0';
const GUIDE_ASSETS: Record<string, { from: string; type: string }> = {
  'ui-kit.css': { from: `vendor/ui-kit/${UI_KIT_VERSION}/ui-kit.css`, type: 'text/css' },
  'themes/pbth.css': { from: `vendor/ui-kit/${UI_KIT_VERSION}/themes/pbth.css`, type: 'text/css' },
  'themes/pbth-fonts.css': { from: `vendor/ui-kit/${UI_KIT_VERSION}/themes/pbth-fonts.css`, type: 'text/css' },
  'themes/fonts/manrope-cyrillic-wght-normal.woff2': { from: `vendor/ui-kit/${UI_KIT_VERSION}/themes/fonts/manrope-cyrillic-wght-normal.woff2`, type: 'font/woff2' },
  'themes/fonts/manrope-latin-wght-normal.woff2': { from: `vendor/ui-kit/${UI_KIT_VERSION}/themes/fonts/manrope-latin-wght-normal.woff2`, type: 'font/woff2' },
  'icons.svg': { from: `vendor/ui-kit/${UI_KIT_VERSION}/icons.svg`, type: 'image/svg+xml' },
  'pbth-ui.css': { from: 'ui/pbth-ui.css', type: 'text/css' },
};
function guideAssets(): Plugin {
  const serve = (server: { middlewares: { use: (fn: (req: any, res: any, next: () => void) => void) => void } }) => {
    server.middlewares.use((req, res, next) => {
      const key = String(req.url || '').split('?')[0].replace(/^\/guide\/ui-kit\//, '');
      const asset = key !== req.url ? GUIDE_ASSETS[key] : undefined;
      if (!asset) return next();
      res.setHeader('content-type', asset.type);
      res.end(readFileSync(new URL(asset.from, import.meta.url)));
    });
  };
  return {
    name: 'pbth-guide-assets',
    configureServer: serve,
    configurePreviewServer: serve,
    generateBundle() {
      for (const [key, asset] of Object.entries(GUIDE_ASSETS)) {
        this.emitFile({ type: 'asset', fileName: `guide/ui-kit/${key}`, source: readFileSync(new URL(asset.from, import.meta.url)) });
      }
    },
  };
}

const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
const apiTarget = runtimeProcess?.env?.VITE_BACKEND_TARGET || 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [
    react(),
    // Без сервис-воркера приложение на турнире не открывается вообще: манифест
    // даёт иконку на домашнем экране, но за ней всё равно уходит запрос в сеть.
    VitePWA({
      // Новая версия ждёт, пока человек нажмёт «Обновить» (lib/register-sw.ts).
      // При autoUpdate она включалась молча и сама перезагружала открытую
      // страницу (незаконченная форма пропадала), а экран, который не успели
      // открыть, мог загрузиться по уже несуществующему адресу — белый экран.
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
    guideAssets(),
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
