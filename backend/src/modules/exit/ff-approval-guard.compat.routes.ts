import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import { ffService } from "./ff.service.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

export const ffApprovalGuardCompatRouter = Router();
ffApprovalGuardCompatRouter.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

ffApprovalGuardCompatRouter.post(
  "/ff/:id/approve",
  requireRole("admin", "finance", "payroll"),
  h(async (req, res) => {
    const [ffRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, exit_request_id, is_ff_provisional, status
         FROM full_final_calculation
        WHERE id = ? LIMIT 1`,
      [req.params.id],
    );
    const ff = ffRows[0];
    if (!ff) return res.status(404).json({ success: false, message: "F&F calculation not found" });
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
