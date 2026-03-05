# PBTH Frontend

React + Vite frontend for PaintBall Team Hub.

## Scripts

- `npm run dev` - start local dev server
- `npm run build` - production build
- `npm run typecheck` - TypeScript checks
- `npm run lint` - lint gate (type-safe baseline)
- `npm run test:unit` - vitest unit tests
- `npm run test:e2e` - playwright e2e tests (uses `E2E_BASE_URL`, default `http://127.0.0.1:3000`)
- `npm run gen:api-types` - generate OpenAPI-based type definitions from backend

## API baseline

- Primary API path: `/api/v1/*`
- Legacy `/api/*` remains temporarily for compatibility.
