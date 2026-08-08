import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import {
  addScopedEmployeeFilters,
  reportCatalogAccessMiddleware,
  reportScopeMiddleware,
} from "./reporting-access.js";
import { db } from "../../db/mysql.js";
import { resolvePayrollMonth } from "./payroll-month.js";

export const reportSuiteHighRiskRouter = Router();
reportSuiteHighRiskRouter.use(requireAuth);
reportSuiteHighRiskRouter.use(reportScopeMiddleware);

const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
const roles = reportCatalogAccessMiddleware;
// Include all post-calculation statuses so reports show data regardless of approval stage
// "draft" is excluded — draft runs have no calculated lines yet
const PAYROLL_STATUSES = ["processing", "reviewed", "calculated", "approved", "locked", "disbursed", "finalized", "released", "paid"];

function dateParam(value: unknown, fallback: string) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}
function monthParam(value: unknown) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}$/.test(text) ? text : new Date().toISOString().slice(0, 7);
}
function limitParam(value: unknown) {
  const n = Number(value ?? 5000);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 20000) : 5000;
}
function payrollStatusClause(alias = "spr") {
  return `LOWER(${alias}.status) IN (${PAYROLL_STATUSES.map(() => "?").join(",")})`;
}
async function sendRows(res: any, code: string, sql: string, params: unknown[], limit: number, meta: Record<string, unknown> = {}) {
  const [rows] = await db.execute<RowDataPacket[]>(`${sql} LIMIT ${limit}`, params);
  return res.json({ success: true, code, data: rows, meta: { count: rows.length, limit, highRiskRoute: true, ...meta } });
}

reportSuiteHighRiskRouter.get("/employee-movement", roles, h(async (req, res) => {
  const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
  const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
  const clauses: string[] = [];
  const filterParams: unknown[] = [];
  addScopedEmployeeFilters(req, clauses, filterParams);
  clauses.push("(e.date_of_joining BETWEEN ? AND ? OR COALESCE(e.date_of_exit,e.date_of_leaving,e.resignation_date) BETWEEN ? AND ?)");
  filterParams.push(from, to, from, to);
  const sql = `SELECT e.employee_code,
                      COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                      e.date_of_joining,
                      COALESCE(e.date_of_exit,e.date_of_leaving,e.resignation_date) AS exit_date,
                      CASE WHEN e.date_of_joining BETWEEN ? AND ? THEN 'joining' ELSE 'exit' END AS movement_type,
                      b.branch_name, d.dept_name AS department_name,
                      COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
                      COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
                      COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name
                 FROM employees e
                 LEFT JOIN branch_master b ON b.id = e.branch_id AND COALESCE(b.active_status,1)=1
                 LEFT JOIN department_master d ON d.id = e.department_id AND COALESCE(d.active_status,1)=1
                 LEFT JOIN process_master p ON p.id = e.process_id AND COALESCE(p.active_status,1)=1
                 -- This router mounts ahead of report-suite.routes.ts, so it — not the inline
                 -- case block there, and not the executor — is what actually serves
                 -- employee-movement. Adding cost centre in the other two had no effect on the
                 -- response, which is how the three-layer shadowing was confirmed.
                 LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
                WHERE ${clauses.join(" AND ")}
                ORDER BY COALESCE(e.date_of_joining,e.date_of_exit,e.date_of_leaving,e.resignation_date) DESC`;
  return sendRows(res, "employee-movement", sql, [from, to, ...filterParams], limitParam(req.query.limit));
}));

// NOTE: "leave-balance" is deliberately NOT handled here.
//
// This router is mounted at /suite BEFORE reportSuiteRouter, so any handler
// defined here shadows the canonical catalog-driven route. It previously served
// leave-balance with its own one-row-per-employee-per-leave-type SQL, which
// silently overrode the canonical pivoted executor and returned the wrong shape.
//
// leave-balance now falls through to reportSuiteRouter's `/:code` handler, which
// applies the same reportScopeMiddleware + reportCatalogAccessMiddleware gate and
// dispatches to the canonical executor. Do not re-add a handler for it here.

