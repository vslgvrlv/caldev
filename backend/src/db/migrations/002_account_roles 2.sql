DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_role') THEN
    CREATE TYPE account_role AS ENUM ('ADMIN', 'USER');
  END IF;
END $$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS account_role account_role,
  ADD COLUMN IF NOT EXISTS role_selected_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION prevent_admin_membership() RETURNS trigger AS $$
DECLARE
  user_role account_role;
BEGIN
  SELECT account_role INTO user_role FROM users WHERE id = NEW.user_id;
  IF user_role = 'ADMIN' THEN
    RAISE EXCEPTION 'admin account cannot be added to team membership';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_admin_membership ON team_memberships;
CREATE TRIGGER trg_prevent_admin_membership
BEFORE INSERT OR UPDATE ON team_memberships
FOR EACH ROW
EXECUTE FUNCTION prevent_admin_membership();
