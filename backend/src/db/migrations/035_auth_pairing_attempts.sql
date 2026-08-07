-- Вход по коду сопряжения (#109).
--
-- Прежние схемы входа заканчивались редиректом «уйти и вернуться», а PWA на
-- домашнем экране iOS — отдельный браузер со своей банкой кук: Set-Cookie
-- уходил не туда, и приложение могло залогиниться только случайно. Здесь
-- браузер показывает код, человек подтверждает вход внутри Telegram, а сессия
-- выдаётся на опрос, который сделал сам браузер.

CREATE TABLE IF NOT EXISTS auth_pairing_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Хранится только хэш: код живёт на экране пользователя, в базе он не нужен.
  code_hash TEXT NOT NULL UNIQUE,

  -- Секрет из httpOnly-куки pbth.pair. Забрать сессию может только тот браузер,
  -- который попытку начал, поэтому украденный или подсмотренный код бесполезен.
  browser_secret_hash TEXT NOT NULL,

  scope TEXT NOT NULL CHECK (scope IN ('USER', 'ADMIN')),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'CLAIMED', 'APPROVED', 'CONSUMED', 'DENIED', 'EXPIRED')),
  redirect_to TEXT NOT NULL,

  -- Показываются человеку в карточке подтверждения, чтобы «это не я» был
  -- осознанным выбором. Живут ровно столько же, сколько попытка.
  device_label TEXT,
  requested_ip TEXT,

  telegram_user_id TEXT,
  telegram_chat_id TEXT,
  telegram_profile JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- id карточки в чате: подтверждение редактирует её на месте, а не плодит
  -- новые сообщения. Просроченная карточка гасится тем же способом.
  confirmation_message_id TEXT,

  approved_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_pairing_attempts_expires_at
  ON auth_pairing_attempts (expires_at);

-- Лимит «сколько кодов человек попросил за последние N минут» считается по
-- этому индексу, поэтому он по паре (secret, время), а не по одному полю.
CREATE INDEX IF NOT EXISTS idx_auth_pairing_attempts_secret_created
  ON auth_pairing_attempts (browser_secret_hash, created_at DESC);
