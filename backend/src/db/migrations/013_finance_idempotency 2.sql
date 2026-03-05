ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS idempotency_scope TEXT;

UPDATE transactions
SET idempotency_scope = 'LEGACY_FINANCE_TRANSACTION_CREATE'
WHERE idempotency_scope IS NULL;

ALTER TABLE transactions
  ALTER COLUMN idempotency_scope SET DEFAULT 'LEGACY_FINANCE_TRANSACTION_CREATE';

ALTER TABLE transactions
  ALTER COLUMN idempotency_scope SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_team_idempotency
  ON transactions(team_id, idempotency_scope, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE event_member_charges
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

ALTER TABLE event_payment_allocations
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE INDEX IF NOT EXISTS idx_event_member_charges_idempotency_key
  ON event_member_charges(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_event_payment_allocations_idempotency_key
  ON event_payment_allocations(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
