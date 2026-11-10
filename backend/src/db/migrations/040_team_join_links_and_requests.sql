-- Трек 1 ревизии PBTH «Вход и заявки» (11.11.2026). Только добавления:
-- старые таблицы и столбцы не меняются, старый фронтенд их не замечает.
--
-- 1. Постоянная ссылка команды `/join/<код>`. У команды одна живая ссылка;
--    «Отозвать и выпустить новую» помечает старую отозванной и создаёт новую,
--    история остаётся.
-- 2. Заявка на вступление: человек открыл ссылку и вошёл — капитан или тренер
--    принимает либо отклоняет. Принятая заявка создаёт членство игрока.
-- 3. Заявка на создание команды: человек без команды просит команду,
--    владелец платформы одобряет.
-- 4. Карточки заявок в боте: какие сообщения кому ушли, чтобы после решения
--    (в боте или в приложении) у всех одобряющих карточка закрылась.
-- 5. Приглашение капитана: именное (`note`) и одноразовое (`single_use`).

CREATE TABLE IF NOT EXISTS team_join_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Код ищется без учёта регистра и не повторяется никогда, даже у отозванных:
-- старая ссылка не должна однажды открыть чужую команду.
CREATE UNIQUE INDEX IF NOT EXISTS team_join_links_code_uniq ON team_join_links (upper(code));
-- Одна живая ссылка на команду.
CREATE UNIQUE INDEX IF NOT EXISTS team_join_links_active_team_uniq ON team_join_links (team_id) WHERE revoked_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'join_request_status') THEN
    CREATE TYPE join_request_status AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'CANCELLED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS team_join_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  link_id UUID REFERENCES team_join_links(id) ON DELETE SET NULL,
  status join_request_status NOT NULL DEFAULT 'PENDING',
  decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  membership_id UUID REFERENCES team_memberships(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Одна ждущая заявка человека в команду: повторное открытие ссылки не плодит
-- карточки у капитана.
CREATE UNIQUE INDEX IF NOT EXISTS team_join_requests_pending_uniq
  ON team_join_requests (team_id, user_id) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_team_join_requests_team_status ON team_join_requests (team_id, status);
CREATE INDEX IF NOT EXISTS idx_team_join_requests_user ON team_join_requests (user_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_team_join_requests_updated_at ON team_join_requests;
CREATE TRIGGER trg_team_join_requests_updated_at BEFORE UPDATE ON team_join_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS team_creation_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_name TEXT NOT NULL,
  status join_request_status NOT NULL DEFAULT 'PENDING',
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS team_creation_requests_pending_uniq
  ON team_creation_requests (user_id) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_team_creation_requests_status ON team_creation_requests (status, created_at);

DROP TRIGGER IF EXISTS trg_team_creation_requests_updated_at ON team_creation_requests;
CREATE TRIGGER trg_team_creation_requests_updated_at BEFORE UPDATE ON team_creation_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Карточки заявок в чатах бота. kind: 'join' — заявка на вступление,
-- 'team' — заявка на создание команды. request_id без внешнего ключа: он
-- указывает в одну из двух таблиц.
CREATE TABLE IF NOT EXISTS request_bot_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('join', 'team')),
  request_id UUID NOT NULL,
  chat_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_request_bot_messages_request ON request_bot_messages (kind, request_id);

ALTER TABLE team_invites ADD COLUMN IF NOT EXISTS single_use BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE team_invites ADD COLUMN IF NOT EXISTS note TEXT;
