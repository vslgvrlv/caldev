import { Pool, type QueryResultRow } from "pg";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

export const pool = new Pool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  ssl: env.db.ssl ? { rejectUnauthorized: false } : undefined,
});

pool.on("error", (err) => {
  logger.error("db.pool_error", { error: err.message });
});

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) {
  const result = await pool.query<T>(text, values);
  return result;
}
