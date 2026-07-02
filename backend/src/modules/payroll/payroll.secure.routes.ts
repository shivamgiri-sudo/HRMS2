import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";
import { payrollController as c } from "./payroll.controller.js";

const router = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

const PAYROLL_READ_SCOPE_ROLES = ["hr", "finance", "payroll"];

router.get("/runs", requireRole("admin", "hr", "finance", "payroll", "ceo"), h(async (req, res) => {
  const scoped = await buildScopeWhereClause(
    req.authUser!.id,
    PAYROLL_READ_SCOPE_ROLES,
    {
      branchId: "spr.branch_id",
      processId: "spr.process_id",
    },
    { allowAdminBypass: true, allowCeoAllRead: true },
  );
  (req as any).scopeFilter = scoped;
  return c.listRuns(req, res);
}));

router.get("/records", requireRole("admin", "hr", "finance", "payroll", "ceo"), h(async (req, res) => {
  const scoped = await buildScopeWhereClause(
    req.authUser!.id,
    PAYROLL_READ_SCOPE_ROLES,
    {
      branchId: "e.branch_id",
      processId: "e.process_id",
    },
    { allowAdminBypass: true, allowCeoAllRead: true },
  );

  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const limit = Math.min(Math.max(1, Number(req.query.limit ?? 500) || 500), 1000);
  const offset = (page - 1) * limit;
  const conds: string[] = [];
  const params: unknown[] = [];

  if (req.query.runMonth) { conds.push("spr.run_month = ?"); params.push(String(req.query.runMonth)); }
  if (req.query.status) { conds.push("spr.status = ?"); params.push(String(req.query.status)); }
  if (req.query.branchId) { conds.push("e.branch_id = ?"); params.push(String(req.query.branchId)); }
  if (req.query.processId) { conds.push("e.process_id = ?"); params.push(String(req.query.processId)); }
  if (req.query.costCentreId || req.query.costCenterId) {
    conds.push("e.cost_centre_id = ?");
    params.push(String(req.query.costCentreId ?? req.query.costCenterId));
  }

  const scopeClause = String(scoped.sql).replace(/^WHERE\s+/i, "").trim();
  if (scopeClause) {
    conds.push(`(${scopeClause})`);
    params.push(...(scoped.params || []));
  }

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const baseQuery = `
    FROM (
      SELECT spl.id,
             spl.run_id,
             spl.employee_id,
             COALESCE(spl.employee_code, e.employee_code) AS employee_code,
             COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))), spl.employee_code) AS employee_name,
             e.email AS employee_email,
             e.avatar_url AS employee_avatar,
             bm.branch_name,
             pm.process_name,
             dm.dept_name AS department_name,
             ccm.cost_centre_name,
             spr.run_month,
             spr.status AS run_status,
             spr.disbursed_at,
             spl.status AS line_status,
             COALESCE(spl.basic, 0) AS basic,
             COALESCE(spl.hra, 0) AS hra,
             COALESCE(spl.special_allowance, 0) AS special_allowance,
             COALESCE(spl.gross_salary, 0) AS gross_salary,
             COALESCE(spl.total_deductions, 0) AS total_deductions,
             COALESCE(spl.net_salary, 0) AS net_salary,
             COALESCE(spl.working_days, 0) AS working_days,
             COALESCE(spl.present_days, 0) AS present_days,
             COALESCE(spl.lwp_days, 0) AS lwp_days,
             ROW_NUMBER() OVER (
               PARTITION BY spr.run_month, spl.employee_id
               ORDER BY spr.created_at DESC, spl.id DESC
             ) AS rn
        FROM salary_prep_line spl
        JOIN salary_prep_run spr ON spr.id = spl.run_id
        LEFT JOIN employees e ON e.id = spl.employee_id
        LEFT JOIN branch_master bm ON bm.id = e.branch_id
        LEFT JOIN process_master pm ON pm.id = e.process_id
        LEFT JOIN department_master dm ON dm.id = e.department_id
        LEFT JOIN cost_centre_master ccm ON ccm.id = e.cost_centre_id
        ${where}
    ) ranked
    WHERE ranked.rn = 1`;

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * ${baseQuery}
      ORDER BY run_month DESC, employee_code ASC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const [countRows] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total ${baseQuery}`, params);

  return res.json({ success: true, data: rows, total: Number(countRows[0]?.total ?? 0), page, limit });
}));

export { router as payrollSecureRouter };
