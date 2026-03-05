ALTER TABLE event_games
  ADD COLUMN IF NOT EXISTS game_pair TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'event_games_pair_check'
      AND conrelid = 'event_games'::regclass
  ) THEN
    ALTER TABLE event_games
      ADD CONSTRAINT event_games_pair_check
      CHECK (game_pair IS NULL OR game_pair IN ('FIRST', 'SECOND'));
  END IF;
END $$;
