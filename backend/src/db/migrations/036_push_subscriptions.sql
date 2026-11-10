-- Web Push подписки (#36). Транспорт напоминаний переезжает с Telegram bot на
-- Web Push (VAPID): хостинг режет исходящий трафик на Telegram, спасает только
-- relay. Эта таблица хранит подписки браузеров; endpoint уникален per-browser,
-- поэтому повторная подписка того же устройства обновляет ключи, а не плодит строки.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
