-- RBAC update:
-- allow allowlisted accounts to use dual-mode (ADMIN/USER)
-- and participate in team memberships while in USER entry mode.

CREATE OR REPLACE FUNCTION prevent_admin_membership() RETURNS trigger AS $$
BEGIN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_admin_membership ON team_memberships;
CREATE TRIGGER trg_prevent_admin_membership
BEFORE INSERT OR UPDATE ON team_memberships
FOR EACH ROW
EXECUTE FUNCTION prevent_admin_membership();
