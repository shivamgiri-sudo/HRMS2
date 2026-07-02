import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import { exitService } from "./exit.service.js";

export const exitStatusGuardCompatRouter = Router();
exitStatusGuardCompatRouter.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

const allowedTransitions: Record<string, string[]> = {
  draft: ["submitted", "revoked"],
  submitted: ["manager_review", "hr_review", "rejected", "revoked"],
  manager_review: ["hr_review", "rejected", "revoked"],
  hr_review: ["admin_review", "accepted", "rejected", "revoked"],
  admin_review: ["accepted", "rejected", "revoked"],
  accepted: ["notice_serving", "revoked"],
  notice_serving: ["exited", "revoked"],
  rejected: [],
  revoked: [],
  exited: [],
};

function normalize(status: unknown) {
  const value = String(status ?? "").trim();
  return value === "exit_confirmed" ? "exited" : value;
}

exitStatusGuardCompatRouter.patch(
  "/:id/status",
  requireRole("admin", "hr", "manager"),
  h(async (req, res) => {
    const nextStatus = normalize(req.body?.status);
    const remarks = String(req.body?.remarks ?? "").trim();
    if (!remarks) return res.status(400).json({ success: false, message: "Remarks are required" });

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, status FROM exit_request WHERE id = ? LIMIT 1`,
      [req.params.id],
    );
    const current = rows[0];
    if (!current) return res.status(404).json({ success: false, message: "Exit request not found" });

    const currentStatus = normalize(current.status);
    const allowed = allowedTransitions[currentStatus] ?? [];
    if (!allowed.includes(nextStatus)) {
      return res.status(409).json({
        success: false,
        message: `Invalid exit transition: ${currentStatus} → ${nextStatus}. Allowed: ${allowed.join(", ") || "none"}`,
      });
    }

    if (nextStatus === "exited") {
      const [openRows] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS open_count
           FROM exit_clearance_task
          WHERE exit_request_id = ?
            AND status NOT IN ('cleared', 'waived')`,
        [req.params.id],
      );
      const openCount = Number(openRows[0]?.open_count ?? 0);
      if (openCount > 0) {
        return res.status(409).json({
          success: false,
          message: `Cannot mark exited. ${openCount} clearance task(s) are still open.`,
        });
      }
    }

    const data = await exitService.updateExitStatus(req.params.id, nextStatus, remarks, req.authUser!.id);
    return res.json({ success: true, data, message: `Exit request moved to ${nextStatus}` });
  }),
);
