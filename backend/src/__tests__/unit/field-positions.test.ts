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
  it("содержит ровно 51 позицию: 23 сторонние фигуры x2 + 5 центральных", async () => {
    const r = await pool.query<{ total: string; near: string; far: string; center: string }>(
      `SELECT count(*) AS total,
              count(*) FILTER (WHERE side = 'NEAR')   AS near,
              count(*) FILTER (WHERE side = 'FAR')    AS far,
              count(*) FILTER (WHERE side = 'CENTER') AS center
       FROM field_positions`
    );
    expect(Number(r.rows[0].total)).toBe(51);
    expect(Number(r.rows[0].near)).toBe(23);
    expect(Number(r.rows[0].far)).toBe(23);
    expect(Number(r.rows[0].center)).toBe(5);
  });

  it("три независимые группы: 20 числовых, 4 змеи, 4 конверта", async () => {
    const r = await pool.query<{ figure_group: string; count: string }>(
      `SELECT figure_group, count(*) AS count FROM field_positions GROUP BY 1`
    );
    const byGroup = Object.fromEntries(r.rows.map((x) => [x.figure_group, Number(x.count)]));
    expect(byGroup).toEqual({ grid: 35, snake: 8, envelope: 8 });
  });

  // Главная развилка модели: тысячный ряд стоит ровно на середине поля и не
  // дублируется — «нашей 3000» и «их 3000» не существует. Z4/K4 при этом
  // сторонние: на глубинной линии половины стоят только фланговые фигуры.
  it("центральный ровно тысячный числовой ряд, змеи и конверты сторонние", async () => {
    const center = await pool.query<{ figure_index: string }>(
      `SELECT figure_index FROM field_positions WHERE side = 'CENTER' ORDER BY sort_order`
    );
    expect(center.rows.map((x) => x.figure_index)).toEqual([
      "1000", "2000", "3000", "4000", "5000",
    ]);

    const flankCenter = await pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM field_positions
       WHERE side = 'CENTER' AND figure_group IN ('snake', 'envelope')`
    );
    expect(Number(flankCenter.rows[0].count)).toBe(0);

    const z4 = await pool.query<{ side: string }>(
      `SELECT side FROM field_positions WHERE figure_group = 'snake' AND figure_index = '4' ORDER BY side`
    );
    expect(z4.rows.map((x) => x.side)).toEqual(["FAR", "NEAR"]);
  });

  it("номера не пересекаются между группами — grid.50 и envelope.4 разные записи", async () => {
    const r = await pool.query<{ id: string }>(
      `SELECT id FROM field_positions WHERE id IN ('grid.50.near', 'envelope.4.near')`
    );
    expect(r.rows).toHaveLength(2);
  });

  // depth — номер ряда на схеме поля. Схема рисуется от базы вглубь, поэтому
  // ряд должен быть задан у всех фигур, иначе фланговую нечем позиционировать.
  it("линия глубины задана у всех фигур, Z1/K1 в первом ряду, Z4/K4 в дальнем", async () => {
    const missing = await pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM field_positions WHERE depth IS NULL`
    );
    expect(Number(missing.rows[0].count)).toBe(0);

    const flanks = await pool.query<{ code: string; depth: number }>(
      `SELECT code, depth FROM field_positions
       WHERE side = 'NEAR' AND figure_group IN ('snake', 'envelope') ORDER BY code COLLATE "C"`
    );
    expect(flanks.rows.map((x) => [x.code, x.depth])).toEqual([
      ["K1Б", 1], ["K2Б", 10], ["K3Б", 100], ["K4Б", 1000],
      ["Z1Б", 1], ["Z2Б", 10], ["Z3Б", 100], ["Z4Б", 1000],
    ]);
  });

  // Короткая запись — подпись на кнопке схемы: Z2Д, K4Б. У центральной стороны
  // нет, поэтому и буквы нет: просто «3000».
  it("короткий код уникален и собран из группы, номера и стороны", async () => {
    const r = await pool.query<{ id: string; code: string }>(
      `SELECT id, code FROM field_positions
       WHERE id IN ('snake.2.far', 'envelope.4.near', 'grid.3000.center') ORDER BY id`
    );
    expect(r.rows.map((x) => x.code)).toEqual(["K4Б", "3000", "Z2Д"]);

    const dup = await pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM (SELECT code FROM field_positions GROUP BY 1 HAVING count(*) > 1) d`
    );
    expect(Number(dup.rows[0].count)).toBe(0);
  });
});
