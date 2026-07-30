import { Router } from "express";
import { query } from "../../db/pool.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.js";

export const fieldPositionsRouter = Router();

// Справочник укрытий (фигур) на поле — источник выбора позиции в форме рефлексии (#89).
// Каталог статический (56 позиций), отдаётся целиком: клиент фильтрует и ищет локально,
// пагинация и поиск на сервере тут были бы лишними.
// По умолчанию только active — фигуры, стоящие на текущей конфигурации поля.
fieldPositionsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const includeInactive = req.query.includeInactive === "true";

    const rows = await query<{
      id: string;
      figure_group: string;
      figure_index: string;
      side: string;
      code: string;
      depth: number | null;
      label: string;
      active: boolean;
    }>(
      `SELECT id, figure_group, figure_index, side, code, depth, label, active
       FROM field_positions
       WHERE $1::boolean OR active
       ORDER BY sort_order`,
      [includeInactive]
    );

    const items = rows.rows.map((r) => ({
      id: r.id,
      group: r.figure_group,
      index: r.figure_index,
      side: r.side,
      code: r.code,
      depth: r.depth,
      label: r.label,
      active: r.active,
    }));

    return res.json({ items });
  })
);
