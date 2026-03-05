-- RBAC v2:
-- 1) team role enum only: CAPTAIN, TRAINER, PLAYER
-- 2) migrate legacy ADMIN team role to CAPTAIN
-- 3) account ADMIN cannot hold team membership

DO $$
BEGIN
  -- Clean legacy values before enum swap.
  UPDATE team_memberships
  SET role = 'CAPTAIN'::membership_role
  WHERE role::text = 'ADMIN';
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'membership_role') THEN
    ALTER TYPE membership_role RENAME TO membership_role_old;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'membership_role') THEN
    CREATE TYPE membership_role AS ENUM ('CAPTAIN', 'TRAINER', 'PLAYER');
  END IF;
END $$;

ALTER TABLE team_memberships
  ALTER COLUMN role DROP DEFAULT;

ALTER TABLE team_invites
  ALTER COLUMN role DROP DEFAULT;

ALTER TABLE team_memberships
  ALTER COLUMN role TYPE membership_role
  USING role::text::membership_role;

ALTER TABLE team_invites
  ALTER COLUMN role TYPE membership_role
  USING role::text::membership_role;

ALTER TABLE team_invites
  ALTER COLUMN role SET DEFAULT 'PLAYER';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'membership_role_old') THEN
    DROP TYPE membership_role_old;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION prevent_admin_membership() RETURNS trigger AS $$
DECLARE
  user_role account_role;
BEGIN
  SELECT account_role INTO user_role FROM users WHERE id = NEW.user_id;
  IF user_role = 'ADMIN' THEN
    RAISE EXCEPTION 'admin account cannot have team memberships';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_admin_membership ON team_memberships;
CREATE TRIGGER trg_prevent_admin_membership
BEFORE INSERT OR UPDATE ON team_memberships
FOR EACH ROW
EXECUTE FUNCTION prevent_admin_membership();
