import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
const apiTarget = runtimeProcess?.env?.VITE_BACKEND_TARGET || 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [react()],
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
