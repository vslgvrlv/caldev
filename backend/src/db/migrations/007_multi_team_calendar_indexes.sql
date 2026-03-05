CREATE INDEX IF NOT EXISTS idx_events_team_start_cancelled
  ON events(team_id, start_at, is_cancelled);

CREATE INDEX IF NOT EXISTS idx_rsvps_user_event_status
  ON rsvps(user_id, event_id, status);

CREATE INDEX IF NOT EXISTS idx_team_memberships_user_team
  ON team_memberships(user_id, team_id);
