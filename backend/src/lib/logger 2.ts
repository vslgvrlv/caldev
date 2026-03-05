type LogLevel = "info" | "warn" | "error";

type LogPayload = {
  level: LogLevel;
  ts: string;
  msg: string;
  correlationId?: string;
  [key: string]: unknown;
};

function write(level: LogLevel, msg: string, data?: Record<string, unknown>) {
  const payload: LogPayload = {
    level,
    ts: new Date().toISOString(),
    msg,
    ...(data || {}),
  };
  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

export const logger = {
  info: (msg: string, data?: Record<string, unknown>) => write("info", msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => write("warn", msg, data),
  error: (msg: string, data?: Record<string, unknown>) => write("error", msg, data),
};
