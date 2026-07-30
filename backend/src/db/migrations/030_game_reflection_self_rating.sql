-- Самооценка игрока за гейм, шкала 1–5 (решение Василия 2026-07-29).
--
-- Отдельная от исхода величина: выбитый на разбежке мог отработать задачу и
-- поставить себе 4, а доживший до конца — простоять в укрытии и поставить 2.
-- Смысл поля именно в этом расхождении «результат ≠ качество работы».
--
-- Nullable: форма заполняется в перерыве между пойнтами, экран самооценки
-- пропускаемый. NULL = «не оценил», а не «оценил на ноль» — в агрегатах такие
-- строки исключаются, поэтому 0 как «нет ответа» использовать нельзя.

ALTER TABLE game_reflections
  ADD COLUMN IF NOT EXISTS self_rating SMALLINT;

ALTER TABLE game_reflections
  DROP CONSTRAINT IF EXISTS game_reflections_self_rating_check;

ALTER TABLE game_reflections
  ADD CONSTRAINT game_reflections_self_rating_check
  CHECK (self_rating IS NULL OR self_rating BETWEEN 1 AND 5);
