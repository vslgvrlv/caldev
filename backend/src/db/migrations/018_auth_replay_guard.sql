CREATE TABLE IF NOT EXISTS auth_replay_guard (
  provider TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  subject_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (provider, payload_hash)
);

CREATE INDEX IF NOT EXISTS idx_auth_replay_guard_expires_at
  ON auth_replay_guard (expires_at);

