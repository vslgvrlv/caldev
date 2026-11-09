import react from '@vitejs/plugin-react';
import { createServer, type Plugin } from 'vite';
import { injectLanding, rewriteRootToLanding } from './inject';

// Пререндер главной при сборке (personal-os#1438, механика 20).
// Сборка: из готового index.html делается landing.html с разметкой главной
// внутри #root. Оболочка index.html остаётся пустой — она нужна остальным
// адресам и сервис-воркеру (navigateFallback), чтобы /app не мигал главной.
// Раздача: vite preview отдаёт landing.html на "/".
export function landingPrerender(): Plugin {
  let root = '';
  return {
    name: 'pbth-landing-prerender',
    enforce: 'post',
    configResolved(config) {
      root = config.root;
    },
    async generateBundle(_options, bundle) {
      const index = bundle['index.html'];
      if (!index || index.type !== 'asset') {
        this.error('landing prerender: index.html is missing from the bundle');
      }
      const server = await createServer({
        configFile: false,
        root,
        logLevel: 'error',
        appType: 'custom',
        server: { middlewareMode: true, hmr: false },
        plugins: [react()],
      });
      try {
        const mod = (await server.ssrLoadModule('/prerender/landing.tsx')) as { renderLanding: () => string };
        this.emitFile({
          type: 'asset',
          fileName: 'landing.html',
          source: injectLanding(String(index.source), mod.renderLanding()),
        });
      } finally {
        await server.close();
      }
    },
    configurePreviewServer(server) {
      server.middlewares.use((req: { url?: string }, _res: unknown, next: () => void) => {
        if (req.url) req.url = rewriteRootToLanding(req.url);
        next();
      });
    },
  };
}
