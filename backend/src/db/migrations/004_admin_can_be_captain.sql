CREATE OR REPLACE FUNCTION prevent_admin_membership() RETURNS trigger AS $$
DECLARE
  user_role account_role;
BEGIN
  SELECT account_role INTO user_role FROM users WHERE id = NEW.user_id;
  -- Account admin cannot be a regular player, but can be captain for managed teams.
  IF user_role = 'ADMIN' AND NEW.role = 'PLAYER' THEN
    RAISE EXCEPTION 'admin account cannot be added as PLAYER team membership';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_admin_membership ON team_memberships;
CREATE TRIGGER trg_prevent_admin_membership
BEFORE INSERT OR UPDATE ON team_memberships
FOR EACH ROW
EXECUTE FUNCTION prevent_admin_membership();
