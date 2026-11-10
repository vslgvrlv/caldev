import { app } from "./app.js";
import { env } from "./config/env.js";
import { pool } from "./db/pool.js";
import { logger } from "./lib/logger.js";
import { startNotificationQueue, stopNotificationQueue } from "./lib/notification-queue.js";
import { pruneExpiredAuthArtifacts } from "./lib/replay-guard.js";
import { startAutoReminders, stopAutoReminders } from "./modules/reminders/auto.js";

async function start() {
  await pool.query("SELECT 1");
  await startNotificationQueue();
  const authCleanupTimer = setInterval(() => {
    void pruneExpiredAuthArtifacts().catch((error) => {
      logger.error("auth.cleanup.failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, 10 * 60 * 1000);
  authCleanupTimer.unref();
  // Авто-напоминания о явке (трек 2): таймер в этом процессе, без очереди;
  // включаются переменной AUTO_REMINDERS_ENABLED=1 (см. modules/reminders/auto.ts).
  startAutoReminders();

  const server = app.listen(env.port, () => {
    logger.info("server.started", { port: env.port, nodeEnv: env.nodeEnv });
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("server.shutdown.start", { signal });

    server.close(async () => {
      try {
        stopAutoReminders();
        await stopNotificationQueue();
        clearInterval(authCleanupTimer);
        await pool.end();
      } catch (error) {
        logger.error("server.shutdown.error", { signal, error: error instanceof Error ? error.message : String(error) });
      } finally {
        logger.info("server.shutdown.complete", { signal });
        process.exit(0);
      }
    });
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

start().catch((err) => {
  logger.error("server.start_failed", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
