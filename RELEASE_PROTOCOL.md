# PBTH Release Protocol (Staging-First, Mandatory)

This is the canonical deployment instruction for this project.

## Non-negotiable rules

1. `prod` is frozen until staging is verified.
2. Every release goes: local test -> artifact -> staging -> verification -> prod.
3. Never deploy production by running `docker compose up --build` in `/root/caldev`.
4. Production deploy and rollback are allowed only through release scripts.
5. `prod` and `staging` must stay isolated (different env, ports, DB).

## Primary release path: GitHub workflows

Use GitHub UI as the default operator path:

1. Run `Release Artifact` (from `main`) with `release_id`.
2. Run `Deploy Staging` with the same `release_id`.
3. Verify staging.
4. Run `Deploy Production` with the same `release_id`.
5. For rollback run `Rollback Release`.

Required secrets and click-by-click flow are documented in `.github/DEPLOYMENT.md`.

## Required server env files

- `/opt/pbth/shared/env/staging.env`
- `/opt/pbth/shared/env/prod.env`

Auth v2 env block is mandatory for both files:

- `AUTH_OIDC_ENABLED`
- `AUTH_OIDC_FALLBACK_ENABLED`
- `AUTH_OIDC_ADMIN_REQUIRED`
- `AUTH_OIDC_CANARY_PERCENT`
- `AUTH_OIDC_CANARY_COOKIE`
- `AUTH_OIDC_CANARY_COOKIE_MAX_AGE_SEC`
- `TELEGRAM_OIDC_CLIENT_ID`
- `TELEGRAM_OIDC_CLIENT_SECRET`
- `TELEGRAM_OIDC_REDIRECT_URI`
- `TELEGRAM_OIDC_ISSUER`
- `TELEGRAM_OIDC_JWKS_URL`
- `AUTH_SLO_ENABLED`
- `AUTH_SLO_WINDOW_MINUTES`
- `AUTH_SLO_MIN_ATTEMPTS`
- `AUTH_SLO_MAX_ERROR_RATE`
- `AUTH_SLO_TOKEN` (optional)

Переменная из файла окружения доходит до бэкенда только если она перечислена
в разделе `environment` сервиса `backend` в `docker-compose.release.yml`.
Добавил новую настройку в код — добавь её и туда, иначе на сервере она
молча останется значением по умолчанию (тест
`backend/src/__tests__/unit/release-compose-env.test.ts`).

Авто-напоминания о явке включаются строкой `AUTO_REMINDERS_ENABLED=1` в файле
окружения и следующим выкатом. Проверка: в логе бэкенда есть
`reminders.auto.started`.

Владелец платформы задаётся в `ADMIN_ROLE_ALLOWLIST_IDS` числовым ID Telegram;
`ADMIN_ROLE_ALLOWLIST_USERNAMES` остаётся пустым (ник можно сменить, а
освободившийся — занять). На сервере так с 11.11.2026 для прода и staging.
Без этой настройки владельца нет: заявки на команды некому одобрить.

## How to release (copy-paste flow)

### 1) On Mac: build artifact

```bash
cd /Users/pk/Documents/CalDEV
./scripts/release/build-artifact.sh v2026.03.05-stg1
```

### 2) On Mac: upload artifact to server

```bash
scp dist/releases/pbth-release-v2026.03.05-stg1.tar.gz root@89.108.66.32:/root/caldev/dist/releases/
scp dist/releases/pbth-release-v2026.03.05-stg1.tar.gz.sha256 root@89.108.66.32:/root/caldev/dist/releases/
```

### 3) On server: deploy to staging

```bash
ssh root@89.108.66.32
cd /root/caldev
./scripts/deploy-staging.sh /root/caldev/dist/releases/pbth-release-v2026.03.05-stg1.tar.gz /root/caldev/dist/releases/pbth-release-v2026.03.05-stg1.tar.gz.sha256 https://staging.pbthub.ru
```

### 4) Verify staging

```bash
curl -fsS https://staging.pbthub.ru/api/v1/health
curl -fsS https://staging.pbthub.ru/api/v1/release/version
```

Also verify key product flows in Telegram Mini App on staging.
And run auth error-budget check:

```bash
./scripts/release/auth-slo-check.sh --base-url https://staging.pbthub.ru --window-minutes 60
```

