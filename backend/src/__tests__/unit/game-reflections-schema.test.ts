import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
process.env.TELEGRAM_CALLBACK_URL =
  process.env.TELEGRAM_CALLBACK_URL || "http://127.0.0.1:8000/api/v1/auth/telegram/callback";

let pool: typeof import("../../db/pool.js").pool;

const fixture = { teamId: "", userId: "", eventId: "", gameId: "", pointId: "" };

beforeAll(async () => {
  ({ pool } = await import("../../db/pool.js"));

  const telegramId = Date.now() % 1_000_000_000;
  const team = await pool.query<{ id: string }>(
    `INSERT INTO teams (name, short_code) VALUES ('Reflections Test', $1) RETURNING id`,
    [`RT${telegramId}`]
  );
  fixture.teamId = team.rows[0].id;

  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (telegram_id, name, nickname) VALUES ($1, 'Reflection Tester', 'tester') RETURNING id`,
    [telegramId]
  );
  fixture.userId = user.rows[0].id;

  const event = await pool.query<{ id: string }>(
    `INSERT INTO events (team_id, type, title, start_at, occurrence_date)
     VALUES ($1, 'TOURNAMENT', 'Reflections Test', NOW(), CURRENT_DATE) RETURNING id`,
    [fixture.teamId]
  );
  fixture.eventId = event.rows[0].id;

  const game = await pool.query<{ id: string }>(
    `INSERT INTO event_games (event_id, time_label, opponent, score) VALUES ($1, '10:00', 'Opponent', '4:3') RETURNING id`,
    [fixture.eventId]
  );
  fixture.gameId = game.rows[0].id;

  const point = await pool.query<{ id: string }>(
    `INSERT INTO game_points (game_id, ordinal, result) VALUES ($1, 1, 'WIN') RETURNING id`,
    [fixture.gameId]
  );
  fixture.pointId = point.rows[0].id;
});

afterAll(async () => {
  await pool.query(`DELETE FROM teams WHERE id = $1`, [fixture.teamId]);
  await pool.query(`DELETE FROM users WHERE id = $1`, [fixture.userId]);
});

// Пойнт — единица рефлексии, а не гейм: в гейме 4:3 семь разных эпизодов,
// и схема обязана удерживать это различие, иначе формы схлопнутся в одну.
describe("game_points schema", () => {
  it("порядковый номер в гейме уникален", async () => {
    await expect(
      pool.query(`INSERT INTO game_points (game_id, ordinal) VALUES ($1, 1)`, [fixture.gameId])
    ).rejects.toThrow(/game_points_game_ordinal_uniq/);
  });

  // Из счёта известно только количество побед, но не их порядок — его
  // размечает капитан руками, поэтому «ещё не размечен» обязано быть валидным.
  it("результат может быть не проставлен, но только WIN или LOSS", async () => {
    const empty = await pool.query<{ id: string; result: string | null }>(
      `INSERT INTO game_points (game_id, ordinal) VALUES ($1, 2) RETURNING id, result`,
      [fixture.gameId]
    );
    expect(empty.rows[0].result).toBeNull();

    await expect(
      pool.query(`INSERT INTO game_points (game_id, ordinal, result) VALUES ($1, 3, 'DRAW')`, [fixture.gameId])
    ).rejects.toThrow(/game_points_result_check/);

    await pool.query(`DELETE FROM game_points WHERE id = $1`, [empty.rows[0].id]);
  });

  it("гейм удалён — пойнты уходят вместе с ним", async () => {
    const game = await pool.query<{ id: string }>(
      `INSERT INTO event_games (event_id, time_label, opponent) VALUES ($1, '11:00', 'Temp') RETURNING id`,
      [fixture.eventId]
    );
    await pool.query(`INSERT INTO game_points (game_id, ordinal) VALUES ($1, 1)`, [game.rows[0].id]);
    await pool.query(`DELETE FROM event_games WHERE id = $1`, [game.rows[0].id]);

    const left = await pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM game_points WHERE game_id = $1`,
      [game.rows[0].id]
    );
    expect(Number(left.rows[0].count)).toBe(0);
  });
});

