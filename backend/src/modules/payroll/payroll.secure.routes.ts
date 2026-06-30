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

  if (scoped.sql === "1=0") {
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const limit = Math.min(Math.max(1, Number(req.query.limit ?? 500) || 500), 1000);
    return res.json({ success: true, data: [], total: 0, page, limit });
  }

  const page   = Math.max(1, Number(req.query.page  ?? 1)   || 1);
  const limit  = Math.min(Math.max(1, Number(req.query.limit ?? 500) || 500), 1000);
  const offset = (page - 1) * limit;

  // Month bounds — used for ARM 2 attendance aggregation and inactive-employee date check
  const targetMonth = req.query.runMonth
    ? String(req.query.runMonth)
    : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const [tYr, tMo] = targetMonth.split("-").map(Number);
  const monthStart  = `${targetMonth}-01`;
  const daysInMonth = new Date(tYr, tMo, 0).getDate();
  const monthEnd    = `${targetMonth}-${String(daysInMonth).padStart(2, "0")}`;

  const scopeClause = String(scoped.sql).replace(/^WHERE\s+/i, "").trim();

  // ─── ARM 1 conditions (salary_prep_line rows from existing runs) ─────────────
  const conds: string[] = [];
  const params: unknown[] = [];

  if (req.query.runMonth) { conds.push("spr.run_month = ?"); params.push(String(req.query.runMonth)); }
  if (req.query.status)   { conds.push("spr.status = ?");    params.push(String(req.query.status)); }
  if (req.query.branchId) { conds.push("e.branch_id = ?");   params.push(String(req.query.branchId)); }
  if (req.query.processId){ conds.push("e.process_id = ?");  params.push(String(req.query.processId)); }
  if (req.query.costCentreId || req.query.costCenterId) {
    conds.push("e.cost_centre_id = ?");
    params.push(String(req.query.costCentreId ?? req.query.costCenterId));
  }
  if (req.query.search) {
    const like = `%${String(req.query.search)}%`;
    conds.push("(e.full_name LIKE ? OR COALESCE(spl.employee_code, e.employee_code) LIKE ? OR e.email LIKE ?)");
    params.push(like, like, like);
  }
  if (scopeClause && scopeClause !== "1=1") {
    conds.push(`(${scopeClause})`);
    params.push(...(scoped.params || []));
  }
  const where1 = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  // ─── ARM 2 conditions (employees with salary assignment + attendance, no run yet) ──
  const conds2: string[] = [
    // Include active employees OR inactive employees who left this month (worked partial month)
    `(
      (LOWER(e.employment_status) = 'active' AND e.active_status = 1)
      OR (LOWER(e.employment_status) = 'inactive' AND e.date_of_leaving BETWEEN ? AND ?)
    )`,
    // Exclude employees already in a run for this month (the INNER JOIN att_agg handles "no attendance" exclusion)
    `e.id NOT IN (
      SELECT DISTINCT spl_x.employee_id
        FROM salary_prep_line spl_x
        JOIN salary_prep_run spr_x ON spr_x.id = spl_x.run_id
       WHERE spr_x.run_month = ?
    )`,
  ];
  // Arm 2 params must follow the ? order in the SQL string (WHERE clause comes after JOIN att_agg)
  const params2: unknown[] = [monthStart, monthEnd, targetMonth];

  if (scopeClause && scopeClause !== "1=1") {
    conds2.push(`(${scopeClause})`);
    params2.push(...(scoped.params || []));
  }
  if (req.query.branchId)  { conds2.push("e.branch_id = ?");   params2.push(String(req.query.branchId)); }
  if (req.query.processId) { conds2.push("e.process_id = ?");  params2.push(String(req.query.processId)); }
  if (req.query.costCentreId || req.query.costCenterId) {
    conds2.push("e.cost_centre_id = ?");
    params2.push(String(req.query.costCentreId ?? req.query.costCenterId));
  }
  if (req.query.search) {
    const like = `%${String(req.query.search)}%`;
    conds2.push("(e.full_name LIKE ? OR e.employee_code LIKE ? OR e.email LIKE ?)");
    params2.push(like, like, like);
  }
  // ARM 2 employees have no run — their status is "pending". Exclude when filtering for other statuses.
  if (req.query.status && String(req.query.status) !== "pending") {
    conds2.push("1=0");
  }
  const where2 = conds2.length ? `WHERE ${conds2.join(" AND ")}` : "";

  // ─── UNION query: run-based rows + attendance-estimated rows ─────────────────
  //
  // Params order for the full query:
  //   [...params (arm1 WHERE)]
  //   [targetMonth (? AS run_month in arm2 SELECT)]
  //   [monthStart, monthEnd (att_agg JOIN in arm2 FROM)]
  //   [...params2 (arm2 WHERE)]
  //
  const baseQuery = `
    FROM (
      -- ARM 1: employees already processed in a salary prep run
      SELECT spl.id,
             spl.run_id,
             spl.employee_id,
             COALESCE(spl.employee_code, e.employee_code)                                                                    AS employee_code,
             COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))), spl.employee_code) AS employee_name,
             e.email                                                                                                          AS employee_email,
             e.avatar_url                                                                                                     AS employee_avatar,
             bm.branch_name,
             pm.process_name,
             dm.dept_name                                                                                                     AS department_name,
             ccm.cost_centre_name,
             spr.run_month,
             spr.status                                                                                                       AS run_status,
             spr.disbursed_at,
             spl.status                                                                                                       AS line_status,
             COALESCE(spl.basic, 0)                                                                                          AS basic,
             COALESCE(spl.hra, 0)                                                                                            AS hra,
             COALESCE(spl.special_allowance, 0)                                                                              AS special_allowance,
             COALESCE(spl.gross_salary, 0)                                                                                   AS gross_salary,
             COALESCE(spl.total_deductions, 0)                                                                               AS total_deductions,
             COALESCE(spl.net_salary, 0)                                                                                     AS net_salary,
             COALESCE(spl.working_days, 0)                                                                                   AS working_days,
             COALESCE(spl.present_days, 0)                                                                                   AS present_days,
             COALESCE(spl.lwp_days, 0)                                                                                       AS lwp_days,
             ROW_NUMBER() OVER (
               PARTITION BY spr.run_month, spl.employee_id
               ORDER BY spr.created_at DESC, spl.id DESC
             )                                                                                                                AS rn
        FROM salary_prep_line spl
        JOIN salary_prep_run spr ON spr.id = spl.run_id
        LEFT JOIN employees e             ON e.id = spl.employee_id
        LEFT JOIN branch_master bm        ON bm.id = e.branch_id
        LEFT JOIN process_master pm       ON pm.id = e.process_id
        LEFT JOIN department_master dm    ON dm.id = e.department_id
        LEFT JOIN cost_centre_master ccm  ON ccm.id = e.cost_centre_id
        ${where1}

      UNION ALL

      -- ARM 2: employees with active salary assignment + attendance this month, not yet in a run
      -- Salary is estimated (prorated from attendance: present_days / working_days × monthly CTC)
      SELECT NULL                                                                                                             AS id,
             NULL                                                                                                             AS run_id,
             e.id                                                                                                             AS employee_id,
             e.employee_code,
             COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))), e.employee_code) AS employee_name,
             e.email                                                                                                          AS employee_email,
             e.avatar_url                                                                                                     AS employee_avatar,
             bm.branch_name,
             pm.process_name,
             dm.dept_name                                                                                                     AS department_name,
             ccm.cost_centre_name,
             ?                                                                                                                AS run_month,
             NULL                                                                                                             AS run_status,
             NULL                                                                                                             AS disbursed_at,
             'estimated'                                                                                                      AS line_status,
             COALESCE(ROUND((esa.ctc_annual / 12.0) * (ss.basic_pct / 100.0)
               * COALESCE(att_agg.present_days, 0) / NULLIF(att_agg.working_days, 0), 2), 0)                                AS basic,
             COALESCE(ROUND((esa.ctc_annual / 12.0) * (ss.hra_pct / 100.0)
               * COALESCE(att_agg.present_days, 0) / NULLIF(att_agg.working_days, 0), 2), 0)                                AS hra,
             COALESCE(ROUND((esa.ctc_annual / 12.0) * GREATEST(0.0, 1.0 - ss.basic_pct / 100.0 - ss.hra_pct / 100.0)
               * COALESCE(att_agg.present_days, 0) / NULLIF(att_agg.working_days, 0), 2), 0)                                AS special_allowance,
             COALESCE(ROUND((esa.ctc_annual / 12.0)
               * COALESCE(att_agg.present_days, 0) / NULLIF(att_agg.working_days, 0), 2), 0)                                AS gross_salary,
             0                                                                                                                AS total_deductions,
             COALESCE(ROUND((esa.ctc_annual / 12.0)
               * COALESCE(att_agg.present_days, 0) / NULLIF(att_agg.working_days, 0), 2), 0)                                AS net_salary,
             COALESCE(att_agg.working_days, 0)                                                                               AS working_days,
             COALESCE(att_agg.present_days, 0)                                                                               AS present_days,
             COALESCE(att_agg.lwp_days, 0)                                                                                   AS lwp_days,
             1                                                                                                                AS rn
        FROM employees e
        -- Most recent active salary assignment per employee
        JOIN (
          SELECT employee_id, ctc_annual, structure_id,
                 ROW_NUMBER() OVER (PARTITION BY employee_id ORDER BY effective_from DESC, id DESC) AS esa_rn
            FROM employee_salary_assignment
           WHERE active_status = 1
        ) esa ON esa.employee_id = e.id AND esa.esa_rn = 1
        JOIN salary_structure_master ss ON ss.id = esa.structure_id
        -- Attendance summary for target month (INNER JOIN: excludes employees with no attendance)
        JOIN (
          SELECT employee_id,
                 COUNT(CASE WHEN attendance_status NOT IN ('week_off', 'holiday') THEN 1 END)                       AS working_days,
                 COALESCE(SUM(CASE WHEN attendance_status = 'present'  THEN 1.0
                                   WHEN attendance_status = 'half_day' THEN 0.5
                                   ELSE 0 END), 0)                                                                  AS present_days,
                 COALESCE(SUM(lwp_value), 0)                                                                        AS lwp_days
            FROM attendance_daily_record
           WHERE record_date BETWEEN ? AND ?
           GROUP BY employee_id
        ) att_agg ON att_agg.employee_id = e.id
        LEFT JOIN branch_master bm        ON bm.id = e.branch_id
        LEFT JOIN process_master pm       ON pm.id = e.process_id
        LEFT JOIN department_master dm    ON dm.id = e.department_id
        LEFT JOIN cost_centre_master ccm  ON ccm.id = e.cost_centre_id
        ${where2}
    ) ranked
    WHERE ranked.rn = 1`;

  // Params: arm1 WHERE + arm2 (? AS run_month, att_agg BETWEEN, arm2 WHERE)
  const allParams: unknown[] = [
    ...params,
    targetMonth,
    monthStart, monthEnd,
    ...params2,
  ];

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * ${baseQuery} ORDER BY run_month DESC, employee_code ASC LIMIT ${limit} OFFSET ${offset}`,
    allParams,
  );
  const [countRows] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total ${baseQuery}`, allParams);

  return res.json({ success: true, data: rows, total: Number(countRows[0]?.total ?? 0), page, limit });
}));

export { router as payrollSecureRouter };
