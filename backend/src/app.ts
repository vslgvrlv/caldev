import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "./config/env.js";
import { sessionMiddleware } from "./lib/session.js";
import { sendError, withErrorMetadata } from "./lib/http-error.js";
import { logger } from "./lib/logger.js";
import { attachRequestContext } from "./middleware/request-context.js";
import { slowRequestLog } from "./middleware/slow-request-log.js";
import { authRouter } from "./modules/auth/routes.js";
import { yandexRouter } from "./modules/auth/yandex-routes.js";
import { identitiesRouter } from "./modules/auth/identities-routes.js";
import { eventsRouter } from "./modules/events/routes.js";
import { fieldPositionsRouter } from "./modules/field-positions/routes.js";
import { financeRouter } from "./modules/finance/routes.js";
import { icsRouter } from "./modules/ics/routes.js";
import { initRouter } from "./modules/init/routes.js";
import { notificationsRouter } from "./modules/notifications/routes.js";
import { pushRouter } from "./modules/push/routes.js";
import { placesRouter } from "./modules/places/routes.js";
import { reflectionsRouter } from "./modules/reflections/routes.js";
import { profileRouter } from "./modules/profile/routes.js";
import { rsvpRouter } from "./modules/rsvp/routes.js";
import { teamsRouter } from "./modules/teams/routes.js";
import { adminRouter } from "./modules/admin/routes.js";
import { vendorRouter } from "./modules/vendor/routes.js";
import { joinRequestsRouter } from "./modules/join-requests/routes.js";
import { teamRequestsRouter } from "./modules/team-requests/routes.js";
import { remindersRouter } from "./modules/reminders/routes.js";
import { platformRouter } from "./modules/platform/routes.js";
import { slotsRouter } from "./modules/slots/routes.js";
import { buildOpenApiSpec } from "./openapi/spec.js";
import { openApiForRequest } from "./lib/production-guards.js";
import { checkDatabase } from "./lib/health.js";
import { auditContextMiddleware, TeamAccessError } from "./lib/team-access.js";

export const app = express();
app.set("trust proxy", 1);
app.set("etag", false);

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

app.use(
  cors({
    origin: [env.frontendUrl],
    credentials: true,
  })
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(slowRequestLog);
app.use(attachRequestContext);
app.use(sessionMiddleware);
// Контекст запроса для пометки владельца в журнале — после сессии: её
// загрузка идёт через колбэки хранилища и теряла бы контекст.
app.use(auditContextMiddleware);

app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    return originalJson(withErrorMetadata(req, body, res.statusCode));
  }) as typeof res.json;
  next();
});

const noStoreMiddleware: express.RequestHandler = (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
};

const authRateLimiter = rateLimit({
  windowMs: env.rateLimit.authWindowMs,
  limit: env.rateLimit.authMax,
  standardHeaders: true,
  legacyHeaders: false,
  // `/auth/me` is called multiple times during bootstrap and Telegram Mini App startup.
  // Pairing status is deliberately polled for up to five minutes, while pairing
  // starts already have a stricter per-browser limiter in the route itself.
  // Limiting these by IP causes false 429s for mobile users behind carrier NAT.
  skip: (req) =>
    req.path === "/me" ||
    req.path === "/pair/start" ||
    req.path === "/pair/status" ||
    req.path === "/telegram/webapp" ||
    req.path === "/telegram/oidc/start" ||
    req.path === "/telegram/oidc/callback",
});

// Ограничитель записи считает только запись. Он навешен на роутеры целиком,
// а экран ожидания заявки опрашивает `/join-requests` и `/team-requests`
// каждые 10 с: чтение не должно съедать предел тех, кто на том же Wi-Fi
// площадки отвечает на явку. Ключ — прежний (IP).
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const writeRateLimiter = rateLimit({
  windowMs: env.rateLimit.writeWindowMs,
  limit: env.rateLimit.writeMax,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => SAFE_METHODS.has(req.method),
});

const openapiSpec = buildOpenApiSpec();

function mountApiV1(router: express.Router) {
  // `/health` — быстрый ответ процесса, на нём держатся проверки выката.
  // `/health?deep=1` — ещё и база: SELECT 1 с таймаутом, при сбое 503.
  router.get("/health", async (req, res) => {
    if (req.query.deep !== "1" && req.query.deep !== "true") {
      return res.json({ status: "ok" });
    }
    const db = await checkDatabase(env.healthDbTimeoutMs);
    if (!db.ok) {
      return res.status(503).json({ status: "degraded", db: "error" });
    }
    return res.json({ status: "ok", db: "ok", dbLatencyMs: db.latencyMs });
  });
  router.get("/release/version", (_req, res) => {
    res.json({
      releaseId: env.release.id,
      commit: env.release.commit,
      builtAt: env.release.builtAt,
    });
  });
  // В production полное описание API — только с токеном; без него заглушка.
  router.get("/openapi.json", (req, res) => {
    res.json(
      openApiForRequest(openapiSpec, {
        isProd: env.isProd,
        configuredToken: env.openapi.token,
        providedToken: String(req.get("x-openapi-token") || ""),
      })
    );
  });
  router.use("/auth/yandex", authRateLimiter, yandexRouter);
  router.use("/auth/identities", identitiesRouter);
  router.use("/auth", authRateLimiter, authRouter);
  router.use("/vendor", vendorRouter);
  router.use("/init", initRouter);
  router.use("/events", writeRateLimiter, eventsRouter);
  router.use("/places", placesRouter);
  router.use("/field-positions", fieldPositionsRouter);
  router.use("/reflections", writeRateLimiter, reflectionsRouter);
  router.use("/rsvp", writeRateLimiter, rsvpRouter);
  router.use("/finance", writeRateLimiter, financeRouter);
  router.use("/transactions", writeRateLimiter, financeRouter);
  router.use("/notifications", writeRateLimiter, notificationsRouter);
  router.use("/push", writeRateLimiter, pushRouter);
  router.use("/profile", profileRouter);
  router.use("/teams", teamsRouter);
  router.use("/admin", adminRouter);
  // Модули треков второй волны ревизии — подключены заранее, пока пустые.
  router.use("/join-requests", writeRateLimiter, joinRequestsRouter);
  router.use("/team-requests", writeRateLimiter, teamRequestsRouter);
  router.use("/reminders", writeRateLimiter, remindersRouter);
  router.use("/platform", platformRouter);
  router.use("/slots", writeRateLimiter, slotsRouter);
}

const v1Router = express.Router();
mountApiV1(v1Router);
app.use("/api/v1", noStoreMiddleware, v1Router);

const legacySunset = "Wed, 31 Dec 2026 23:59:59 GMT";
const legacyRouter = express.Router();
legacyRouter.use((_req, res, next) => {
  res.setHeader("Deprecation", "true");
  res.setHeader("Sunset", legacySunset);
  next();
});
mountApiV1(legacyRouter);
app.use("/api", noStoreMiddleware, legacyRouter);

app.use("/calendar", icsRouter);

app.use((req, res) => {
  sendError(req, res, 404, "NOT_FOUND", "Not found");
});

app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err && typeof err === "object" && "issues" in err) {
    return sendError(req, res, 400, "VALIDATION_ERROR", "Validation error", { errors: err });
  }
  if (err instanceof TeamAccessError) {
    return sendError(req, res, err.status, err.code, err.message);
  }
  logger.error("http.unhandled_error", {
    correlationId: req.correlationId,
    error: err instanceof Error ? err.message : String(err),
  });
  return sendError(req, res, 500, "INTERNAL_SERVER_ERROR", "Internal server error");
});