### 5) Promote same artifact to prod

```bash
./scripts/deploy-prod.sh /root/caldev/dist/releases/pbth-release-v2026.03.05-stg1.tar.gz /root/caldev/dist/releases/pbth-release-v2026.03.05-stg1.tar.gz.sha256 https://pbthub.ru
```

## Rollback (if needed)

```bash
./scripts/rollback.sh prod <releaseId> https://pbthub.ru
./scripts/rollback.sh staging <releaseId> https://staging.pbthub.ru
```

Rollback returns code only. Migrations are not reverted: the old code runs on
the new schema. If a migration damaged data, restore the database from the
backup taken before that release (next section).

## Бэкап базы перед миграциями

Каждый выкат (`deploy.sh`, а значит и `deploy-staging.sh` / `deploy-prod.sh`,
и workflow `Deploy Staging` / `Deploy Production`) снимает копию базы до сборки
и миграций:

- скрипт `scripts/release/db-backup.sh`, дамп делает `pg_dump` внутри
  контейнера базы (`pbth-<env>-db-1`), на сервере нужен только `docker`;
- файл `/opt/pbth/shared/backups/<env>/pbth-<env>-<время UTC>-pre-<releaseId>.dump`
  (формат custom, сжат), каталог только для root (700);
- архив проверяется `pg_restore --list`; не снялся или не читается — выкат
  останавливается до миграций, ничего не изменено;
- хранятся последние 20 копий каждого окружения (`--keep`, переменная
  `PBTH_DB_BACKUP_KEEP`);
- последний дамп выката записан в `/opt/pbth/shared/manifests/last-backup-<env>.txt`.

Workflow снимает копию отдельным шагом «Backup database before deploy»: скрипт
из текущего коммита уходит на сервер через `ssh ... bash -s`, поэтому копия
снимается, даже если чекаут `/root/caldev` на сервере старый. `deploy.sh` видит
свежую копию с той же меткой (до 60 минут) и второй раз не снимает.

Ручные команды ниже и `deploy-*.sh` запускаются из чекаута `/root/caldev`.
Новые скрипты появятся там, только когда чекаут обновят до `main` с этим
изменением — до тех пор бэкап при выкате снимает шаг workflow.

Ручная копия в любой момент:

```bash
cd /root/caldev
./scripts/release/db-backup.sh --env prod --label manual
ls -lh /opt/pbth/shared/backups/prod/
```

Копии лежат на том же сервере. Если умрёт сервер, умрут и они — копия вне
сервера пока не настроена (отдельная задача).

### Восстановление

Когда: миграция или выкат испортили данные. Если сломан только код —
достаточно `rollback.sh`, базу не трогать: восстановление теряет всё, что
записали после снятия копии.

1. Вернуть код на прошлый релиз (схема в копии соответствует ему):

   ```bash
   cd /root/caldev
   ./scripts/rollback.sh prod <прошлый releaseId> https://pbthub.ru
   ```

2. Найти копию, снятую перед сломавшим релизом:

   ```bash
   cat /opt/pbth/shared/manifests/last-backup-prod.txt
   ls -lt /opt/pbth/shared/backups/prod/ | head
   ```

3. Восстановить:

   ```bash
   ./scripts/release/db-restore.sh --env prod \
     --file /opt/pbth/shared/backups/prod/pbth-prod-<время>-pre-<releaseId>.dump \
     --confirm prod
   ```

   Скрипт снимает ещё одну копию текущей базы (`before-restore`), останавливает
   бэкенд, разворачивает дамп в новую базу `<db>_restore_<время>` с той же
   кодировкой и локалью, и только если разворот прошёл — меняет базы именами.
   Текущая база остаётся как `<db>_before_restore_<время>`. Бэкенд запускается.

4. Проверить: `curl -fsS https://pbthub.ru/api/v1/health`, вход в мини-приложение,
   главная команды, календарь.

5. Когда всё проверено, удалить старую базу (команду печатает скрипт):

   ```bash
   docker exec pbth-prod-db-1 sh -c 'dropdb -U "$POSTGRES_USER" pbth_prod_before_restore_<время>'
   ```

