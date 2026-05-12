CREATE TABLE IF NOT EXISTS auth_oauth_pending_link (
  token TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  provider_email TEXT,
  provider_display_name TEXT,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_oauth_pending_link_expires_at ON auth_oauth_pending_link (expires_at);
