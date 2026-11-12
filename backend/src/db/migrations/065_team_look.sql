-- 065: оформление команды — краска, фигура знака и буквы (решение Василия 12.11.2026).
--
-- Только добавление: три необязательных столбца в `teams`. Данные существующих
-- команд не меняются: пока столбцы пусты, краска и фигура считаются по id
-- команды, буквы — из названия, как раньше.
--
-- Откат кода эту схему не задевает — старый код о столбцах не знает.
-- Откат схемы:
--   ALTER TABLE teams
--     DROP COLUMN IF EXISTS mark_paint,
--     DROP COLUMN IF EXISTS mark_shape,
--     DROP COLUMN IF EXISTS mark_letters;
--   DELETE FROM schema_migrations WHERE id = '065_team_look.sql';
--
-- Список красок держит код (`lib/team-look.ts`), база проверяет только вид
-- значения: палитра может пополниться без новой миграции.

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS mark_paint TEXT
    CONSTRAINT teams_mark_paint_hex CHECK (mark_paint IS NULL OR mark_paint ~ '^#[0-9A-F]{6}$'),
  ADD COLUMN IF NOT EXISTS mark_shape SMALLINT
    CONSTRAINT teams_mark_shape_range CHECK (mark_shape IS NULL OR mark_shape BETWEEN 0 AND 8),
  ADD COLUMN IF NOT EXISTS mark_letters TEXT
    CONSTRAINT teams_mark_letters_len CHECK (mark_letters IS NULL OR char_length(mark_letters) BETWEEN 1 AND 2);
