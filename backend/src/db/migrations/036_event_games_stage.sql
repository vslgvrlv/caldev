ALTER TABLE event_games
  ADD COLUMN IF NOT EXISTS stage TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'event_games_stage_check'
      AND conrelid = 'event_games'::regclass
  ) THEN
    ALTER TABLE event_games
      ADD CONSTRAINT event_games_stage_check
      CHECK (stage IS NULL OR stage IN ('GROUP', 'R16', 'QF', 'SF', 'FINAL'));
  END IF;
END $$;