// Схема — единственное место, где домен защищён от мусора: форму можно переписать,
// а «выбили, но фазы нет» ломает delta_otb молча и навсегда.
describe("game_reflections schema", () => {
  it("дожил до конца — фазы и позиции поражения быть не должно", async () => {
    await expect(
      pool.query(
        `INSERT INTO game_reflections (point_id, user_id, eliminated, death_phase)
         VALUES ($1, $2, FALSE, 'BREAK')`,
        [fixture.pointId, fixture.userId]
      )
    ).rejects.toThrow(/game_reflections_death_consistency_check/);
  });

  it("выбили — фаза обязательна, без неё дельта не считается", async () => {
    await expect(
      pool.query(
        `INSERT INTO game_reflections (point_id, user_id, eliminated, death_phase)
         VALUES ($1, $2, TRUE, NULL)`,
        [fixture.pointId, fixture.userId]
      )
    ).rejects.toThrow(/game_reflections_death_consistency_check/);
  });

  // Ноль как «не оценил» сломал бы средние: 0 — не оценка, а отсутствие ответа,
  // поэтому пропуск экрана хранится как NULL и в шкалу не попадает.
  it("самооценка — только 1–5, ноль и шестёрка не проходят", async () => {
    for (const rating of [0, 6]) {
      await expect(
        pool.query(
          `INSERT INTO game_reflections (point_id, user_id, eliminated, self_rating)
           VALUES ($1, $2, FALSE, $3)`,
          [fixture.pointId, fixture.userId, rating]
        )
      ).rejects.toThrow(/game_reflections_self_rating_check/);
    }
  });

  it("самооценку можно не ставить — экран пропускаемый", async () => {
    const saved = await pool.query<{ id: string; self_rating: number | null }>(
      `INSERT INTO game_reflections (point_id, user_id, eliminated) VALUES ($1, $2, FALSE)
       RETURNING id, self_rating`,
      [fixture.pointId, fixture.userId]
    );
    expect(saved.rows[0].self_rating).toBeNull();
    await pool.query(`DELETE FROM game_reflections WHERE id = $1`, [saved.rows[0].id]);
  });

  // Укрытие может быть неизвестно: на разбежке игрок не всегда видит, откуда прилетело.
  it("выбили без укрытия — валидный ответ", async () => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO game_reflections (point_id, user_id, eliminated, death_phase)
       VALUES ($1, $2, TRUE, 'BREAK') RETURNING id`,
      [fixture.pointId, fixture.userId]
    );
    expect(r.rows[0].id).toBeTruthy();
    await pool.query(`DELETE FROM game_reflections WHERE id = $1`, [r.rows[0].id]);
  });

  it("одна форма на пару (пойнт, игрок) — повторная запись конфликтует", async () => {
    await pool.query(`INSERT INTO game_reflections (point_id, user_id, eliminated) VALUES ($1, $2, FALSE)`, [
      fixture.pointId,
      fixture.userId,
    ]);
    await expect(
      pool.query(`INSERT INTO game_reflections (point_id, user_id, eliminated) VALUES ($1, $2, FALSE)`, [
        fixture.pointId,
        fixture.userId,
      ])
    ).rejects.toThrow(/game_reflections_point_user_uniq/);
    await pool.query(`DELETE FROM game_reflections WHERE point_id = $1`, [fixture.pointId]);
  });

  // Тот же игрок в том же гейме заполняет форму за каждый пойнт отдельно —
  // ограничение уникальности не должно этому мешать.
  it("в одном гейме игрок заполняет форму за каждый пойнт", async () => {
    const second = await pool.query<{ id: string }>(
      `INSERT INTO game_points (game_id, ordinal, result) VALUES ($1, 2, 'LOSS') RETURNING id`,
      [fixture.gameId]
    );
    await pool.query(`INSERT INTO game_reflections (point_id, user_id, eliminated) VALUES ($1, $2, FALSE)`, [
      fixture.pointId,
      fixture.userId,
    ]);
    await pool.query(
      `INSERT INTO game_reflections (point_id, user_id, eliminated, death_phase) VALUES ($1, $2, TRUE, 'COVER')`,
      [second.rows[0].id, fixture.userId]
    );

    const total = await pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM game_reflections r
       JOIN game_points p ON p.id = r.point_id
       WHERE p.game_id = $1 AND r.user_id = $2`,
      [fixture.gameId, fixture.userId]
    );
    expect(Number(total.rows[0].count)).toBe(2);

    await pool.query(`DELETE FROM game_points WHERE id = $1`, [second.rows[0].id]);
    await pool.query(`DELETE FROM game_reflections WHERE point_id = $1`, [fixture.pointId]);
  });

  it("позиция ссылается на каталог фигур, произвольный id не проходит", async () => {
    await expect(
      pool.query(
        `INSERT INTO game_reflections (point_id, user_id, eliminated, death_phase, death_position_id)
         VALUES ($1, $2, TRUE, 'COVER', 'grid.9999.near')`,
        [fixture.pointId, fixture.userId]
      )
    ).rejects.toThrow(/death_position_id_fkey/);

    const ok = await pool.query<{ id: string }>(
      `INSERT INTO game_reflections (point_id, user_id, eliminated, death_phase, death_position_id)
       VALUES ($1, $2, TRUE, 'COVER', 'grid.3000.center') RETURNING id`,
      [fixture.pointId, fixture.userId]
    );
    expect(ok.rows[0].id).toBeTruthy();
    await pool.query(`DELETE FROM game_reflections WHERE id = $1`, [ok.rows[0].id]);
  });

  it("фаза килла обязательна на уровне схемы", async () => {
    const reflection = await pool.query<{ id: string }>(
      `INSERT INTO game_reflections (point_id, user_id, eliminated) VALUES ($1, $2, FALSE) RETURNING id`,
      [fixture.pointId, fixture.userId]
    );
    const reflectionId = reflection.rows[0].id;

    await expect(
      pool.query(`INSERT INTO game_reflection_kills (reflection_id, ordinal, phase) VALUES ($1, 1, NULL)`, [
        reflectionId,
      ])
    ).rejects.toThrow(/null value in column "phase"/);

    await pool.query(
      `INSERT INTO game_reflection_kills (reflection_id, ordinal, phase, position_id)
       VALUES ($1, 1, 'BREAK', 'snake.2.far')`,
      [reflectionId]
    );

    // Форма перезаписывается целиком — киллы уходят вместе с рефлексией.
    await pool.query(`DELETE FROM game_reflections WHERE id = $1`, [reflectionId]);
    const orphans = await pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM game_reflection_kills WHERE reflection_id = $1`,
      [reflectionId]
    );
    expect(Number(orphans.rows[0].count)).toBe(0);
  });
});

describe("game_captain_reports schema", () => {
  it("один отчёт на пойнт", async () => {
    await pool.query(`INSERT INTO game_captain_reports (point_id, author_user_id) VALUES ($1, $2)`, [
      fixture.pointId,
      fixture.userId,
    ]);
    await expect(
      pool.query(`INSERT INTO game_captain_reports (point_id, author_user_id) VALUES ($1, $2)`, [
        fixture.pointId,
        fixture.userId,
      ])
    ).rejects.toThrow(/game_captain_reports_point_uniq/);
    await pool.query(`DELETE FROM game_captain_reports WHERE point_id = $1`, [fixture.pointId]);
  });

  it("инициатива по линии — только −1 / 0 / +1", async () => {
    await expect(
      pool.query(`INSERT INTO game_captain_reports (point_id, author_user_id, initiative_snake) VALUES ($1, $2, 2)`, [
        fixture.pointId,
        fixture.userId,
      ])
    ).rejects.toThrow(/game_captain_reports_initiative_check/);
  });
});
