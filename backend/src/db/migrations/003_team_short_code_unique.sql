-- Remove duplicated teams by short_code, keep the oldest record.
CREATE TEMP TABLE tmp_team_dedup AS
WITH ranked AS (
  SELECT
    id,
    short_code,
    ROW_NUMBER() OVER (PARTITION BY short_code ORDER BY created_at ASC, id ASC) AS rn,
    FIRST_VALUE(id) OVER (PARTITION BY short_code ORDER BY created_at ASC, id ASC) AS keep_id
  FROM teams
)
SELECT
  id AS dup_id,
  keep_id,
  short_code
FROM ranked
WHERE rn > 1;

-- Move memberships from duplicate teams to canonical teams where possible.
UPDATE team_memberships tm
SET team_id = d.keep_id,
    updated_at = NOW()
FROM tmp_team_dedup d
WHERE tm.team_id = d.dup_id
  AND tm.team_id <> d.keep_id
  AND NOT EXISTS (
    SELECT 1
    FROM team_memberships x
    WHERE x.user_id = tm.user_id AND x.team_id = d.keep_id
  );

-- Remove leftover memberships that still point to duplicate teams.
DELETE FROM team_memberships tm
USING tmp_team_dedup d
WHERE tm.team_id = d.dup_id;

DELETE FROM event_games eg
USING events e, tmp_team_dedup d
WHERE eg.event_id = e.id
  AND e.team_id = d.dup_id;

DELETE FROM rsvps r
USING events e, tmp_team_dedup d
WHERE r.event_id = e.id
  AND e.team_id = d.dup_id;

DELETE FROM events e
USING tmp_team_dedup d
WHERE e.team_id = d.dup_id;

DELETE FROM transactions t
USING tmp_team_dedup d
WHERE t.team_id = d.dup_id;

DELETE FROM teams t
USING tmp_team_dedup d
WHERE t.id = d.dup_id;

DROP TABLE tmp_team_dedup;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'teams_short_code_key'
  ) THEN
    ALTER TABLE teams
      ADD CONSTRAINT teams_short_code_key UNIQUE (short_code);
  END IF;
END $$;
