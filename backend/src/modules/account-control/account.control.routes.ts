import { Router } from "express";
import type { NextFunction, Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { accountControlService } from "./account.control.service.js";

const router = Router();
type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;

const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

/**
 * GET /api/account-control/forgot-password-info
 * Public — no auth required. Returns instructions for end-users.
 */
router.get("/forgot-password-info", (_req, res: Response) => {
  return res.json({
    message: "Password reset is handled via email OTP.",
    instructions: "Use the forgot-password form to receive a reset link by email, or contact your HR/Admin for an admin-initiated reset.",
  });
});

// All routes below require authentication
router.use(requireAuth);

/**
 * POST /api/account-control/reset-request
 * Body: { userId, reason? }
 * Super Admin, Admin or HR: log a password reset request for a user.
 */
router.post(
  "/reset-request",
  requireRole("super_admin", "admin", "hr"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { userId } = req.body as { userId?: string; reason?: string };
    if (!userId) return res.status(400).json({ error: "userId required" });
    const result = await accountControlService.requestPasswordReset(
      userId,
      "",
      req.authUser!.id,
      req.ip ?? ""
    );
    return res.json({ data: result });
  })
);

router.post(
  "/force-change",
  requireRole("super_admin", "admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { userId, reason } = req.body as { userId?: string; reason?: string };
    if (!userId) return res.status(400).json({ error: "userId required" });
    const result = await accountControlService.forcePasswordChange(
      userId,
      req.authUser!.id,
      reason ?? "",
      req.ip ?? ""
    );
    return res.json({ data: result });
  })
);

router.post(
  "/lock",
  requireRole("super_admin", "admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { userId, reason } = req.body as { userId?: string; reason?: string };
    if (!userId) return res.status(400).json({ error: "userId required" });
    const result = await accountControlService.lockAccount(
      userId,
      req.authUser!.id,
      reason ?? "",
      req.ip ?? ""
    );
    return res.json({ data: result });
  })
);

router.post(
  "/unlock",
  requireRole("super_admin", "admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { userId } = req.body as { userId?: string };
    if (!userId) return res.status(400).json({ error: "userId required" });
    const result = await accountControlService.unlockAccount(
      userId,
      req.authUser!.id,
      req.ip ?? ""
    );
    return res.json({ data: result });
  })
);

router.post(
  "/disable",
  requireRole("super_admin", "admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { userId, reason } = req.body as { userId?: string; reason?: string };
    if (!userId) return res.status(400).json({ error: "userId required" });
    const result = await accountControlService.disableAccount(
      userId,
      req.authUser!.id,
      reason ?? "",
      req.ip ?? ""
    );
    return res.json({ data: result });
  })
);

router.post(
  "/enable",
  requireRole("super_admin", "admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { userId } = req.body as { userId?: string };
    if (!userId) return res.status(400).json({ error: "userId required" });
    const result = await accountControlService.enableAccount(
      userId,
      req.authUser!.id,
      req.ip ?? ""
    );
    return res.json({ data: result });
  })
);

router.post(
  "/revoke-session",
  requireRole("super_admin", "admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { userId } = req.body as { userId?: string };
    if (!userId) return res.status(400).json({ error: "userId required" });
    const result = await accountControlService.logSessionRevoke(
      userId,
      req.authUser!.id,
      req.ip ?? ""
    );
    return res.json({ data: result });
  })
);

router.get(
  "/audit-log/:userId",
  requireRole("super_admin", "admin", "hr"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { userId } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const logs = await accountControlService.getAccountAuditLog(userId, limit);
    return res.json({ data: logs });
  })
);

export { router as accountControlRouter };
