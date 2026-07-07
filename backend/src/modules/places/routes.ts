import { Router } from "express";
import { query } from "../../db/pool.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import { getActiveContext } from "../teams/context.js";

export const placesRouter = Router();

// Источник автокомплита места события: общие базы + история активной команды.
// Дедуп по имени (командная запись важнее общей), сортировка по частоте использования.
placesRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await getActiveContext(req as any);
    const teamId = ctx?.teamId ?? null;

    const rows = await query<{
      id: string;
      name: string;
      address: string | null;
      yandex_url: string | null;
      usage_count: number;
    }>(
      `SELECT DISTINCT ON (lower(name)) id, name, address, yandex_url, usage_count
       FROM saved_places
       WHERE team_id IS NULL OR team_id = $1
       ORDER BY lower(name), (team_id IS NOT NULL) DESC, usage_count DESC`,
      [teamId]
    );

    const items = rows.rows
      .map((r) => ({
        id: r.id,
        name: r.name,
        address: r.address,
        yandexUrl: r.yandex_url,
        usageCount: r.usage_count,
      }))
      .sort((a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name, "ru"));

    return res.json({ items });
  })
);
