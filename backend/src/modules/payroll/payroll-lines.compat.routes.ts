import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";

export const payrollLinesCompatRouter = Router();
payrollLinesCompatRouter.use(requireAuth);

payrollLinesCompatRouter.get(
  "/runs/:id/lines",
  requireRole("admin", "hr", "finance", "payroll"),
  async (req, res, next) => {
    try {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT spl.*,
                COALESCE(NULLIF(e.full_name, ''), CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, ''))) AS employee_name,
                spl.gross_salary AS gross_pay,
                spl.net_salary AS net_pay,
                spl.professional_tax AS pt_amount,
                spl.tds AS tds_amount,
                sp.id AS payslip_id,
                sp.acknowledged_at,
                CASE
                  WHEN sp.acknowledged_at IS NOT NULL THEN 'acknowledged'
                  WHEN sp.id IS NOT NULL THEN 'generated'
                  ELSE NULL
                END AS payslip_status
           FROM salary_prep_line spl
           LEFT JOIN employees e ON e.id = spl.employee_id
           LEFT JOIN salary_payslip sp
             ON CONVERT(sp.prep_line_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
              = CONVERT(spl.id USING utf8mb4) COLLATE utf8mb4_unicode_ci
          WHERE spl.run_id = ?
          ORDER BY spl.employee_code ASC`,
        [req.params.id],
      );
      return res.json({ success: true, data: rows });
    } catch (error) {
      next(error);
    }
  },
);
