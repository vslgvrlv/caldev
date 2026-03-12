DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'event_owner_kind') THEN
    CREATE TYPE event_owner_kind AS ENUM ('TEAM', 'VENUE', 'INTEGRATION');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'event_source_kind') THEN
    CREATE TYPE event_source_kind AS ENUM ('MANUAL', 'VENUE_API', 'INTEGRATION_API');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'event_registration_status') THEN
    CREATE TYPE event_registration_status AS ENUM ('REQUESTED', 'CONFIRMED', 'WAITLISTED', 'REJECTED', 'CANCELLED');
  END IF;
END $$;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS owner_kind event_owner_kind,
  ADD COLUMN IF NOT EXISTS owner_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS owner_name TEXT,
  ADD COLUMN IF NOT EXISTS source_kind event_source_kind,
  ADD COLUMN IF NOT EXISTS source_provider TEXT,
  ADD COLUMN IF NOT EXISTS source_external_event_id TEXT;

UPDATE events
SET owner_kind = 'TEAM'::event_owner_kind
WHERE owner_kind IS NULL;

UPDATE events
SET owner_team_id = team_id
WHERE owner_team_id IS NULL AND owner_kind = 'TEAM'::event_owner_kind;

UPDATE events
SET source_kind = 'MANUAL'::event_source_kind
WHERE source_kind IS NULL;

ALTER TABLE events
  ALTER COLUMN owner_kind SET DEFAULT 'TEAM'::event_owner_kind,
  ALTER COLUMN owner_kind SET NOT NULL,
  ALTER COLUMN source_kind SET DEFAULT 'MANUAL'::event_source_kind,
  ALTER COLUMN source_kind SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_owner_kind_team
  ON events(owner_kind, owner_team_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_source_external
  ON events(source_kind, source_provider, source_external_event_id)
  WHERE source_external_event_id IS NOT NULL AND source_provider IS NOT NULL;

CREATE TABLE IF NOT EXISTS event_team_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  status event_registration_status NOT NULL DEFAULT 'REQUESTED',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  confirmed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  external_registration_id TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(event_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_event_team_registrations_team_status
  ON event_team_registrations(team_id, status);

CREATE INDEX IF NOT EXISTS idx_event_team_registrations_event_status
  ON event_team_registrations(event_id, status);

DROP TRIGGER IF EXISTS trg_event_team_registrations_updated_at ON event_team_registrations;
CREATE TRIGGER trg_event_team_registrations_updated_at
BEFORE UPDATE ON event_team_registrations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS event_team_schedule_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  registration_id UUID REFERENCES event_team_registrations(id) ON DELETE SET NULL,
  time_label TEXT NOT NULL,
  starts_at TIMESTAMPTZ,
  opponent TEXT NOT NULL,
  score TEXT,
  pit_zone event_game_pit_zone,
  game_pair event_game_pair,
  source_kind event_source_kind NOT NULL DEFAULT 'MANUAL',
  source_provider TEXT,
  source_external_game_id TEXT,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_event_team_schedule_items_dedupe
  ON event_team_schedule_items(event_id, team_id, time_label, opponent, COALESCE(source_external_game_id, ''));

CREATE INDEX IF NOT EXISTS idx_event_team_schedule_items_event_team
  ON event_team_schedule_items(event_id, team_id);

CREATE INDEX IF NOT EXISTS idx_event_team_schedule_items_team_time
  ON event_team_schedule_items(team_id, COALESCE(starts_at, published_at));

DROP TRIGGER IF EXISTS trg_event_team_schedule_items_updated_at ON event_team_schedule_items;
CREATE TRIGGER trg_event_team_schedule_items_updated_at
BEFORE UPDATE ON event_team_schedule_items
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO event_team_registrations (event_id, team_id, status, requested_at, confirmed_at, notes)
SELECT
  e.id,
  e.team_id,
  'CONFIRMED'::event_registration_status,
  e.created_at,
  e.created_at,
  'legacy_backfill'
FROM events e
WHERE NOT EXISTS (
  SELECT 1
  FROM event_team_registrations r
  WHERE r.event_id = e.id
    AND r.team_id = e.team_id
);

INSERT INTO event_team_schedule_items (
  event_id,
  team_id,
  registration_id,
  time_label,
  starts_at,
  opponent,
  score,
  pit_zone,
  game_pair,
  source_kind,
  published_at
)
SELECT
  g.event_id,
  e.team_id,
  r.id AS registration_id,
  g.time_label,
  NULL::timestamptz AS starts_at,
  g.opponent,
  g.score,
  g.pit_zone,
  g.game_pair,
  'MANUAL'::event_source_kind AS source_kind,
  COALESCE(g.updated_at, g.created_at, NOW()) AS published_at
FROM event_games g
JOIN events e ON e.id = g.event_id
LEFT JOIN event_team_registrations r
  ON r.event_id = g.event_id
 AND r.team_id = e.team_id
WHERE NOT EXISTS (
  SELECT 1
  FROM event_team_schedule_items s
  WHERE s.event_id = g.event_id
    AND s.team_id = e.team_id
    AND s.time_label = g.time_label
    AND s.opponent = g.opponent
    AND COALESCE(s.source_external_game_id, '') = ''
);
