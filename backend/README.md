# PBTH Backend

Express + Postgres backend for Paintball Team Hub.

## Scripts

- `npm run dev` - run backend on `PORT` (default 8000)
- `npm run db:migrate` - apply SQL migrations
- `npm run db:seed` - insert demo seed
- `npm run build` - compile TypeScript
- `npm run check` - typecheck
- `npm run lint` - lint gate (currently type-safe lint baseline)
- `npm run test:unit` - unit tests
- `npm run test:integration` - integration tests
- `npm run test` - all tests

## Required env

See root `.env.example`.

Critical vars:
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
- `SESSION_SECRET`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`
- `TELEGRAM_CALLBACK_URL`
- `ICS_TOKEN_SECRET`

## API and observability baseline

- Versioned API: `/api/v1/*`
- Legacy alias: `/api/*` with `Deprecation/Sunset` headers
- OpenAPI endpoint: `GET /api/v1/openapi.json`
- Request correlation-id header: `x-correlation-id`
- Structured JSON request logs in stdout
- Finance write endpoints support `Idempotency-Key` header for safe retries
- Optional async reminders queue: `pg-boss` (`NOTIFICATIONS_QUEUE_ENABLED=1`)
