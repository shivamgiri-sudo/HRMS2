import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";

export const ffPreviewCompatRouter = Router();
ffPreviewCompatRouter.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

ffPreviewCompatRouter.get(
  "/ff/:exitRequestId/preview",
  requireRole("admin", "hr", "finance", "payroll"),
  h(async (req, res) => {
    const [exitRows] = await db.execute<RowDataPacket[]>(
      `SELECT er.id, er.employee_id, er.notice_period_days, er.last_working_day_proposed,
              e.employee_code,
              COALESCE(NULLIF(e.full_name, ''), CONCAT_WS(' ', e.first_name, e.last_name)) AS employee_name,
              e.ctc, e.date_of_joining
         FROM exit_request er
         LEFT JOIN employees e ON e.id = er.employee_id
        WHERE er.id = ? LIMIT 1`,
      [req.params.exitRequestId],
    );
    const exitReq = exitRows[0];
    if (!exitReq) return res.status(404).json({ success: false, message: "Exit request not found" });

    const [ffRows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM full_final_calculation WHERE exit_request_id = ? ORDER BY created_at DESC LIMIT 1`,
      [req.params.exitRequestId],
    );
    const ff = ffRows[0] ?? {};

    const earnedLeaveEncashment = Number(ff.earned_leave_encashment ?? 0);
    const gratuityAmount = Number(ff.gratuity_amount ?? 0);
    const salaryHold = Number(ff.salary_hold ?? 0);
    const noticeRecovery = Number(ff.notice_recovery ?? 0);
    const advancesRecovery = Number(ff.advances_recovery ?? 0);
    const grossSettlement = earnedLeaveEncashment + gratuityAmount + salaryHold;
    const recoveries = noticeRecovery + advancesRecovery;
    const calculatedNetPayable = Math.round((grossSettlement - recoveries) * 100) / 100;
    const manualNetPayable = ff.net_payable == null ? null : Number(ff.net_payable);
    const variance = manualNetPayable == null ? null : Math.round((manualNetPayable - calculatedNetPayable) * 100) / 100;

    return res.json({
      success: true,
      data: {
        exit_request_id: req.params.exitRequestId,
        employee_id: exitReq.employee_id,
        employee_code: exitReq.employee_code,
        employee_name: exitReq.employee_name,
        gross_settlement: grossSettlement,
        recoveries,
        calculated_net_payable: calculatedNetPayable,
        manual_net_payable: manualNetPayable,
        variance,
        is_variance_present: variance !== null && Math.abs(variance) > 1,
        components: {
          earned_leave_encashment: earnedLeaveEncashment,
          gratuity_amount: gratuityAmount,
          salary_hold: salaryHold,
          notice_recovery: noticeRecovery,
          advances_recovery: advancesRecovery,
        },
      },
    });
  }),
);
