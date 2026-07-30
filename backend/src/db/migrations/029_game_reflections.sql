-- 029: рефлексия игрока и капитанский отчёт по гейму (#89).
--
-- Единица измерения — ГЕЙМ (`event_games`). В спеке он же называется «пойнт»:
-- «Пойнт N. Твоя рефлексия», «60–90 сек на гейм» — это одно и то же, отдельной
-- сущности «пойнт» в домене нет и заводить её не нужно.
--
-- Две формы на гейм, сознательно раздельные (решение 2026-07-12):
--   game_reflections      — по одной на игрока: выбили ли меня, где, кого выбил я
--   game_captain_reports  — одна на гейм: взгляд капитана сверху
-- Смысл раздельности — считать РАСХОЖДЕНИЕ между агрегатом игроков и капитаном.
-- Расхождение само по себе метрика: одинаково ли команда видит игру.
--
-- Фазы одинаковы для поражения и для килла (§1.1 симметрична §1.2):
--   BREAK    — на разбежке (off-the-break)
--   COVER    — за укрытием (дуэль и «в часть тела» НЕ разделяем, см. §2.4)
--   ROTATION — на перемещении между укрытиями
--
-- delta_otb (§2.1) НЕ хранится у игрока: он производный от форм всей команды —
--   delta_otb = (киллы всех наших с phase='BREAK') − (наши, выбитые с phase='BREAK')
-- Поэтому фаза килла обязательна: без неё половина формулы неизвестна.
-- В game_captain_reports delta_otb хранится — но там это НЕ факт, а мнение
-- капитана, которое сравнивается с расчётом. Две разные величины.
--
-- Спека: vault 02_PROJECTS/Paintball TeamHub/06_specs/
--        player_reflection_analytics_v1_2026_07_12_telegram.md (§1, §2, §3, §7.5)

-- Форма игрока. Одна на пару (гейм, игрок) — переоткрыл форму, перезаписал ответ.
CREATE TABLE IF NOT EXISTS game_reflections (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id            UUID NOT NULL REFERENCES event_games(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  eliminated         BOOLEAN NOT NULL,          -- выбили | дожил до конца
  death_phase        TEXT,                      -- BREAK | COVER | ROTATION, NULL если дожил
  death_position_id  TEXT REFERENCES field_positions(id),  -- где стоял, когда выбили
  note               TEXT,                      -- «что ещё было важного», в цифры не идёт
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT game_reflections_death_phase_check
    CHECK (death_phase IS NULL OR death_phase IN ('BREAK', 'COVER', 'ROTATION')),
  -- Дожил — значит фазы поражения нет. Выбили — фаза обязательна (укрытие может
  -- быть неизвестно: на разбежке игрок не всегда помнит, откуда прилетело).
  CONSTRAINT game_reflections_death_consistency_check
    CHECK (
      (eliminated = FALSE AND death_phase IS NULL AND death_position_id IS NULL)
      OR (eliminated = TRUE AND death_phase IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS game_reflections_game_user_uniq
  ON game_reflections (game_id, user_id);

CREATE INDEX IF NOT EXISTS game_reflections_game_idx ON game_reflections (game_id);

-- Киллы игрока в гейме. Отдельная таблица, а не счётчик: у каждого килла своя
-- фаза и своя позиция оппонента — из них считается дельта разбежки.
CREATE TABLE IF NOT EXISTS game_reflection_kills (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reflection_id  UUID NOT NULL REFERENCES game_reflections(id) ON DELETE CASCADE,
  ordinal        SMALLINT NOT NULL,         -- порядок строки в форме, 1..N
  phase          TEXT NOT NULL,             -- ОБЯЗАТЕЛЬНА: без неё не считается delta_otb
  position_id    TEXT REFERENCES field_positions(id),  -- где стоял оппонент, опционально
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT game_reflection_kills_phase_check
    CHECK (phase IN ('BREAK', 'COVER', 'ROTATION'))
);

CREATE UNIQUE INDEX IF NOT EXISTS game_reflection_kills_ordinal_uniq
  ON game_reflection_kills (reflection_id, ordinal);

CREATE INDEX IF NOT EXISTS game_reflection_kills_reflection_idx
  ON game_reflection_kills (reflection_id);

-- Капитанский отчёт: верхнеуровневый взгляд на гейм. Одна строка на гейм.
CREATE TABLE IF NOT EXISTS game_captain_reports (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id               UUID NOT NULL REFERENCES event_games(id) ON DELETE CASCADE,
  author_user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  combination           TEXT,       -- какую комбинацию разыгрывали (§3.2)
  break_width           TEXT,       -- разбежка узкая | широкая (§3.3)
  opponent_break_width  TEXT,       -- как разбежался соперник (§3.3, «мы узко / они широко»)
  -- Инициатива по трём линиям (§2.2): кто первым занял ключевое укрытие.
  -- +1 наша, 0 поровну, −1 соперника. Хранится величина по каждой линии отдельно —
  -- «выиграли змею, слили конверты» это не то же самое, что «инициатива 0».
  initiative_snake      SMALLINT,
  initiative_center     SMALLINT,
  initiative_envelope   SMALLINT,
  delta_otb             SMALLINT,   -- МНЕНИЕ капитана о дельте, сверяется с расчётом
  result                TEXT,       -- WIN | LOSS — результат пойнта (§3.1)
  note                  TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT game_captain_reports_combination_check
    CHECK (combination IS NULL OR combination IN
      ('ENVELOPE_ATTACK', 'SNAKE_ATTACK', 'ACTIVE_SNAKE', 'ACTIVE_ENVELOPE')),
  CONSTRAINT game_captain_reports_break_width_check
    CHECK (break_width IS NULL OR break_width IN ('NARROW', 'WIDE')),
  CONSTRAINT game_captain_reports_opponent_break_width_check
    CHECK (opponent_break_width IS NULL OR opponent_break_width IN ('NARROW', 'WIDE')),
  CONSTRAINT game_captain_reports_initiative_check
    CHECK (
      (initiative_snake    IS NULL OR initiative_snake    BETWEEN -1 AND 1) AND
      (initiative_center   IS NULL OR initiative_center   BETWEEN -1 AND 1) AND
      (initiative_envelope IS NULL OR initiative_envelope BETWEEN -1 AND 1)
    ),
  CONSTRAINT game_captain_reports_result_check
    CHECK (result IS NULL OR result IN ('WIN', 'LOSS'))
);

CREATE UNIQUE INDEX IF NOT EXISTS game_captain_reports_game_uniq
  ON game_captain_reports (game_id);
