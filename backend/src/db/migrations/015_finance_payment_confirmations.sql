DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'finance_payment_confirmation_status') THEN
    CREATE TYPE finance_payment_confirmation_status AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS finance_payment_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  submitted_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  screenshot_data_url TEXT NOT NULL,
  note TEXT,
  review_note TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  status finance_payment_confirmation_status NOT NULL DEFAULT 'PENDING_REVIEW',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_finance_payment_confirmations_team_status_created
  ON finance_payment_confirmations(team_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_finance_payment_confirmations_user_created
  ON finance_payment_confirmations(user_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_finance_payment_confirmations_updated_at ON finance_payment_confirmations;
CREATE TRIGGER trg_finance_payment_confirmations_updated_at
BEFORE UPDATE ON finance_payment_confirmations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
