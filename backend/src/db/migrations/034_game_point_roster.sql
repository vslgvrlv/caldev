-- Ростер пойнта — кто из наших реально выходил на этот пойнт (#102).
--
-- Сегодня форма рефлексии открыта на КАЖДЫЙ пойнт гейма для КАЖДОГО игрока
-- события. Миша (GRGR, 2026-08-03) поймал это с поля двумя жалобами, которые
-- на самом деле про одну дыру: «заполнять ли только те пойнты, которые
-- отыграл?» и «до нужного пойнта далеко листать». Пока состав пойнта не
-- записан, приложение не знает, кто выходил, и вынуждено предлагать всё всем.
--
-- Дальше та же дыра ломает метрики: знаменатель «сколько рефлексий ждём»
-- считается по составу события (10-12 человек), хотя на поле выходило пятеро.
-- Заполняемость выглядит вдвое хуже реальной.
--
-- Выводить ростер из самих рефлексий нельзя — это круг: знаменатель
-- («сколько должно быть») получился бы из числителя («сколько заполнили»).
--
-- Бэкфилла нет намеренно. Кто выходил на пойнт в июльских геймах, не знает
-- никто, а «мода по числу рефлексий» — выдуманные данные. Пустой ростер
-- означает «состав не записан» и деградирует в сегодняшнее поведение:
-- пойнт доступен всем. Так старые события не ломаются.

BEGIN;

CREATE TABLE IF NOT EXISTS game_point_roster (
  point_id   UUID NOT NULL REFERENCES game_points(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (point_id, user_id)
);

CREATE INDEX IF NOT EXISTS game_point_roster_user_idx ON game_point_roster (user_id);

-- Состав соперника — только размер. Поимённо чужих игроков мы не знаем и
-- знать не будем, а число нужно: 5-на-4 после штрафа — это другой пойнт, и
-- позиционную статистику в нём нельзя складывать с равным составом.
ALTER TABLE game_points ADD COLUMN IF NOT EXISTS opponent_roster_size SMALLINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'game_points_opponent_roster_size_check'
      AND conrelid = 'game_points'::regclass
  ) THEN
    ALTER TABLE game_points ADD CONSTRAINT game_points_opponent_roster_size_check
      CHECK (opponent_roster_size IS NULL OR opponent_roster_size BETWEEN 0 AND 10);
  END IF;
END $$;

COMMIT;