reportSuiteHighRiskRouter.get("/payroll-register", roles, h(async (req, res) => {
  const clauses: string[] = [];
  const params: unknown[] = [];
  addScopedEmployeeFilters(req, clauses, params);
  clauses.push("spr.run_month = ?"); params.push(await resolvePayrollMonth(req.query.month));
  clauses.push(payrollStatusClause("spr")); params.push(...PAYROLL_STATUSES);
  const sql = `SELECT spr.run_month, spr.status AS run_status,
                      e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                      COALESCE(hcc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
                      COALESCE(hcc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
                      b.branch_name, p.process_name,
                      spl.gross_salary, spl.total_deductions, spl.net_salary, spl.working_days, spl.present_days, spl.leave_days, spl.lwp_days, spl.status AS line_status,
                      (COALESCE(spl.gross_salary,0) - COALESCE(spl.total_deductions,0) - COALESCE(spl.net_salary,0)) AS net_mismatch_amount,
                      CASE WHEN COALESCE(spl.net_salary,0) < 0 THEN 'NEGATIVE_NET'
                           WHEN ABS(COALESCE(spl.gross_salary,0) - COALESCE(spl.total_deductions,0) - COALESCE(spl.net_salary,0)) > 1 THEN 'NET_MISMATCH'
                           ELSE 'OK' END AS payroll_risk
                 FROM salary_prep_line spl
                 JOIN salary_prep_run spr ON spr.id = spl.run_id
                 JOIN employees e ON e.id = spl.employee_id
                 LEFT JOIN branch_master b ON b.id = e.branch_id
                 LEFT JOIN process_master p ON p.id = e.process_id
                 LEFT JOIN cost_centre_master hcc ON hcc.id = e.cost_centre_id
                WHERE ${clauses.join(" AND ")}
                ORDER BY employee_name`;
  return sendRows(res, "payroll-register", sql, params, limitParam(req.query.limit), { payrollStatuses: PAYROLL_STATUSES });
}));

reportSuiteHighRiskRouter.get("/payroll-variance", roles, h(async (req, res) => {
  const clauses: string[] = [];
  const params: unknown[] = [];
  addScopedEmployeeFilters(req, clauses, params);
  clauses.push("spr.run_month = ?"); params.push(await resolvePayrollMonth(req.query.month));
  clauses.push(payrollStatusClause("spr")); params.push(...PAYROLL_STATUSES);
  const sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                      COALESCE(hcc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
                      COALESCE(hcc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
                      COALESCE(hpm.process_name, 'UNASSIGNED') AS process_name,
                      spr.run_month, spl.net_salary AS current_net,
                      prev.net_salary AS previous_net,
                      ROUND(((spl.net_salary - COALESCE(prev.net_salary,0)) / NULLIF(prev.net_salary,0))*100,2) AS net_variance_pct,
                      spl.lwp_days,
                      CASE WHEN prev.id IS NULL THEN 'NO_PREVIOUS_MONTH'
                           WHEN ABS(ROUND(((spl.net_salary - COALESCE(prev.net_salary,0)) / NULLIF(prev.net_salary,0))*100,2)) >= 20 THEN 'HIGH_VARIANCE'
                           WHEN spl.net_salary < 0 THEN 'NEGATIVE_NET'
                           ELSE 'OK' END AS variance_status
                 FROM salary_prep_line spl
                 JOIN salary_prep_run spr ON spr.id = spl.run_id
                 JOIN employees e ON e.id = spl.employee_id
                 LEFT JOIN salary_prep_run pspr ON pspr.run_month = DATE_FORMAT(DATE_SUB(STR_TO_DATE(CONCAT(spr.run_month,'-01'),'%Y-%m-%d'), INTERVAL 1 MONTH),'%Y-%m')
                   AND ${payrollStatusClause("pspr")}
                 LEFT JOIN salary_prep_line prev ON prev.run_id = pspr.id AND prev.employee_id = spl.employee_id
                 LEFT JOIN cost_centre_master hcc ON hcc.id = e.cost_centre_id
                 LEFT JOIN process_master hpm ON hpm.id = e.process_id
                WHERE ${clauses.join(" AND ")}
                ORDER BY ABS(COALESCE(net_variance_pct,0)) DESC`;
  return sendRows(res, "payroll-variance", sql, [...PAYROLL_STATUSES, ...params], limitParam(req.query.limit), { payrollStatuses: PAYROLL_STATUSES });
}));

reportSuiteHighRiskRouter.get("/payslip-status", roles, h(async (req, res) => {
  const clauses: string[] = [];
  const params: unknown[] = [];
  addScopedEmployeeFilters(req, clauses, params);
  clauses.push("spr.run_month = ?"); params.push(await resolvePayrollMonth(req.query.month));
  clauses.push(payrollStatusClause("spr")); params.push(...PAYROLL_STATUSES);
  const sql = `SELECT spr.run_month, spr.status AS run_status,
                      e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                      sp.payslip_ref, sp.file_url, sp.acknowledged_at,
                      CASE WHEN sp.id IS NULL THEN 'NOT_GENERATED'
                           WHEN sp.acknowledged_at IS NULL THEN 'RELEASED_NOT_ACKNOWLEDGED'
                           ELSE 'ACKNOWLEDGED' END AS payslip_status
                 FROM salary_prep_line spl
                 JOIN salary_prep_run spr ON spr.id = spl.run_id
                 JOIN employees e ON e.id = spl.employee_id
                 LEFT JOIN salary_payslip sp ON sp.prep_line_id = spl.id
                WHERE ${clauses.join(" AND ")}
                ORDER BY payslip_status DESC, employee_name`;
  return sendRows(res, "payslip-status", sql, params, limitParam(req.query.limit), { payrollStatuses: PAYROLL_STATUSES });
}));
