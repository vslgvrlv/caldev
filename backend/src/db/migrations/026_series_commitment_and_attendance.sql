-- 026: согласие на серию (#60) + фактическая явка (#62)
-- Модель: согласие на серию = дефолт "иду" по всем occurrences; ответ на конкретное
-- занятие (rsvps) — оверрайд. Фактическая явка — отдельный слой от намерения (RSVP).

CREATE TABLE IF NOT EXISTS event_series_commitment (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id   UUID NOT NULL REFERENCES event_series(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'COMMITTED' CHECK (status IN ('COMMITTED', 'LEFT')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (series_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_series_commitment_user ON event_series_commitment(user_id);

CREATE TABLE IF NOT EXISTS event_attendance (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  present     BOOLEAN NOT NULL,
  marked_by   UUID REFERENCES users(id),
  marked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_event_attendance_event ON event_attendance(event_id);
