export type AuthMetricMethod = "OIDC" | "WEBAPP" | "LEGACY_WIDGET" | "DEV" | "BOT_HANDOFF" | "YANDEX_OAUTH" | "PAIRING" | "UNKNOWN";
export type AuthMetricPlatform = "android" | "ios" | "desktop" | "unknown";
export type AuthMetricOutcome = "ATTEMPT" | "SUCCESS" | "ERROR";

type AuthMetric = {
  ts: number;
  method: AuthMetricMethod;
  platform: AuthMetricPlatform;
  outcome: AuthMetricOutcome;
  code?: string;
};

const MAX_EVENTS = 50_000;
const MAX_RETENTION_MS = 1000 * 60 * 60 * 24 * 7;
const authMetrics: AuthMetric[] = [];

function normalizeCode(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return code
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase()
    .slice(0, 80);
}

function prune(nowTs: number) {
  const minTs = nowTs - MAX_RETENTION_MS;
  while (authMetrics.length > 0 && (authMetrics.length > MAX_EVENTS || authMetrics[0].ts < minTs)) {
    authMetrics.shift();
  }
}

function buildBreakdown<T extends string>(events: AuthMetric[], keySelector: (event: AuthMetric) => T) {
  const grouped = new Map<T, { attempts: number; successes: number; errors: number }>();

  for (const item of events) {
    const key = keySelector(item);
    const current = grouped.get(key) || { attempts: 0, successes: 0, errors: 0 };
    if (item.outcome === "ATTEMPT") current.attempts += 1;
    if (item.outcome === "SUCCESS") current.successes += 1;
    if (item.outcome === "ERROR") current.errors += 1;
    grouped.set(key, current);
  }

  const result: Record<string, { attempts: number; successes: number; errors: number; successRate: number | null; errorRate: number | null }> = {};
  for (const [key, stats] of grouped.entries()) {
    const successRate = stats.attempts > 0 ? stats.successes / stats.attempts : null;
    const errorRate = stats.attempts > 0 ? stats.errors / stats.attempts : null;
    result[key] = {
      ...stats,
      successRate,
      errorRate,
    };
  }
  return result;
}

export function recordAuthMetric(input: {
  method: AuthMetricMethod;
  platform: AuthMetricPlatform;
  outcome: AuthMetricOutcome;
  code?: string;
  ts?: number;
}) {
  const nowTs = input.ts ?? Date.now();
  authMetrics.push({
    ts: nowTs,
    method: input.method,
    platform: input.platform,
    outcome: input.outcome,
    code: normalizeCode(input.code),
  });
  prune(nowTs);
}

export function getAuthSloSummary(input: {
  windowMinutes: number;
  minAttempts: number;
  maxErrorRate: number;
  nowTs?: number;
}) {
  const nowTs = input.nowTs ?? Date.now();
  const windowMinutes = Math.max(1, Math.floor(input.windowMinutes || 60));
  const windowMs = windowMinutes * 60_000;
  const fromTs = nowTs - windowMs;

  const events = authMetrics.filter((item) => item.ts >= fromTs);
  let attempts = 0;
  let successes = 0;
  let errors = 0;
  for (const item of events) {
    if (item.outcome === "ATTEMPT") attempts += 1;
    if (item.outcome === "SUCCESS") successes += 1;
    if (item.outcome === "ERROR") errors += 1;
  }

  const successRate = attempts > 0 ? successes / attempts : null;
  const errorRate = attempts > 0 ? errors / attempts : null;

  let status: "ok" | "breached" | "insufficient_data" = "ok";
  if (attempts < input.minAttempts) {
    status = "insufficient_data";
  } else if ((errorRate ?? 0) > input.maxErrorRate) {
    status = "breached";
  }

  return {
    status,
    windowMinutes,
    from: new Date(fromTs).toISOString(),
    to: new Date(nowTs).toISOString(),
    attempts,
    successes,
    errors,
    successRate,
    errorRate,
    thresholds: {
      minAttempts: input.minAttempts,
      maxErrorRate: input.maxErrorRate,
    },
    byMethod: buildBreakdown(events, (item) => item.method),
    byPlatform: buildBreakdown(events, (item) => item.platform),
  };
}

export function resetAuthMetricsForTests() {
  authMetrics.length = 0;
}
