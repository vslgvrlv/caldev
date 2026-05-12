CREATE TABLE IF NOT EXISTS auth_oauth_state (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  intent TEXT NOT NULL CHECK (intent IN ('login', 'link')),
  link_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  redirect_to TEXT NOT NULL,
  code_verifier TEXT,
  nonce TEXT,
  ip_hash TEXT,
  ua_hash TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_auth_oauth_state_expires_at ON auth_oauth_state (expires_at);
