-- 066: свой логотип команды — файл хранится в базе (решение Василия 12.11.2026).
--
-- Только добавление: одна новая таблица. Существующие таблицы и данные не
-- трогаются; столбец `teams.logo` (ссылка, заданная при создании команды)
-- остаётся как был и в знаке не используется.
--
-- Откат кода эту схему не задевает — старый код о таблице не знает.
-- Откат схемы:
--   DROP TABLE IF EXISTS team_logos;
--   DELETE FROM schema_migrations WHERE id = '066_team_logos.sql';
--
-- В строке — уже перекодированная картинка: квадрат 256×256 WebP без
-- метаданных (5–20 КБ). Исходный файл не хранится. `name` — случайное имя, под
-- которым картинка отдаётся (`/api/v1/teams/logo/<name>.webp`); новая загрузка
-- даёт новое имя, поэтому ответ можно кэшировать надолго.

CREATE TABLE IF NOT EXISTS team_logos (
  team_id    UUID PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  name       TEXT NOT NULL UNIQUE CHECK (name ~ '^[0-9a-f]{32}$'),
  data       BYTEA NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 262144),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
