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

// finance_head/payroll_head/payroll_admin added 2026-08-14 (delta-audit, Stage 7
// follow-up): absent from this file since it was created (16-Jun-2026), even though
// all three roles already existed by then or shortly after, and are the standard
// payroll-operator tier used across 20+ other live payroll routes (identical
// composition already live as PAYROLL_REPORT_SCOPE_ROLES in
// payroll-extended.routes.ts's GET /runs/:id/salary-sheet-export, gated the same
// allowCeoAllRead-omitted way). git history shows no commit or comment ever
// justified their absence — the 31-Jul-2026 CEO fix (see below) touched only
// ceo/allowCeoAllRead and left this array otherwise untouched. Confirmed live before
// fixing: 3 real accounts holding finance_head/payroll_head/payroll_admin (without
// also holding admin/hr/finance/payroll) were 403'd from both endpoints, including
// the organisation's only payroll_head. super_admin added to requireRole only, not
// to this scope-roles array — matching every other live payroll route's convention
// (super_admin/admin bypass via allowAdminBypass and requireRole's own unconditional
// super_admin fast-path, so it never belongs in a scope-roles array).
const PAYROLL_READ_SCOPE_ROLES = ["hr", "finance", "payroll", "finance_head", "payroll_head", "payroll_admin"];

// `ceo` removed 31-Jul-2026 (CEO UAT, Critical).
//
// These two endpoints returned org-wide payroll to a CEO token — every run, every
// branch, back to 2023 on /runs, and employee-level gross/net/deductions on
// /records — because allowCeoAllRead resolves the scope clause to `1=1`. The
// /payroll/payslips page then rendered that data underneath an "Access denied"
// banner raised by a *different* endpoint (payroll-lines.compat.routes.ts, which
// never allowed ceo), so the UI looked broken while the data was genuinely served.
//
// Policy decision: the CEO sees their own payslip, not the organisation's payroll.
// This matches the project charter rule against exposing payroll, salary, tax, PF,
// UAN or bank data through management surfaces.
//
// Note this is deliberately narrow. `allowCeoAllRead` stays true elsewhere (~25
// call sites across employees, leave, exit, ATS and WFM) where org-wide CEO read
// is intended; payroll is the exception, so it is switched off here rather than in
// shared/scopeAccess.ts. requireRole already blocks the CEO before scope is
// evaluated — the flag is set false as defence in depth, not as the only gate.
// `ceo` is still deliberately absent below — nothing about the 2026-08-14 role-list
// widening changes the basis for this policy: no live user holds `ceo` together
// with any of the newly-added roles (verified live), and this list has no effect on
// allowCeoAllRead regardless (that flag keys off the caller's own role set, not this
// array — see shared/scopeAccess.ts).
router.get("/runs", requireRole(
  "admin", "super_admin", "hr", "finance", "payroll", "finance_head", "payroll_head", "payroll_admin",
), h(async (req, res) => {
  const scoped = await buildScopeWhereClause(
    req.authUser!.id,
    PAYROLL_READ_SCOPE_ROLES,
    {
      branchId: "spr.branch_id",
      processId: "spr.process_id",
    },
    { allowAdminBypass: true, allowCeoAllRead: false },
  );
  (req as any).scopeFilter = scoped;
  return c.listRuns(req, res);
}));

// `ceo` removed — see the note on /runs above. This one is the more sensitive of
// the pair: it returns employee-level gross, net and deductions. Role list widened
// 2026-08-14 for the same reason as /runs above.
router.get("/records", requireRole(
  "admin", "super_admin", "hr", "finance", "payroll", "finance_head", "payroll_head", "payroll_admin",
), h(async (req, res) => {
  const scoped = await buildScopeWhereClause(
    req.authUser!.id,
    PAYROLL_READ_SCOPE_ROLES,
    {
      branchId: "e.branch_id",
      processId: "e.process_id",
    },
    { allowAdminBypass: true, allowCeoAllRead: false },
  );

  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const limit = Math.min(Math.max(1, Number(req.query.limit ?? 50) || 50), 1000);
  const offset = (page - 1) * limit;
  const conds: string[] = [];
  const params: unknown[] = [];

  if (req.query.runMonth) { conds.push("spr.run_month = ?"); params.push(String(req.query.runMonth)); }
  if (req.query.status) {
    const normalizedStatus = String(req.query.status).trim().toLowerCase();
    if (normalizedStatus === "paid") {
      conds.push("LOWER(COALESCE(spr.status, '')) IN ('disbursed', 'finalized', 'finalised', 'paid')");
    } else if (normalizedStatus === "processing") {
      conds.push("(LOWER(COALESCE(spr.status, '')) IN ('processing', 'reviewed', 'approved', 'locked') OR LOWER(COALESCE(spl.status, '')) = 'calculated')");
    } else if (normalizedStatus === "pending") {
      conds.push("(LOWER(COALESCE(spr.status, '')) NOT IN ('disbursed', 'finalized', 'finalised', 'paid', 'processing', 'reviewed', 'approved', 'locked') AND LOWER(COALESCE(spl.status, '')) <> 'calculated')");
    } else {
      conds.push("(LOWER(COALESCE(spr.status, '')) = ? OR LOWER(COALESCE(spl.status, '')) = ?)");
      params.push(normalizedStatus, normalizedStatus);
    }
  }
  if (req.query.branchId) { conds.push("e.branch_id = ?"); params.push(String(req.query.branchId)); }
  if (req.query.processId) { conds.push("e.process_id = ?"); params.push(String(req.query.processId)); }
  if (req.query.departmentId) { conds.push("e.department_id = ?"); params.push(String(req.query.departmentId)); }
  if (req.query.costCentreId || req.query.costCenterId) {
    conds.push("e.cost_centre_id = ?");
    params.push(String(req.query.costCentreId ?? req.query.costCenterId));
  }
  if (req.query.search) {
    const escaped = String(req.query.search).replace(/[%_\\]/g, ch => "\\" + ch);
    conds.push(
      "(e.employee_code LIKE ? ESCAPE '\\\\' OR e.full_name LIKE ? ESCAPE '\\\\' OR e.email LIKE ? ESCAPE '\\\\'" +
      " OR CONCAT(COALESCE(e.first_name,''),' ',COALESCE(e.last_name,'')) LIKE ? ESCAPE '\\\\')"
    );
    const s = `%${escaped}%`;
    params.push(s, s, s, s);
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
             COALESCE(spl.leave_days, 0) AS leave_days,
             COALESCE(spl.lwp_days, 0) AS lwp_days,
             COALESCE(spl.paid_working_days, 0) AS paid_working_days,
             COALESCE(spl.eligible_weekoff_days, 0) AS eligible_weekoff_days,
             COALESCE(spl.eligible_holiday_days, 0) AS eligible_holiday_days,
             COALESCE(spl.final_payable_days, 0) AS final_payable_days,
             COALESCE(spl.active_calendar_days, 0) AS active_calendar_days,
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
