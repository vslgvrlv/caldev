-- 060: сообщения игрокам о новом, перенесённом и отменённом событии
-- (спека event_announcements, решения Василия 11.11.2026).
--
-- Только добавление: одна новая таблица и её индексы. Существующие таблицы и
-- данные не трогаются. Откат кода эту схему не задевает — старый код о ней не
-- знает; откат схемы — DROP TABLE event_announcements.
--
-- Строка — отложенное сообщение: ручки событий пишут её после COMMIT, таймер
-- в процессе API (`modules/announcements/send.ts`) отправляет, когда подошёл
-- `due_at`. Каждая строка уходит не больше одного раза: таймер берёт её
-- атомарно (PENDING → SENDING) и повтора после сбоя нет.

CREATE TABLE IF NOT EXISTS event_announcements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  -- Событие; для серии — первое затронутое занятие.
  event_id      UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  series_id     UUID REFERENCES event_series(id) ON DELETE CASCADE,
  scope         TEXT NOT NULL CHECK (scope IN ('EVENT', 'SERIES')),
  kind          TEXT NOT NULL CHECK (kind IN ('CREATED', 'RESCHEDULED', 'CANCELLED')),
  -- Кто сделал действие: ему сообщение не уходит.
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Перенос: прежние startAt и location. Отмена: title, startAt, location на
  -- момент отмены. Серия: число занятий, дни недели, дата окончания.
  -- silent — слать без звука.
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  due_at        TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'SKIPPED', 'FAILED')),
  skip_reason   TEXT,
  -- Номер рассылки в notification_deliveries («Кому дошло»).
  batch_id      UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at       TIMESTAMPTZ,
  CHECK ((scope = 'SERIES') = (series_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_event_announcements_status_due ON event_announcements(status, due_at);
CREATE INDEX IF NOT EXISTS idx_event_announcements_event ON event_announcements(event_id);
CREATE INDEX IF NOT EXISTS idx_event_announcements_batch ON event_announcements(batch_id) WHERE batch_id IS NOT NULL;

-- Не больше одной ожидающей строки на (событие, вид) и на (серию, вид).
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_announcements_pending_event
  ON event_announcements(event_id, kind) WHERE status = 'PENDING' AND scope = 'EVENT';
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_announcements_pending_series
  ON event_announcements(series_id, kind) WHERE status = 'PENDING' AND scope = 'SERIES';
