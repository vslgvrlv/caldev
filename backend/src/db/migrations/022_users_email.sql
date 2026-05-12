-- Intentionally nullable and NOT UNIQUE: PBTH supports multiple identity
-- providers, and two users may legitimately share a single email (family
-- accounts, etc.). Account-uniqueness is enforced via user_identities, not
-- here. Manual link via Profile is the only way to merge identities — no
-- auto-merge by email.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
