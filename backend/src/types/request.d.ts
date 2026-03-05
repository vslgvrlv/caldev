import type { AuthUser } from "../middleware/auth.js";

declare global {
  namespace Express {
    interface Request {
      correlationId: string;
      authUser?: AuthUser;
    }
  }
}

export {};
