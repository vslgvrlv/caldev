import React, { Suspense } from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { LandingView } from '../views/LandingView';

// Готовая разметка главной для landing.html (personal-os#1438, механика 20).
// Дерево повторяет то, что App рисует на "/": Suspense (у него в разметке
// свои маркеры <!--$-->, без них гидрация падает) → Routes → LandingView.
// Routes узлов не даёт. Меняешь обёртки в App вокруг <Routes> — поменяй и тут.
export function renderLanding(): string {
  return renderToString(
    <React.StrictMode>
      <StaticRouter location="/">
        <Suspense fallback={null}>
          <LandingView />
        </Suspense>
      </StaticRouter>
    </React.StrictMode>,
  );
}
