CREATE TABLE IF NOT EXISTS user_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  email TEXT,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_identities_provider_subject_unique UNIQUE (provider, provider_user_id),
  CONSTRAINT user_identities_user_provider_unique UNIQUE (user_id, provider)
);

-- No explicit LOCK: `INSERT ... ON CONFLICT DO NOTHING` is race-safe via the
-- unique constraint and we do not want to block writers on the users table
-- while the migration runs.
INSERT INTO user_identities (user_id, provider, provider_user_id)
SELECT id, 'telegram', telegram_id::TEXT
FROM users
WHERE telegram_id IS NOT NULL
ON CONFLICT (provider, provider_user_id) DO NOTHING;
