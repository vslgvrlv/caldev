DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'event_cost_status') THEN
    CREATE TYPE event_cost_status AS ENUM ('UNKNOWN', 'ESTIMATED', 'FINAL');
  END IF;
END $$;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS cost_status event_cost_status;

UPDATE events
SET cost_status = CASE
  WHEN cost IS NULL THEN 'UNKNOWN'::event_cost_status
  ELSE 'ESTIMATED'::event_cost_status
END
WHERE cost_status IS NULL;

ALTER TABLE events
  ALTER COLUMN cost_status SET DEFAULT 'UNKNOWN'::event_cost_status,
  ALTER COLUMN cost_status SET NOT NULL;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS cost_settlement_transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS cost_finalized_at TIMESTAMPTZ;

ALTER TABLE event_series
  ADD COLUMN IF NOT EXISTS cost_status event_cost_status;

UPDATE event_series
SET cost_status = CASE
  WHEN cost IS NULL THEN 'UNKNOWN'::event_cost_status
  ELSE 'ESTIMATED'::event_cost_status
END
WHERE cost_status IS NULL;

ALTER TABLE event_series
  ALTER COLUMN cost_status SET DEFAULT 'UNKNOWN'::event_cost_status,
  ALTER COLUMN cost_status SET NOT NULL;
