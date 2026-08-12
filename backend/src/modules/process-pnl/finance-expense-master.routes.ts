/**
 * NOT MOUNTED. Editing this file changes nothing that runs.
 * ============================================================
 *
 * This router exports five endpoints — GET /expense-masters, POST /expense-heads, POST
 * /expense-sub-heads, DELETE /expense-heads/:id and DELETE /expense-sub-heads/:id — and NOTHING
 * IMPORTS IT. A repo-wide search for `financeExpenseMasterRouter` and for this filename returns
 * only its own export line.
 *
 * The live implementations of those same five paths are inline in
 * backend/src/modules/finance/grn.routes.ts (grNExpenseMasterRoutes), which IS mounted, at
 * /api/finance. Requests reach those; they never reach these.
 *
 * The guards here are currently equivalent to the live ones — same READ/WRITE/EDIT role lists,
 * same requireWriteAccess, same Super-Admin-only rule for editing an existing head. That makes
 * this a maintenance trap rather than a security one: someone hardening expense-master access
 * would naturally find THIS file, because it is the one that looks purpose-built for the job,
 * change it, verify nothing, and ship a fix that cannot take effect. The two copies are also
 * free to drift apart silently, since no test compares them.
 *
 * It is left in place rather than deleted because deleting a route module is not this session's
 * call to make — but it must not read as live code. If you need to change expense-master
 * behaviour, change grn.routes.ts. If you intend to mount this instead and retire the inline
 * copies, that is a deliberate migration: delete the inline ones in the same change, or the two
 * will both answer and Express will silently pick whichever registered first.
 *
 * finance-expense-master.service.ts, which this imports, IS live — grn.routes.ts uses it too.
 */

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
/** Editing or deleting a head/sub-head that budgets already reference is Super Admin only. */
const EDIT_ROLES = ["super_admin"] as const;

function isSuperAdmin(req: AuthenticatedRequest) {
  return [req.authUser?.role, ...(req.userRoles ?? [])]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase() === "super_admin");
}

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
      if (req.body?.id && !isSuperAdmin(req)) {
        res.status(403).json({
          success: false,
          error: "Only a Super Admin can edit an existing expense head",
        });
        return;
      }
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
      if (req.body?.id && !isSuperAdmin(req)) {
        res.status(403).json({
          success: false,
          error: "Only a Super Admin can edit an existing expense sub-head",
        });
        return;
      }
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

router.delete(
  "/expense-heads/:id",
  requireWriteAccess,
  requireRole(...EDIT_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const data = await financeExpenseMasterService.deleteHead(
        req.params.id,
        req.authUser.id
      );
      res.json({ success: true, data });
    } catch (error: unknown) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : "Unable to delete expense head",
      });
    }
  }
);

router.delete(
  "/expense-sub-heads/:id",
  requireWriteAccess,
  requireRole(...EDIT_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const data = await financeExpenseMasterService.deleteSubHead(
        req.params.id,
        req.authUser.id
      );
      res.json({ success: true, data });
    } catch (error: unknown) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : "Unable to delete expense sub-head",
      });
    }
  }
);

export { router as financeExpenseMasterRouter };
