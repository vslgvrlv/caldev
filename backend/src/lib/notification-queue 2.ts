import { createRequire } from "node:module";
import { env } from "../config/env.js";
import { logger } from "./logger.js";
import { sendTelegramBotMessage } from "./telegram-bot.js";

const require = createRequire(import.meta.url);

const TG_SEND_QUEUE_NAME = "notifications.send_telegram";
const TG_DLQ_QUEUE_NAME = "notifications.send_telegram.dlq";

type PgBossLike = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  createQueue: (name: string, options?: Record<string, unknown>) => Promise<void>;
  send: (name: string, data: unknown, options?: Record<string, unknown>) => Promise<string | number | null>;
  work: (name: string, options: Record<string, unknown>, handler: (job: any) => Promise<void>) => Promise<unknown>;
};

export type TelegramNotificationJobPayload = {
  chatId: string;
  text: string;
  context?: {
    actorUserId?: string;
    recipientUserId?: string;
    teamId?: string;
    eventId?: string;
    correlationId?: string;
    type?: "EVENT_REMINDER" | "EVENT_DEBT_REMINDER" | "TEAM_DEBT_REMINDER" | "MEMBER_DEBT_REMINDER";
  };
};

let boss: PgBossLike | null = null;
let started = false;

function buildPostgresConnectionString() {
  const user = encodeURIComponent(env.db.user);
  const password = encodeURIComponent(env.db.password);
  const host = env.db.host;
  const port = env.db.port;
  const database = encodeURIComponent(env.db.database);
  const sslMode = env.db.ssl ? "require" : "disable";
  return `postgres://${user}:${password}@${host}:${port}/${database}?sslmode=${sslMode}`;
}

function loadPgBossCtor(): new (connectionString: string, options?: Record<string, unknown>) => PgBossLike {
  const loaded = require("pg-boss");
  const ctor = loaded?.default || loaded;
  if (!ctor) {
    throw new Error("pg-boss module is empty");
  }
  return ctor as new (connectionString: string, options?: Record<string, unknown>) => PgBossLike;
}

function getFailedReason(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function processTelegramJob(job: any) {
  const payload = (job?.data || {}) as TelegramNotificationJobPayload;
  if (!payload.chatId || !payload.text) {
    logger.warn("notifications.queue.job_invalid_payload", { jobId: job?.id });
    return;
  }

  try {
    await sendTelegramBotMessage(payload.chatId, payload.text);
    logger.info("notifications.queue.job_sent", {
      jobId: job?.id,
      teamId: payload.context?.teamId,
      eventId: payload.context?.eventId,
      recipientUserId: payload.context?.recipientUserId,
      type: payload.context?.type,
    });
  } catch (error) {
    logger.error("notifications.queue.job_failed", {
      jobId: job?.id,
      retryCount: job?.retrycount,
      retryLimit: job?.retrylimit,
      reason: getFailedReason(error),
      teamId: payload.context?.teamId,
      eventId: payload.context?.eventId,
      recipientUserId: payload.context?.recipientUserId,
      type: payload.context?.type,
    });
    throw error;
  }
}

export function isNotificationsQueueEnabled() {
  return env.notifications.queueEnabled;
}

export async function startNotificationQueue() {
  if (!env.notifications.queueEnabled) return;
  if (started && boss) return;

  const PgBossCtor = loadPgBossCtor();
  const connectionString = buildPostgresConnectionString();
  const instance = new PgBossCtor(connectionString, { schema: "pgboss" });

  await instance.start();
  await instance.createQueue(TG_DLQ_QUEUE_NAME);
  await instance.createQueue(TG_SEND_QUEUE_NAME, { deadLetter: TG_DLQ_QUEUE_NAME });
  await instance.work(
    TG_SEND_QUEUE_NAME,
    { teamSize: env.notifications.queueConcurrency },
    async (jobs: any[]) => {
      if (!Array.isArray(jobs)) {
        await processTelegramJob(jobs);
        return;
      }
      for (const job of jobs) {
        await processTelegramJob(job);
      }
    }
  );

  boss = instance;
  started = true;
  logger.info("notifications.queue.started", {
    queue: TG_SEND_QUEUE_NAME,
    deadLetterQueue: TG_DLQ_QUEUE_NAME,
    concurrency: env.notifications.queueConcurrency,
    retryLimit: env.notifications.retryLimit,
    retryDelaySeconds: env.notifications.retryDelaySeconds,
  });
}

export async function stopNotificationQueue() {
  if (!boss) return;
  await boss.stop();
  boss = null;
  started = false;
  logger.info("notifications.queue.stopped");
}

export async function enqueueTelegramNotification(payload: TelegramNotificationJobPayload) {
  if (!env.notifications.queueEnabled) {
    throw new Error("Notifications queue is disabled");
  }
  if (!boss) {
    throw new Error("Notifications queue is not started");
  }

  const jobId = await boss.send(TG_SEND_QUEUE_NAME, payload, {
    retryLimit: env.notifications.retryLimit,
    retryDelay: env.notifications.retryDelaySeconds,
    retryBackoff: true,
    deadLetter: TG_DLQ_QUEUE_NAME,
  });

  return { jobId: String(jobId) };
}
