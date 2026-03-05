DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'event_finance_state') THEN
    CREATE TYPE event_finance_state AS ENUM ('NOT_CALCULATED', 'COLLECTING', 'CLOSED');
  END IF;
END $$;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS finance_state event_finance_state;

UPDATE events e
SET finance_state = CASE
  WHEN s.charged_total <= 0 THEN 'NOT_CALCULATED'::event_finance_state
  WHEN s.outstanding_total > 0 THEN 'COLLECTING'::event_finance_state
  ELSE 'CLOSED'::event_finance_state
END
FROM (
  WITH charge_paid AS (
    SELECT c.event_id,
           c.amount_due,
           COALESCE(SUM(a.amount), 0)::numeric AS amount_paid
    FROM event_member_charges c
    LEFT JOIN event_payment_allocations a ON a.event_member_charge_id = c.id
    GROUP BY c.id, c.event_id, c.amount_due
  )
  SELECT cp.event_id,
         COALESCE(SUM(cp.amount_due), 0)::numeric AS charged_total,
         COALESCE(SUM(GREATEST(cp.amount_due - cp.amount_paid, 0)), 0)::numeric AS outstanding_total
  FROM charge_paid cp
  GROUP BY cp.event_id
) s
WHERE e.id = s.event_id
  AND e.finance_state IS NULL;

UPDATE events
SET finance_state = 'NOT_CALCULATED'::event_finance_state
WHERE finance_state IS NULL;

ALTER TABLE events
  ALTER COLUMN finance_state SET DEFAULT 'NOT_CALCULATED'::event_finance_state,
  ALTER COLUMN finance_state SET NOT NULL;

ALTER TABLE event_series
  ADD COLUMN IF NOT EXISTS finance_state event_finance_state;

UPDATE event_series
SET finance_state = 'NOT_CALCULATED'::event_finance_state
WHERE finance_state IS NULL;

ALTER TABLE event_series
  ALTER COLUMN finance_state SET DEFAULT 'NOT_CALCULATED'::event_finance_state,
  ALTER COLUMN finance_state SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_finance_state
  ON events(team_id, finance_state, start_at DESC);
