-- 031: пойнт как отдельная сущность внутри гейма.
--
-- ИСПРАВЛЕНИЕ МОДЕЛИ. В 029 рефлексия цеплялась к `event_games` — я прочитал в
-- спеке «пойнт» и «гейм» как синонимы. Это неверно: гейм со счётом 4:3 состоит
-- из семи пойнтов, и рефлексия заполняется за КАЖДЫЙ пойнт, а не за матч
-- целиком (Василий, 2026-07-31). Без этой сущности всё, что строится сверху,
-- считает семь разных эпизодов за один.
--
-- Количество пойнтов выводится из счёта гейма: «4:3» = 4 победных + 3
-- проигранных = 7 строк. Порядок из счёта НЕ выводится — какой именно пойнт
-- выиграли, знает только человек, поэтому `result` размечается вручную
-- (капитан/тренер) и до разметки равен NULL.
--
-- Зачем результат пойнта хранить отдельно от рефлексий: он известен ДО
-- заполнения формы, поэтому вопрос «выиграли или проиграли» из капитанского
-- опросника уходит, а ветка опроса выбирается автоматически.
--
-- Тестовые рефлексии со staging удаляются: они привязаны к гейму, а не к
-- пойнту, и корректно перенести их нельзя — неизвестно, какой пойнт имелся в
-- виду. Боевых данных на момент миграции нет.

CREATE TABLE IF NOT EXISTS game_points (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id    UUID NOT NULL REFERENCES event_games(id) ON DELETE CASCADE,
  ordinal    SMALLINT NOT NULL,
  -- NULL = пойнт сыгран, но ещё не размечен. Это не «ничья»: ничьих не бывает.
  result     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT game_points_result_check CHECK (result IS NULL OR result IN ('WIN', 'LOSS'))
);

CREATE UNIQUE INDEX IF NOT EXISTS game_points_game_ordinal_uniq ON game_points (game_id, ordinal);
CREATE INDEX IF NOT EXISTS game_points_game_idx ON game_points (game_id);

-- Переезд рефлексий с гейма на пойнт.
DELETE FROM game_reflections;
DELETE FROM game_captain_reports;

ALTER TABLE game_reflections DROP COLUMN IF EXISTS game_id;
ALTER TABLE game_reflections
  ADD COLUMN IF NOT EXISTS point_id UUID NOT NULL REFERENCES game_points(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS game_reflections_point_user_uniq ON game_reflections (point_id, user_id);
CREATE INDEX IF NOT EXISTS game_reflections_point_idx ON game_reflections (point_id);

ALTER TABLE game_captain_reports DROP COLUMN IF EXISTS game_id;
-- Результат пойнта живёт в game_points и мнением капитана не является:
-- счёт объективен, спрашивать его повторно — лишний шаг в форме.
ALTER TABLE game_captain_reports DROP COLUMN IF EXISTS result;
ALTER TABLE game_captain_reports
  ADD COLUMN IF NOT EXISTS point_id UUID NOT NULL REFERENCES game_points(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS game_captain_reports_point_uniq ON game_captain_reports (point_id);