Если `db-restore.sh` недоступен, то же руками: `docker exec -i pbth-prod-db-1
pg_restore --list < файл` (проверка), остановить бэкенд, `createdb` новой базы,
`pg_restore -d <новая> --no-owner --exit-on-error --single-transaction < файл`,
затем `ALTER DATABASE ... RENAME` из базы `postgres`.

## Заголовки защиты (на сервере с 11.11.2026)

Бэкенд уже ставит заголовки на `/api/` и `/calendar/` (helmet: HSTS, `nosniff`,
`X-Frame-Options`, `Referrer-Policy: no-referrer`). Страницы фронтенда идут
от контейнера фронтенда без заголовков — их добавляет nginx. С 11.11.2026
фрагмент подключён на сервере для прода и staging:

- `infra/nginx/pbth-security-headers.conf.example` — фрагмент с заголовками:
  HSTS (те же параметры, что у бэкенда), `X-Content-Type-Options: nosniff`,
  `Content-Security-Policy: frame-ancestors 'self' https://web.telegram.org
  https://*.telegram.org` (мини-приложение в web.telegram.org открывается во
  фрейме, поэтому не `X-Frame-Options`), `Referrer-Policy:
  strict-origin-when-cross-origin`;
- `infra/nginx/pbth.conf.example` — `include` фрагмента в локациях `/`,
  `/assets/`, `/icons/` обоих доменов. В `/api/` и `/calendar/` не включать —
  заголовки задвоятся.

На сервере конфиг лежит в двух файлах, а не в одном, как в образце:
`/etc/nginx/sites-available/pbth.conf` (прод, фронтенд на `127.0.0.1:3000`,
бэкенд на `:8000`) и `pbth-staging.conf` (staging, `:3200` и `:8200`). Тот же
nginx обслуживает сайты защитаплёнкой.рф и zashchitaplenkoy.ru — после любой
правки проверять и их. Бэкапы до правки 11.11.2026:
`pbth.conf.bak-20261111-102855-headers`, `pbth-staging.conf.bak-20261111-102734-headers`.

Порядок, если понадобится повторить (новый сервер, восстановление):

```bash
cp -p /etc/nginx/sites-available/pbth-staging.conf /etc/nginx/sites-available/pbth-staging.conf.bak-$(date +%F)
cp infra/nginx/pbth-security-headers.conf.example /etc/nginx/snippets/pbth-security-headers.conf
# в конфиге добавить строку include в location /, /assets/, /icons/ — после proxy_pass
nginx -t && systemctl reload nginx
```

Сначала staging, потом prod. Проверка:

```bash
curl -sI https://staging.pbthub.ru/ | grep -iE 'strict-transport|x-content-type|content-security|referrer-policy'
curl -sI https://staging.pbthub.ru/assets/ | grep -ic 'strict-transport'   # 1, не 2
curl -sI https://staging.pbthub.ru/api/v1/health | grep -ic 'strict-transport'  # 1: только от бэкенда
```

И руками: мини-приложение открывается в Telegram на телефоне, в Telegram Desktop
и в web.telegram.org (там оно во фрейме — если пусто, виноват `frame-ancestors`).
Откат: убрать строки `include`, `nginx -t && systemctl reload nginx`.

## Риск: фронтенд в проде раздаёт `vite preview`

`pbth/Dockerfile` собирает фронтенд и запускает `npm run preview` — сервер
предпросмотра Vite. Это инструмент разработки: в образе лежат все
dev-зависимости (Vite, Vitest, Playwright), у него свои правила хостов
(`preview.allowedHosts`), уязвимости Vite из `npm audit` относятся и к нему, а
кэш и сжатие настроены не нами. Сейчас это работает за nginx и не ломается,
поэтому ночью не менялось.

Предложение: многоступенчатый `pbth/Dockerfile` — сборка в `node:20-alpine`,
раздача `dist` из `nginx:alpine` на том же порту 3000 с запасным
`try_files $uri /index.html` для адресов приложения, `no-cache` для
`index.html`, `sw.js`, манифеста и годовым кэшем для `/assets/`. Порт и
compose не меняются, внешний nginx не трогается. Проверка до прода: staging,
вход в мини-приложение, офлайн-открытие (сервис-воркер), пререндер главной.

## Operator note

Only `releaseId` changes between runs (`vYYYY.MM.DD-...`).  
All other commands remain identical.

After each successful prod deploy, update `docs/releases.md` with new stable and rollback anchor.
