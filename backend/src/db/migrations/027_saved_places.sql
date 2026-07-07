-- 027: сохранённые места (базы) для автокомплита места проведения события.
-- Хранит название, адрес и ссылку на Яндекс.Карты. Общие базы (team_id IS NULL)
-- видны всем командам; команды могут накапливать свою историю мест при создании событий.

CREATE TABLE IF NOT EXISTS saved_places (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE, -- NULL = общая база
  name TEXT NOT NULL,
  address TEXT,
  yandex_url TEXT,
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Уникальность имени в рамках команды (для ON CONFLICT при upsert истории).
CREATE UNIQUE INDEX IF NOT EXISTS saved_places_team_name_uniq
  ON saved_places (team_id, lower(name));

-- Уникальность имени среди общих баз (team_id IS NULL — в обычном индексе NULL различимы).
CREATE UNIQUE INDEX IF NOT EXISTS saved_places_shared_name_uniq
  ON saved_places (lower(name)) WHERE team_id IS NULL;

CREATE INDEX IF NOT EXISTS saved_places_team_idx ON saved_places (team_id);

-- Сид: базовые тренировочные площадки (общие, доступны всем командам).
INSERT INTO saved_places (team_id, name, address, yandex_url)
VALUES
  (NULL, 'ВТочку', 'Москва, Походный проезд, 23',
   'https://yandex.ru/maps/?text=%D0%9C%D0%BE%D1%81%D0%BA%D0%B2%D0%B0%2C%20%D0%9F%D0%BE%D1%85%D0%BE%D0%B4%D0%BD%D1%8B%D0%B9%20%D0%BF%D1%80%D0%BE%D0%B5%D0%B7%D0%B4%2C%2023'),
  (NULL, 'Маяк', 'Москва, ул. Красного Маяка, вл28',
   'https://yandex.ru/maps/213/moscow/house/ulitsa_krasnogo_mayaka_vl28/Z04YcwBiQUECQFtvfXpxdn9mZQ==/'),
  (NULL, 'АКМ', 'Московская обл., Богородский г.о., дер. Кашино, 33',
   'https://yandex.ru/maps/org/akm_country_club/196473699697/')
ON CONFLICT DO NOTHING;
