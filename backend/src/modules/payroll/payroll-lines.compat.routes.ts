import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";

export const payrollLinesCompatRouter = Router();
payrollLinesCompatRouter.use(requireAuth);

payrollLinesCompatRouter.get(
  "/runs/:id/lines",
  // payroll_head/super_admin/finance_head added 2026-08-25: this route (mounted before and
  // therefore shadowing payroll.routes.ts's own /runs/:id/lines) is what actually serves the
  // Payroll Validation Screen and the Overtime Management page's line-editing table, both of
  // which are designed for payroll_head. Without this, that role's own dedicated page 403s on
  // its main data fetch, indistinguishable from "no payroll data."
  //
  // payroll_admin/payroll_branch/payroll_hr/hr_head/accounts_head added 2026-08-28: these roles
  // are in PAYSLIP_CENTER_ROLES (frontend) so NativePayslipCenter is shown to them, but they
  // were rejected here with 403, making the page show "No lines found" for every run they
  // selected — the payslip center was "totally broken" for these roles.
  requireRole(
    "admin", "hr", "finance", "payroll", "payroll_head", "super_admin", "finance_head",
    "payroll_admin", "payroll_branch", "payroll_hr", "hr_head", "accounts_head",
  ),
  async (req, res, next) => {
    try {
      const page  = Math.max(1, parseInt(req.query.page  as string) || 1);
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit as string) || 200));
      const search = ((req.query.search as string) || "").trim();
      const offset = (page - 1) * limit;

      const searchExtra = search
        ? ` AND (spl.employee_code LIKE ? OR COALESCE(NULLIF(e.full_name, ''), CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, ''))) LIKE ?)`
        : "";
      const searchParams: unknown[] = search ? [`%${search}%`, `%${search}%`] : [];

      const [countRows] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS total
           FROM salary_prep_line spl
           LEFT JOIN employees e ON e.id = spl.employee_id
          WHERE spl.run_id = ?${searchExtra}`,
        [req.params.id, ...searchParams],
      );
      const total: number = (countRows as any[])[0]?.total ?? 0;

      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT spl.*,
                COALESCE(NULLIF(e.full_name, ''), CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, ''))) AS employee_name,
                spl.gross_salary AS gross_pay,
                spl.net_salary   AS net_pay,
                spl.professional_tax AS pt_amount,
                sp.id AS payslip_id,
                sp.acknowledged_at,
                CASE
                  WHEN sp.acknowledged_at IS NOT NULL THEN 'acknowledged'
                  WHEN sp.id IS NOT NULL THEN 'generated'
                  ELSE NULL
                END AS payslip_status
           FROM salary_prep_line spl
           LEFT JOIN employees e ON e.id = spl.employee_id
           LEFT JOIN salary_payslip sp ON sp.prep_line_id = spl.id
          WHERE spl.run_id = ?${searchExtra}
          ORDER BY spl.employee_code ASC
          LIMIT ? OFFSET ?`,
        [req.params.id, ...searchParams, limit, offset],
      );
      return res.json({ success: true, data: { lines: rows, total, page, limit } });
    } catch (error) {
      next(error);
    }
  },
);
