-- 021: per-recipient notification delivery ledger (#46)
-- Делает "напомнить" честным: фиксируем по каждому получателю, доставлено / в очереди / провал.
-- Раньше существовали только агрегаты в audit_logs — нельзя было показать, КОМУ не дошло.

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  event_id      UUID REFERENCES events(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,                       -- EVENT_REMINDER | DEBT_REMINDER
  channel       TEXT NOT NULL DEFAULT 'TELEGRAM',    -- TELEGRAM | WEBPUSH (после миграции на web push)
  status        TEXT NOT NULL CHECK (status IN ('SENT', 'QUEUED', 'FAILED')),
  error_code    TEXT,
  error_detail  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_event ON notification_deliveries(event_id);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_team_created ON notification_deliveries(team_id, created_at DESC);
