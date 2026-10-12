import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import { ffService } from "./ff.service.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { guardExitEmployee } from "./exitScope.js";
import { hasAnyRole } from "../../shared/scopeAccess.js";
import { isFfApprovalPayrollHeadOnly } from "./ff-approval-authority.js";

export const ffApprovalGuardCompatRouter = Router();
ffApprovalGuardCompatRouter.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

ffApprovalGuardCompatRouter.post(
  "/ff/:id/approve",
  requireRole("admin", "finance", "payroll"),
  guardExitEmployee("id", "ff"),
  h(async (req, res) => {
    // Final authority: the Payroll Head approves every F&F (finance / payroll prepare and pay).
    // Kill switch: payroll_config_flags ff_approval_payroll_head_only = 'false'.
    if ((await isFfApprovalPayrollHeadOnly()) && !(await hasAnyRole(req.authUser!.id, "payroll_head"))) {
      return res.status(403).json({
        success: false,
        code: "FF_APPROVAL_PAYROLL_HEAD_ONLY",
        message: "Only the Payroll Head can approve an F&F settlement.",
      });
    }
    const [ffRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, exit_request_id, is_ff_provisional, status
         FROM full_final_calculation
        WHERE id = ? LIMIT 1`,
      [req.params.id],
    );
    const ff = ffRows[0];
    if (!ff) return res.status(404).json({ success: false, message: "F&F calculation not found" });
    // No longer a dead branch: markFfPaid (ff.service.ts) makes 'paid' reachable as of
    // migration 1220, so this guard can now actually fire.
    if (String(ff.status) === "paid") return res.status(400).json({ success: false, message: "F&F already paid" });

    const [clearanceRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS open_count
         FROM exit_clearance_task
        WHERE exit_request_id = ?
          AND status NOT IN ('cleared', 'waived')`,
      [ff.exit_request_id],
    );
    const openCount = Number(clearanceRows[0]?.open_count ?? 0);
    if (openCount > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot approve F&F. ${openCount} clearance task(s) are still open.`,
      });
    }

    if (Number(ff.is_ff_provisional) === 1) {
      return res.status(409).json({
        success: false,
        message: "Cannot approve F&F while statutory/settlement values are still provisional.",
      });
    }

    const data = await ffService.approveFF(req.params.id, req.authUser!.id, req);
    await logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: "FF_APPROVE_GUARDED",
      module_key: "exit",
      entity_type: "full_final_calculation",
      entity_id: req.params.id,
      change_summary: { exit_request_id: ff.exit_request_id },
      req,
    });
    return res.json({ success: true, data, message: "F&F approved" });
  }),
);
