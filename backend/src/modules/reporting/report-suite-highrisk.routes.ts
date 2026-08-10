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
import {
  PAYROLL_RUN_STATUSES,
  PAYROLL_REGISTER_BODY,
  PAYROLL_VARIANCE_BODY,
  PAYSLIP_STATUS_BODY,
} from "./executors/payroll.executor.js";

export const reportSuiteHighRiskRouter = Router();
reportSuiteHighRiskRouter.use(requireAuth);
reportSuiteHighRiskRouter.use(reportScopeMiddleware);

const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
const roles = reportCatalogAccessMiddleware;
// Include all post-calculation statuses so reports show data regardless of approval stage
// "draft" is excluded — draft runs have no calculated lines yet
// Imported rather than declared here: this list decides which payroll runs every report on
// this router can see, and a second copy would eventually disagree with the executors.
const PAYROLL_STATUSES = [...PAYROLL_RUN_STATUSES];

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
function offsetParam(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * These four reports were unpageable, and said so in a way nobody could see.
 *
 * sendRows appended LIMIT and nothing else: no OFFSET, so every page returned the same first
 * rows, and no totalCount, so the grid fell back to `data.length` — see
 * `res.totalCount ?? res.meta?.totalCount ?? data.length` in ReportLibraryView. The UI then
 * computed totalPages = ceil(100/100) = 1.
 *
 * Measured on live 2026-08-08 with exactly what the UI sends (limit=100):
 *
 *   payroll-register    100 rows shown, "100 total"   actual 1,464 lines   93% understated
 *   employee-movement   100 rows shown, "100 total"   actual 2,196 rows    95% understated
 *   payroll-variance / payslip-status — same shape, same month, 1,464 each
 *
 * and requesting offset=100 returned a first row identical to offset=0, so the remaining rows
 * were unreachable by any means short of an export. A payroll register that silently shows 7%
 * of the run and labels it complete is the worst failure mode in this suite.
 *
 * The count follows the same rule as queryRowsWithCount in the sibling router: a short page
 * needs no COUNT because the total is already known, so the extra query is only paid when
 * there genuinely are more rows.
 */
async function sendRows(
  res: any, code: string, sql: string, params: unknown[],
  limit: number, meta: Record<string, unknown> = {}, offset = 0
) {
  const [raw] = await db.execute<RowDataPacket[]>(`${sql} LIMIT ${limit} OFFSET ${offset}`, params);

  // Drop the internal keyset column before the rows leave the server, exactly as the executors
  // do. It became visible here when payroll-register started sharing its SELECT with the
  // executor: the executor stripped _cursor and this did not, so the screen carried one column
  // the downloaded file did not and the two disagreed by a column that is not part of the
  // report at all.
  const rows = raw.map(({ _cursor: _cursor, ...rest }) => rest) as RowDataPacket[];

  let totalCount: number;
  if (rows.length < limit) {
    totalCount = offset + rows.length;
  } else {
    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM (${sql}) AS count_query`, params);
    totalCount = Number((countRows as Array<{ total?: number }>)[0]?.total ?? rows.length);
  }

  return res.json({
    success: true,
    code,
    data: rows,
    totalCount,
    meta: { count: rows.length, totalCount, limit, offset, highRiskRoute: true, ...meta },
  });
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
                      COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
                      COALESCE(d.dept_name, 'UNASSIGNED') AS department_name,
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
  return sendRows(res, "employee-movement", sql, [from, to, ...filterParams], limitParam(req.query.limit), {}, offsetParam(req.query.offset));
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
  // One SQL body, shared with the executor that serves the download. These were two
  // separately maintained SELECTs and they had drifted into different reports: this side
  // carried run_status, net_mismatch_amount and payroll_risk, the executor carried the
  // component breakdown plus employee_state, deduction_applied and line_flag, and neither
  // had the other's. Merged rather than one trimmed to the other, because both sets were
  // deliberate — see the note on PAYROLL_REGISTER_BODY.
  const sql = `${PAYROLL_REGISTER_BODY}
                WHERE ${clauses.join(" AND ")}
                ORDER BY employee_name`;
  return sendRows(res, "payroll-register", sql, params, limitParam(req.query.limit), { payrollStatuses: PAYROLL_STATUSES }, offsetParam(req.query.offset));
}));

reportSuiteHighRiskRouter.get("/payroll-variance", roles, h(async (req, res) => {
  const clauses: string[] = [];
  const params: unknown[] = [];
  addScopedEmployeeFilters(req, clauses, params);
  clauses.push("spr.run_month = ?"); params.push(await resolvePayrollMonth(req.query.month));
  clauses.push(payrollStatusClause("spr")); params.push(...PAYROLL_STATUSES);
  // Shared with the executor that serves the download — see PAYROLL_VARIANCE_BODY. The
  // status placeholders sit inside the previous-month JOIN, ahead of the WHERE, so the
  // status list is prepended to the parameters below.
  const sql = `${PAYROLL_VARIANCE_BODY.replace("__STATUS_PLACEHOLDERS__", PAYROLL_STATUSES.map(() => "?").join(","))}
                WHERE ${clauses.join(" AND ")}
                ORDER BY ABS(COALESCE(net_variance_pct,0)) DESC`;
  return sendRows(res, "payroll-variance", sql, [...PAYROLL_STATUSES, ...params], limitParam(req.query.limit), { payrollStatuses: PAYROLL_STATUSES }, offsetParam(req.query.offset));
}));

reportSuiteHighRiskRouter.get("/payslip-status", roles, h(async (req, res) => {
  const clauses: string[] = [];
  const params: unknown[] = [];
  addScopedEmployeeFilters(req, clauses, params);
  clauses.push("spr.run_month = ?"); params.push(await resolvePayrollMonth(req.query.month));
  clauses.push(payrollStatusClause("spr")); params.push(...PAYROLL_STATUSES);
  // Shared with the executor that serves the download — see PAYSLIP_STATUS_BODY. The union
  // of the two former shapes, which is also the only one carrying employee code, cost
  // centre and process together.
  const sql = `${PAYSLIP_STATUS_BODY}
                WHERE ${clauses.join(" AND ")}
                ORDER BY payslip_status DESC, employee_name`;
  return sendRows(res, "payslip-status", sql, params, limitParam(req.query.limit), { payrollStatuses: PAYROLL_STATUSES }, offsetParam(req.query.offset));
}));
