-- 028: справочник позиций (укрытий/фигур) на пейнтбольном поле.
-- Питает модуль рефлексии игрока (#89): где игрока выбили, откуда он отстрелил.
--
-- Модель — один плоский каталог в МАКСИМАЛЬНОЙ конфигурации: он содержит все
-- фигуры, которые вообще могут стоять на поле. Поле конкретной конфигурации —
-- это подмножество каталога (флаг active). Отдельной сущности «раскладка поля»
-- сознательно НЕТ: конфигураций мало, они не живут одновременно.
--
-- Три независимые группы фигур. Числа, змеи и конверты НЕ пересекаются:
-- «4-й конверт» — это 4-й конверт, а не «50». Группа входит в идентификатор,
-- поэтому совпадение номеров безопасно: grid.50 и envelope.4 не столкнутся.
--
--   grid      1..5 / 10..50 / 100..500 / 1000..5000   20 фигур
--   snake     1..4 (4 змеи — заложен максимум)          4 фигуры
--   envelope  1..4 (бывают поля с 4 конвертами)         4 фигуры
--                                              итого = 28 фигур
--
-- Каждая фигура существует на обеих половинах поля: Б (NEAR, наша) и Д (FAR,
-- сторона противника). 28 x 2 = 56 позиций. Центральных фигур нет, поэтому
-- side обязателен. NEAR/FAR — та же номенклатура, что в event_games.pit_zone.
--
-- Спека: vault 02_PROJECTS/Paintball TeamHub/06_specs/
--        player_reflection_analytics_v1_2026_07_12_telegram.md (§7)

CREATE TABLE IF NOT EXISTS field_positions (
  id           TEXT PRIMARY KEY,           -- grid.3000.near | snake.2.far | envelope.4.near
  figure_group TEXT NOT NULL,              -- grid | snake | envelope (расширяемо)
  figure_index TEXT NOT NULL,              -- 3000 | 2 | 4
  side         TEXT NOT NULL,              -- NEAR (наша) | FAR (противника)
  flank        TEXT,                       -- SNAKE | CENTER | ENVELOPE; NULL пока не размечено
  depth        SMALLINT,                   -- линия глубины: разряд числа (1|10|100|1000)
  label        TEXT NOT NULL,              -- «3000 Б», «4-й конверт Д»
  aliases      TEXT[] NOT NULL DEFAULT '{}', -- разговорные формы для type-ahead
  active       BOOLEAN NOT NULL DEFAULT TRUE, -- стоит ли фигура на текущем поле
  sort_order   INTEGER NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT field_positions_group_check CHECK (figure_group IN ('grid', 'snake', 'envelope')),
  CONSTRAINT field_positions_side_check  CHECK (side IN ('NEAR', 'FAR')),
  CONSTRAINT field_positions_flank_check CHECK (flank IS NULL OR flank IN ('SNAKE', 'CENTER', 'ENVELOPE'))
);

CREATE UNIQUE INDEX IF NOT EXISTS field_positions_figure_side_uniq
  ON field_positions (figure_group, figure_index, side);

CREATE INDEX IF NOT EXISTS field_positions_active_idx ON field_positions (active) WHERE active;

-- Сид каталога. Фигуры перечислены один раз, стороны разворачиваются CROSS JOIN.
-- Алиасы — только реально звучавшие в разборах, без выдумок.
INSERT INTO field_positions (id, figure_group, figure_index, side, flank, depth, label, aliases, sort_order)
SELECT
  f.grp || '.' || f.idx || '.' || lower(s.side),
  f.grp,
  f.idx,
  s.side,
  f.flank,
  f.depth,
  f.label || ' ' || s.suffix,
  f.aliases,
  f.ord * 10 + s.ord
FROM (VALUES
  -- числовая сетка: разряд = линия глубины
  ('grid', '1',    NULL::TEXT,   1::SMALLINT, '1',    '{}'::TEXT[],                      1),
  ('grid', '2',    NULL,         1,           '2',    '{}'::TEXT[],                      2),
  ('grid', '3',    NULL,         1,           '3',    ARRAY['трёшка', 'трешка'],         3),
  ('grid', '4',    NULL,         1,           '4',    '{}'::TEXT[],                      4),
  ('grid', '5',    NULL,         1,           '5',    '{}'::TEXT[],                      5),
  ('grid', '10',   NULL,         10,          '10',   '{}'::TEXT[],                      6),
  ('grid', '20',   NULL,         10,          '20',   '{}'::TEXT[],                      7),
  ('grid', '30',   NULL,         10,          '30',   ARRAY['тридцатка'],                8),
  ('grid', '40',   NULL,         10,          '40',   '{}'::TEXT[],                      9),
  ('grid', '50',   NULL,         10,          '50',   ARRAY['полтенник', 'полтинник'],  10),
  ('grid', '100',  NULL,         100,         '100',  '{}'::TEXT[],                     11),
  ('grid', '200',  NULL,         100,         '200',  '{}'::TEXT[],                     12),
  ('grid', '300',  NULL,         100,         '300',  '{}'::TEXT[],                     13),
  ('grid', '400',  NULL,         100,         '400',  '{}'::TEXT[],                     14),
  ('grid', '500',  NULL,         100,         '500',  '{}'::TEXT[],                     15),
  ('grid', '1000', NULL,         1000,        '1000', '{}'::TEXT[],                     16),
  ('grid', '2000', NULL,         1000,        '2000', '{}'::TEXT[],                     17),
  ('grid', '3000', NULL,         1000,        '3000', ARRAY['три тысячи'],              18),
  ('grid', '4000', NULL,         1000,        '4000', '{}'::TEXT[],                     19),
  ('grid', '5000', NULL,         1000,        '5000', '{}'::TEXT[],                     20),
  -- змеи: фланг известен из группы
  ('snake', '1', 'SNAKE', NULL, '1-я змея', ARRAY['первая змея'],   21),
  ('snake', '2', 'SNAKE', NULL, '2-я змея', ARRAY['вторая змея'],   22),
  ('snake', '3', 'SNAKE', NULL, '3-я змея', ARRAY['третья змея'],   23),
  ('snake', '4', 'SNAKE', NULL, '4-я змея', ARRAY['четвёртая змея'], 24),
  -- конверты
  ('envelope', '1', 'ENVELOPE', NULL, '1-й конверт', ARRAY['первый конверт'],    25),
  ('envelope', '2', 'ENVELOPE', NULL, '2-й конверт', ARRAY['второй конверт'],    26),
  ('envelope', '3', 'ENVELOPE', NULL, '3-й конверт', ARRAY['третий конверт'],    27),
  ('envelope', '4', 'ENVELOPE', NULL, '4-й конверт', ARRAY['четвёртый конверт'], 28)
) AS f(grp, idx, flank, depth, label, aliases, ord)
CROSS JOIN (VALUES
  ('NEAR', 'Б', 1),
  ('FAR',  'Д', 2)
) AS s(side, suffix, ord)
ON CONFLICT DO NOTHING;
