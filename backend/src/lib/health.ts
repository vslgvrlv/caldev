import { pool } from "../db/pool.js";

// Глубокая проверка здоровья: живая ли база. Таймаут обязателен — зависшее
// соединение не должно вешать проверку дольше, чем ждёт её вызывающий.
export async function checkDatabase(timeoutMs: number): Promise<{ ok: boolean; latencyMs: number }> {
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("db health timeout")), timeoutMs);
      }),
    ]);
    return { ok: true, latencyMs: Date.now() - started };
  } catch {
    return { ok: false, latencyMs: Date.now() - started };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
