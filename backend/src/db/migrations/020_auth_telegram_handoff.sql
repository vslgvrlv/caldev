ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

UPDATE users
SET onboarding_completed_at = COALESCE(onboarding_completed_at, NOW());

CREATE TABLE IF NOT EXISTS auth_telegram_handoff_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_key TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL CHECK (scope IN ('USER', 'ADMIN')),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'LINK_SENT', 'COMPLETED', 'EXPIRED', 'CANCELLED')),
  redirect_to TEXT NOT NULL,
  telegram_user_id TEXT,
  telegram_chat_id TEXT,
  telegram_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  completion_token_hash TEXT,
  completion_token_expires_at TIMESTAMPTZ,
  requested_ip_hash TEXT,
  requested_ua_hash TEXT,
  last_sent_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_telegram_handoff_attempts_expires_at
  ON auth_telegram_handoff_attempts (expires_at);

CREATE INDEX IF NOT EXISTS idx_auth_telegram_handoff_attempts_completion_hash
  ON auth_telegram_handoff_attempts (completion_token_hash)
  WHERE completion_token_hash IS NOT NULL;
