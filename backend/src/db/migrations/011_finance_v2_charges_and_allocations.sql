ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS event_id UUID REFERENCES events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_team_event_date
  ON transactions(team_id, event_id, date DESC);

CREATE TABLE IF NOT EXISTS event_member_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  amount_due NUMERIC(12,2) NOT NULL CHECK (amount_due >= 0),
  note TEXT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_member_charges_team_user
  ON event_member_charges(team_id, user_id);

CREATE INDEX IF NOT EXISTS idx_event_member_charges_event
  ON event_member_charges(event_id);

CREATE TABLE IF NOT EXISTS event_payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  event_member_charge_id UUID NOT NULL REFERENCES event_member_charges(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_payment_allocations_charge
  ON event_payment_allocations(event_member_charge_id);

CREATE INDEX IF NOT EXISTS idx_event_payment_allocations_transaction
  ON event_payment_allocations(transaction_id);

DROP TRIGGER IF EXISTS trg_event_member_charges_updated_at ON event_member_charges;
CREATE TRIGGER trg_event_member_charges_updated_at
BEFORE UPDATE ON event_member_charges
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
