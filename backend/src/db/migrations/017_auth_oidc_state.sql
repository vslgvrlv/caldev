CREATE TABLE IF NOT EXISTS auth_oidc_state (
  state TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  nonce TEXT,
  redirect_to TEXT NOT NULL,
  ip_hash TEXT,
  ua_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_oidc_state_expires_at
  ON auth_oidc_state (expires_at);

