-- Код команды в адресе (/t/<код>, /init?team=<код>) ищется без учёта регистра.
-- Уникальность нужна тоже без учёта регистра, иначе «HG» и «hg» — две команды
-- под одним адресом.
--
-- Если в базе уже есть коды, различающиеся только регистром, индекс не
-- создаётся и данные не трогаются: миграция пишет предупреждение, а поиск
-- берёт самую старую команду. Разбирает такие пары человек.

DO $$
DECLARE
  duplicates INTEGER;
BEGIN
  SELECT COUNT(*) INTO duplicates
  FROM (
    SELECT lower(short_code)
    FROM teams
    GROUP BY lower(short_code)
    HAVING COUNT(*) > 1
  ) d;

  IF duplicates = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS teams_short_code_lower_uniq ON teams (lower(short_code));
  ELSE
    RAISE WARNING 'teams.short_code: % case-insensitive duplicate group(s); unique index on lower(short_code) skipped', duplicates;
    CREATE INDEX IF NOT EXISTS teams_short_code_lower_idx ON teams (lower(short_code));
  END IF;
END $$;
