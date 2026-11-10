-- 045: авто-напоминания о явке и настройки уведомлений (трек 2 ревизии, 11.11.2026).
-- Только добавление: новые таблицы и одна необязательная колонка. Откат кода
-- эту схему не задевает — старый код о ней не знает.

-- Журнал авто-напоминаний. Строка — «этому человеку это напоминание о
-- событии уже ушло (или ушло с ошибкой)». Уникальный ключ не даёт послать
-- одно и то же дважды: ни при повторной проверке, ни после перезапуска
-- сервера, ни при двух процессах сразу (строка вставляется до отправки).
-- slot_key — слот и дата события по поясу команды: перенос события на другой
-- день даёт новые напоминания, перенос в тот же день — нет.
CREATE TABLE IF NOT EXISTS event_auto_reminders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id      UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot         TEXT NOT NULL CHECK (slot IN ('EVE', 'MORNING')),
  slot_key     TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'CLAIMED' CHECK (status IN ('CLAIMED', 'SENT', 'QUEUED', 'FAILED', 'NO_CHANNEL')),
  channel      TEXT,
  error_code   TEXT,
  error_detail TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id, slot_key)
);

CREATE INDEX IF NOT EXISTS idx_event_auto_reminders_event ON event_auto_reminders(event_id);

-- Настройки уведомлений человека. Нет строки — всё включено: авто-напоминания
-- получают все, отключает сам человек (решение Василия 10.11.2026, п. 8).
CREATE TABLE IF NOT EXISTS user_notification_settings (
  user_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  auto_event_reminders BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Рассылка «Напомнить» целиком: по ней экран «кому дошло» показывает последнюю.
ALTER TABLE notification_deliveries ADD COLUMN IF NOT EXISTS batch_id UUID;
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_event_created
  ON notification_deliveries(event_id, created_at DESC);
