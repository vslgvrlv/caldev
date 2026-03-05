import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";

const PgSession = connectPgSimple(session);

export const sessionMiddleware = session({
  store: new PgSession({
    pool,
    tableName: "session",
    createTableIfMissing: false,
  }),
  proxy: env.isProd,
  name: env.session.cookieName,
  secret: env.session.secret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: env.isProd,
    domain: env.session.cookieDomain,
    sameSite: env.session.cookieSameSite,
    maxAge: env.session.maxAgeMs,
  },
});
