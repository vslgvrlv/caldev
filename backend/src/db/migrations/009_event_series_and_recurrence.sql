CREATE TABLE IF NOT EXISTS event_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  type event_type NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  cost NUMERIC(12,2),
  start_time_utc TIME NOT NULL,
  end_time_utc TIME NOT NULL,
  weekdays SMALLINT[] NOT NULL,
  until_date DATE NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS series_id UUID REFERENCES event_series(id) ON DELETE SET NULL;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS occurrence_date DATE;

UPDATE events
SET occurrence_date = (start_at AT TIME ZONE 'UTC')::date
WHERE occurrence_date IS NULL;

CREATE INDEX IF NOT EXISTS idx_events_series_start
  ON events(series_id, start_at);

CREATE INDEX IF NOT EXISTS idx_events_occurrence_date
  ON events(occurrence_date);

DROP TRIGGER IF EXISTS trg_event_series_updated_at ON event_series;
CREATE TRIGGER trg_event_series_updated_at
BEFORE UPDATE ON event_series
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
