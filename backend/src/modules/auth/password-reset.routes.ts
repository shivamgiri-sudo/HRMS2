import { Router } from "express";

/**
 * Deprecated compatibility router.
 *
 * Password reset is implemented only in auth.routes.ts using hashed,
 * single-use tokens stored in auth_password_reset and email delivery through
 * the configured communication service. This router intentionally registers
 * no duplicate endpoints so reset codes/tokens can never be logged or returned
 * to the browser by an older implementation.
 *
 * It remains exported temporarily to avoid breaking older imports while the
 * application is consolidated around the canonical auth router.
 */
const router = Router();

export default router;
