-- Штрафной вывод с поля — третий исход пойнта (#104).
--
-- Было: eliminated BOOLEAN — «выбили | дожил». Игрока, снятого судьёй по штрафу,
-- описать нечем, и он вынужден отмечаться как выбитый. Дальше эта ложь уезжает
-- во все производные: тепловая карта показывает укрытие, на котором игрока никто
-- не выбивал; в позиционном обмене раздувается знаменатель; сопернику начисляется
-- фраг, которого не было.
--
-- Стало — две независимые оси:
--   exit_reason  — КАК покинул поле: SURVIVED | HIT | PENALTY
--   penalty_kind — ЧЕЙ штраф на игроке: OWN | TEAMMATE | NULL (штрафа не было)
--
-- Оси независимы намеренно. «Сняли за мой штраф» = (PENALTY, OWN), «сняли в
-- довесок к партнёру по 2-за-1» = (PENALTY, TEAMMATE), «выбили, и сверху я
-- заработал штраф команде» = (HIT, OWN). Формулировка Василия «выведен ЗА штраф /
-- выведен С штрафом» допускала оба прочтения — схема покрывает оба, и уточнение
-- влияет только на подписи кнопок, но не на форму данных.
--
-- death_* → exit_*: при штрафном выводе фазу и позицию мы тоже пишем (где стоял,
-- когда сняли — данные полезные). Имя death_position_id обещало бы, что там лежат
-- только смерти, и любой будущий `WHERE death_position_id IS NOT NULL` молча
-- зачерпнул бы штрафы в статистику смертей. Имя exit_* ничего не обещает и
-- заставляет автора запроса дописать `AND exit_reason = 'HIT'`.

BEGIN;

-- 1. Новые колонки.
ALTER TABLE game_reflections ADD COLUMN IF NOT EXISTS exit_reason  TEXT;
ALTER TABLE game_reflections ADD COLUMN IF NOT EXISTS penalty_kind TEXT;

-- 2. Переименование death_* → exit_*. RENAME COLUMN не умеет IF EXISTS,
--    поэтому сверяемся с каталогом — миграция должна переживать повторный прогон.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'game_reflections' AND column_name = 'death_phase'
  ) THEN
    ALTER TABLE game_reflections RENAME COLUMN death_phase TO exit_phase;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'game_reflections' AND column_name = 'death_position_id'
  ) THEN
    ALTER TABLE game_reflections RENAME COLUMN death_position_id TO exit_position_id;
  END IF;
END $$;

-- 3. Бэкфилл. Ничего не выдумываем: старые записи знают только «выбили/дожил»,
--    штрафов среди них по определению нет.
UPDATE game_reflections
SET exit_reason = CASE WHEN eliminated THEN 'HIT' ELSE 'SURVIVED' END
WHERE exit_reason IS NULL;

-- 4. Старые ограничения снимаем до того, как удалить eliminated.
ALTER TABLE game_reflections DROP CONSTRAINT IF EXISTS game_reflections_death_consistency_check;
ALTER TABLE game_reflections DROP CONSTRAINT IF EXISTS game_reflections_death_phase_check;

-- 5. eliminated больше не нужен: он выводится из exit_reason, а две колонки об
--    одном и том же неизбежно разъезжаются.
ALTER TABLE game_reflections DROP COLUMN IF EXISTS eliminated;

ALTER TABLE game_reflections ALTER COLUMN exit_reason SET NOT NULL;

-- 6. Новые инварианты.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'game_reflections_exit_reason_check'
      AND conrelid = 'game_reflections'::regclass
  ) THEN
    ALTER TABLE game_reflections ADD CONSTRAINT game_reflections_exit_reason_check
      CHECK (exit_reason IN ('SURVIVED', 'HIT', 'PENALTY'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'game_reflections_exit_phase_check'
      AND conrelid = 'game_reflections'::regclass
  ) THEN
    ALTER TABLE game_reflections ADD CONSTRAINT game_reflections_exit_phase_check
      CHECK (exit_phase IS NULL OR exit_phase IN ('BREAK', 'COVER', 'ROTATION'));
  END IF;

  -- Дожил — фазы и позиции ухода нет. Ушёл (выбили или сняли) — фаза обязательна,
  -- укрытие может быть неизвестно: на разбежке игрок не всегда помнит, откуда
  -- прилетело, и терять всю форму из-за этого нельзя.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'game_reflections_exit_consistency_check'
      AND conrelid = 'game_reflections'::regclass
  ) THEN
    ALTER TABLE game_reflections ADD CONSTRAINT game_reflections_exit_consistency_check
      CHECK (
        (exit_reason = 'SURVIVED' AND exit_phase IS NULL AND exit_position_id IS NULL)
        OR (exit_reason IN ('HIT', 'PENALTY') AND exit_phase IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'game_reflections_penalty_kind_check'
      AND conrelid = 'game_reflections'::regclass
  ) THEN
    ALTER TABLE game_reflections ADD CONSTRAINT game_reflections_penalty_kind_check
      CHECK (penalty_kind IS NULL OR penalty_kind IN ('OWN', 'TEAMMATE'));
  END IF;

  -- «Сняли по штрафу, а чей штраф — не знаю» в базу не попадает: без этого
  -- разделения нельзя отличить нарушителя от того, кого сняли в довесок.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'game_reflections_penalty_required_check'
      AND conrelid = 'game_reflections'::regclass
  ) THEN
    ALTER TABLE game_reflections ADD CONSTRAINT game_reflections_penalty_required_check
      CHECK (exit_reason <> 'PENALTY' OR penalty_kind IS NOT NULL);
  END IF;
END $$;

COMMIT;
