import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "./config/env.js";
import { sessionMiddleware } from "./lib/session.js";
import { sendError, withErrorMetadata } from "./lib/http-error.js";
import { logger } from "./lib/logger.js";
import { attachRequestContext } from "./middleware/request-context.js";
import { authRouter } from "./modules/auth/routes.js";
import { yandexRouter } from "./modules/auth/yandex-routes.js";
import { identitiesRouter } from "./modules/auth/identities-routes.js";
import { eventsRouter } from "./modules/events/routes.js";
import { financeRouter } from "./modules/finance/routes.js";
import { icsRouter } from "./modules/ics/routes.js";
import { initRouter } from "./modules/init/routes.js";
import { notificationsRouter } from "./modules/notifications/routes.js";
import { placesRouter } from "./modules/places/routes.js";
import { profileRouter } from "./modules/profile/routes.js";
import { rsvpRouter } from "./modules/rsvp/routes.js";
import { teamsRouter } from "./modules/teams/routes.js";
import { adminRouter } from "./modules/admin/routes.js";
import { vendorRouter } from "./modules/vendor/routes.js";
import { buildOpenApiSpec } from "./openapi/spec.js";

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
app.use(attachRequestContext);
app.use(sessionMiddleware);

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
  // Telegram auth endpoints can retry on slow WebView/script initialization.
  // Limiting these by IP causes false 429s for mobile users behind carrier NAT.
  skip: (req) =>
    req.path === "/me" ||
    req.path === "/telegram/webapp" ||
    req.path === "/telegram/oidc/start" ||
    req.path === "/telegram/oidc/callback",
});

const writeRateLimiter = rateLimit({
  windowMs: env.rateLimit.writeWindowMs,
  limit: env.rateLimit.writeMax,
  standardHeaders: true,
  legacyHeaders: false,
});

const openapiSpec = buildOpenApiSpec();

function mountApiV1(router: express.Router) {
  router.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  router.get("/release/version", (_req, res) => {
    res.json({
      releaseId: env.release.id,
      commit: env.release.commit,
      builtAt: env.release.builtAt,
    });
  });
  router.get("/openapi.json", (_req, res) => {
    res.json(openapiSpec);
  });
  router.use("/auth/yandex", authRateLimiter, yandexRouter);
  router.use("/auth/identities", identitiesRouter);
  router.use("/auth", authRateLimiter, authRouter);
  router.use("/vendor", vendorRouter);
  router.use("/init", initRouter);
  router.use("/events", writeRateLimiter, eventsRouter);
  router.use("/places", placesRouter);
  router.use("/rsvp", writeRateLimiter, rsvpRouter);
  router.use("/finance", writeRateLimiter, financeRouter);
  router.use("/transactions", writeRateLimiter, financeRouter);
  router.use("/notifications", writeRateLimiter, notificationsRouter);
  router.use("/profile", profileRouter);
  router.use("/teams", teamsRouter);
  router.use("/admin", adminRouter);
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
  logger.error("http.unhandled_error", {
    correlationId: req.correlationId,
    error: err instanceof Error ? err.message : String(err),
  });
  return sendError(req, res, 500, "INTERNAL_SERVER_ERROR", "Internal server error");
});
