import { Router } from "express";
import {
  requireAuth,
  requireWriteAccess,
  type AuthenticatedRequest,
} from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { financeExpenseMasterService } from "./finance-expense-master.service.js";

const READ_ROLES = [
  "super_admin",
  "admin",
  "branch_admin",
  "branch_head",
  "finance",
  "finance_head",
  "accounts_head",
] as const;
const WRITE_ROLES = ["super_admin", "finance_head"] as const;

const router = Router();
router.use(requireAuth);

router.get(
  "/expense-masters",
  requireRole(...READ_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const roles = new Set(
        [req.authUser.role, ...(req.userRoles ?? [])]
          .filter((role): role is string => Boolean(role))
          .map((role) => role.toLowerCase())
      );
      const canReadInactive = roles.has("finance_head") || roles.has("super_admin");
      const includeInactive =
        canReadInactive && String(req.query.includeInactive ?? "false") === "true";
      const data = await financeExpenseMasterService.list(includeInactive);
      res.json({ success: true, data });
    } catch (error: unknown) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : "Unable to load expense master",
      });
    }
  }
);

router.post(
  "/expense-heads",
  requireWriteAccess,
  requireRole(...WRITE_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const data = await financeExpenseMasterService.saveHead(
        req.body,
        req.authUser.id
      );
      res.status(req.body?.id ? 200 : 201).json({ success: true, data });
    } catch (error: unknown) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : "Unable to save expense head",
      });
    }
  }
);

router.post(
  "/expense-sub-heads",
  requireWriteAccess,
  requireRole(...WRITE_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const data = await financeExpenseMasterService.saveSubHead(
        req.body,
        req.authUser.id
      );
      res.status(req.body?.id ? 200 : 201).json({ success: true, data });
    } catch (error: unknown) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : "Unable to save expense sub-head",
      });
    }
  }
);

export { router as financeExpenseMasterRouter };
