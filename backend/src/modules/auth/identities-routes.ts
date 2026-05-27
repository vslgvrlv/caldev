import { Router } from "express";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import { sendError } from "../../lib/http-error.js";
import { listIdentitiesForUser } from "../../lib/identity-repo.js";

const identitiesRouter = Router();

function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [local, domain] = email.split("@");
  if (!local || !domain) return null;
  if (local.length <= 1) return `${local}***@${domain}`;
  return `${local[0]}***@${domain}`;
}

/**
 * GET /api/v1/auth/identities
 * Returns the current user's linked OAuth identities (masked email for privacy).
 */
identitiesRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.session.userId;
    if (!userId) {
      return sendError(req, res, 401, "AUTH_REQUIRED", "Session required");
    }
    const rows = await listIdentitiesForUser(userId);
    res.json({
      identities: rows.map((r) => ({
        provider: r.provider,
        emailMasked: maskEmail(r.email),
        linkedAt: r.linkedAt.toISOString(),
      })),
    });
  })
);

export { identitiesRouter };
