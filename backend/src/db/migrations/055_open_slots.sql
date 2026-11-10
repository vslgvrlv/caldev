-- Открытые слоты (трек 4 ревизии PBTH, решения Василия 10.11.2026, п. 23–28).
--
-- Капитан включает у команды открытое расписание; человек подписывается на
-- команду сам, без одобрения; капитан или тренер открывает в событии N мест с
-- ценой; подписчик записывается — кто первый. Миграция только добавляет
-- таблицы: существующие не трогает, данные не переносит. Откат — DROP новых
-- таблиц (в обратном порядке), старый код о них не знает.

-- Открытое расписание команды. Строки нет — выключено (по умолчанию).
CREATE TABLE IF NOT EXISTS team_open_schedules (
  team_id     UUID PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Подписчики команды. Подписка не даёт доступа ни к составу, ни к деньгам,
-- ни к расписанию — только к событиям, где открыты слоты.
CREATE TABLE IF NOT EXISTS team_followers (
  team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_team_followers_user ON team_followers(user_id);

-- Слоты события: одна строка на событие.
--   capacity   — сколько гостей всего можно записать;
--   round      — номер открытия: закрыл и открыл снова — новое открытие и
--                новое уведомление подписчикам;
--   free_seq   — сколько раз за открытие место освобождалось после «мест нет»:
--                ключ уведомления «место освободилось».
CREATE TABLE IF NOT EXISTS event_slots (
  event_id    UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  capacity    INTEGER NOT NULL CHECK (capacity >= 1 AND capacity <= 50),
  price       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  status      TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  round       INTEGER NOT NULL DEFAULT 1,
  free_seq    INTEGER NOT NULL DEFAULT 0,
  opened_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  opened_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_slots_team_status ON event_slots(team_id, status);

-- Гости события. Одна строка на человека: снялся и записался снова — та же
-- строка. BOOKED — занимает место; LEFT — снялся сам; REMOVED — снял капитан.
-- Гости в общий список должников не попадают: оплата — галочка `paid`.
CREATE TABLE IF NOT EXISTS event_slot_guests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID NOT NULL REFERENCES event_slots(event_id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'BOOKED' CHECK (status IN ('BOOKED', 'LEFT', 'REMOVED')),
  price         NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid          BOOLEAN NOT NULL DEFAULT FALSE,
  paid_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  paid_at       TIMESTAMPTZ,
  booked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at  TIMESTAMPTZ,
  cancelled_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_event_slot_guests_user ON event_slot_guests(user_id, status);

-- Журнал уведомлений о слотах. Первичный ключ — защита от дублей: строка
-- вставляется до отправки, и второй раз то же уведомление тому же человеку
-- не уходит, даже если два запроса разошлют его одновременно.
--   kind = OPEN   — открыты слоты (ключ — номер открытия);
--          FREED  — место освободилось (ключ — открытие и free_seq);
--          BOOKED — капитану и тренеру: гость занял слот (ключ — запись гостя).
CREATE TABLE IF NOT EXISTS slot_notifications (
  event_id         UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (kind IN ('OPEN', 'FREED', 'BOOKED')),
  dedupe_key       TEXT NOT NULL,
  telegram_status  TEXT,
  push_status      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id, kind, dedupe_key)
);
