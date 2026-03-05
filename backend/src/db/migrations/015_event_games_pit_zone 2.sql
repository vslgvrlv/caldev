ALTER TABLE event_games
  ADD COLUMN IF NOT EXISTS pit_zone TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'event_games_pit_zone_check'
      AND conrelid = 'event_games'::regclass
  ) THEN
    ALTER TABLE event_games
      ADD CONSTRAINT event_games_pit_zone_check
      CHECK (pit_zone IS NULL OR pit_zone IN ('NEAR', 'FAR'));
  END IF;
END $$;
