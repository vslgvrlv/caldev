import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
// ui-kit 0.43.0 с темой pbth: токены --ui-* и шрифт Manrope (у себя, без CDN).
// Тема только объявляет переменные: фон, шрифт и цвета нынешних экранов не меняются,
// новые экраны применяют их через <Screen> (pbth/ui).
import './vendor/ui-kit/0.43.0/ui-kit.css';
import './vendor/ui-kit/0.43.0/themes/pbth-fonts.css';
import './vendor/ui-kit/0.43.0/themes/pbth.css';
import './index.css';
import { registerServiceWorker } from './lib/register-sw';
import { browserChunkReloadDeps, installChunkReloadHandler } from './lib/chunk-reload';

// После выката часть экрана могла уже уйти с сервера — одна перезагрузка
// подтянет новую сборку (защита от цикла — в lib/chunk-reload.ts).
installChunkReloadHandler(window, browserChunkReloadDeps());

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const app = (
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

// На "/" сервер отдаёт landing.html с готовой разметкой главной
// (personal-os#1438): её не перерисовываем, а гидрируем. Остальные адреса
// приходят с пустым #root.
if (rootElement.hasChildNodes()) {
  ReactDOM.hydrateRoot(rootElement, app);
} else {
  ReactDOM.createRoot(rootElement).render(app);
}

registerServiceWorker();