import { beforeAll, describe, expect, it } from "vitest";

process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
process.env.TELEGRAM_CALLBACK_URL =
  process.env.TELEGRAM_CALLBACK_URL || "http://127.0.0.1:8000/api/v1/auth/telegram/callback";

let pool: typeof import("../../db/pool.js").pool;

beforeAll(async () => {
  ({ pool } = await import("../../db/pool.js"));
});

// Каталог сидируется миграцией 028 и должен оставаться в максимальной конфигурации.
// Тест сторожит именно состав справочника: опечатка в сиде тихо ломает аналитику
// рефлексии (#89), потому что позиции подставляются в форму из этой таблицы.
describe("field_positions catalog", () => {
  it("содержит ровно 56 позиций: 28 фигур x 2 стороны", async () => {
    const r = await pool.query<{ total: string; near: string; far: string }>(
      `SELECT count(*) AS total,
              count(*) FILTER (WHERE side = 'NEAR') AS near,
              count(*) FILTER (WHERE side = 'FAR')  AS far
       FROM field_positions`
    );
    expect(Number(r.rows[0].total)).toBe(56);
    expect(Number(r.rows[0].near)).toBe(28);
    expect(Number(r.rows[0].far)).toBe(28);
  });

  it("три независимые группы: 20 числовых, 4 змеи, 4 конверта (x2 стороны)", async () => {
    const r = await pool.query<{ figure_group: string; count: string }>(
      `SELECT figure_group, count(*) AS count FROM field_positions GROUP BY 1`
    );
    const byGroup = Object.fromEntries(r.rows.map((x) => [x.figure_group, Number(x.count)]));
    expect(byGroup).toEqual({ grid: 40, snake: 8, envelope: 8 });
  });

  it("номера не пересекаются между группами — grid.50 и envelope.4 разные записи", async () => {
    const r = await pool.query<{ id: string }>(
      `SELECT id FROM field_positions WHERE id IN ('grid.50.near', 'envelope.4.near')`
    );
    expect(r.rows).toHaveLength(2);
  });

  it("у числовых задана линия глубины", async () => {
    const grid = await pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM field_positions WHERE figure_group = 'grid' AND depth IS NULL`
    );
    expect(Number(grid.rows[0].count)).toBe(0);
  });

  // Короткая запись — то, что игрок реально набирает в форме: Z2Б, K4Д, 3000Б.
  it("короткий код уникален и собран из группы, номера и стороны", async () => {
    const r = await pool.query<{ id: string; code: string }>(
      `SELECT id, code FROM field_positions
       WHERE id IN ('snake.2.far', 'envelope.4.near', 'grid.3000.near') ORDER BY id`
    );
    expect(r.rows.map((x) => x.code)).toEqual(["K4Б", "3000Б", "Z2Д"]);

    const dup = await pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM (SELECT code FROM field_positions GROUP BY 1 HAVING count(*) > 1) d`
    );
    expect(Number(dup.rows[0].count)).toBe(0);
  });
});
