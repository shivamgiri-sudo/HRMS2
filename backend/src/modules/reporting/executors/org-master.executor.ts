/**
 * Organisation master executor
 *
 * Codes: cost-centre-master-report, process-master-report,
 *        headcount-by-cost-centre-and-process
 *
 * These three did not exist. The audit of 2026-08-07 found the platform had 927 cost
 * centres (573 active) and 131 processes (66 active) and no report on either of them,
 * while cost centre and process are the two dimensions the business declared mandatory on
 * every employee report. You could see a cost centre on a row and had no way to ask what
 * that cost centre was, who its client was, or how many people it carried.
 *
 * All three are aggregates — one row per cost centre, per process, or per pairing — so
 * they are exempt from the employee-grain identity spine by rowGrain, not by omission.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import type { ExecFilters, ExecScope, ExecOptions, ExecResult } from "./types.js";
import {
  appendScopeConditions,
  appendFilterConditions,
  applyPagination,
  fetchPageWithTotal,
  ReportScopeAccessDeniedError,
} from "./types.js";

async function query(sql: string, params: unknown[]): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(sql, params);
  return rows;
}

async function count(baseSql: string, params: unknown[]): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM (${baseSql}) AS _cnt`,
    params
  );
  return Number((rows as Array<{ total?: number }>)[0]?.total ?? 0);
}

/**
 * Branch scope applied to a master table's own branch_id.
 *
 * The employee-alias helper does not fit here: these queries are driven by the master
 * table, and a cost centre with no employees must still appear — that is half the point
 * of a master report. Scoping through the employee join instead would hide every empty
 * cost centre from a branch-restricted user and quietly turn a master list into a
 * headcount list.
 */
function appendMasterBranchScope(
  scope: ExecScope,
  clauses: string[],
  params: unknown[],
  column: string
): void {
  if (scope.branchScope.mode === "none") throw new ReportScopeAccessDeniedError("branchScope");
  if (scope.branchScope.mode === "restricted" && scope.branchScope.ids.length > 0) {
    clauses.push(`${column} IN (${scope.branchScope.ids.map(() => "?").join(",")})`);
    params.push(...scope.branchScope.ids);
  }
}

// ---------------------------------------------------------------------------
// cost-centre-master-report
//
// Verified against live 2026-08-07: 927 rows, headcount summing to 1,061 — exactly the
// number of active employees who resolve to a cost centre. The remaining 64 active
// employees have no cost centre and are listed by org-mapping-gaps.
//
// cost_centre_master.process_id is NULL on all 927 rows, so the cost centre's own process
// link tells you nothing. mapped_process is emitted anyway rather than hidden: an empty
// column that should be populated is a finding, and headcount-by-cost-centre-and-process
// derives the real pairing from where employees actually sit.
// ---------------------------------------------------------------------------
export async function costCentreMasterReport(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["cc.id IS NOT NULL"];
  const params: unknown[] = [];
  appendMasterBranchScope(scope, clauses, params, "cc.branch_id");

  if (filters.branchId) {
    clauses.push("cc.branch_id = ?");
    params.push(String(filters.branchId));
  }
  if (filters.costCentreId) {
    clauses.push("cc.id = ?");
    params.push(String(filters.costCentreId));
  }
  if (filters.status === "active")   clauses.push("cc.active_status = 1");
  if (filters.status === "inactive") clauses.push("cc.active_status = 0");

  const base = `
    SELECT cc.cost_centre_code,
           COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           cc.client_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(d.dept_name, 'UNASSIGNED') AS department_name,
           cc.cc_category,
           cc.cc_type,
           cc.tower,
           cc.status AS approval_status,
           CASE WHEN cc.active_status = 1 THEN 'ACTIVE' ELSE 'INACTIVE' END AS cost_centre_state,
           COUNT(DISTINCT e.id) AS active_headcount,
           COUNT(DISTINCT e.process_id) AS distinct_processes,
           cc.process_name_bill AS billing_process_name,
           p.process_name AS mapped_process,
           cc.go_live_date,
           cc.close_date
      FROM cost_centre_master cc
      LEFT JOIN branch_master b     ON b.id = cc.branch_id
      LEFT JOIN department_master d ON d.id = cc.department_id
      LEFT JOIN process_master p    ON p.id = cc.process_id
      LEFT JOIN employees e         ON e.cost_centre_id = cc.id AND e.active_status = 1
     WHERE ${clauses.join(" AND ")}
     GROUP BY cc.id, cc.cost_centre_code, cc.cost_centre_name, cc.client_name, b.branch_name,
              d.dept_name, cc.cc_category, cc.cc_type, cc.tower, cc.status, cc.active_status,
              cc.process_name_bill, p.process_name, cc.go_live_date, cc.close_date
     ORDER BY active_headcount DESC, cc.cost_centre_code ASC`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
}

// ---------------------------------------------------------------------------
// process-master-report
//
// Verified against live 2026-08-07: 131 rows, headcount summing to 982 — exactly the
// number of active employees who resolve to a process. The remaining 143 have none and
// are listed by org-mapping-gaps.
// ---------------------------------------------------------------------------
export async function processMasterReport(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["p.id IS NOT NULL"];
  const params: unknown[] = [];
  appendMasterBranchScope(scope, clauses, params, "p.branch_id");

  if (filters.branchId) {
    clauses.push("p.branch_id = ?");
    params.push(String(filters.branchId));
  }
  if (filters.processId) {
    clauses.push("p.id = ?");
    params.push(String(filters.processId));
  }
  if (filters.status === "active")   clauses.push("p.active_status = 1");
  if (filters.status === "inactive") clauses.push("p.active_status = 0");

  const base = `
    SELECT p.process_code,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           p.client_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           p.process_type,
           p.workload_type,
           p.business_lob,
           CASE WHEN p.active_status = 1 THEN 'ACTIVE' ELSE 'INACTIVE' END AS process_state,
           COUNT(DISTINCT e.id) AS active_headcount,
           COUNT(DISTINCT e.cost_centre_id) AS distinct_cost_centres,
           p.process_owner_name,
           p.sla_response_hours,
           p.sla_resolution_hours,
           p.close_date
      FROM process_master p
      LEFT JOIN branch_master b ON b.id = p.branch_id
      LEFT JOIN employees e     ON e.process_id = p.id AND e.active_status = 1
     WHERE ${clauses.join(" AND ")}
     GROUP BY p.id, p.process_code, p.process_name, p.client_name, b.branch_name,
              p.process_type, p.workload_type, p.business_lob, p.active_status,
              p.process_owner_name, p.sla_response_hours, p.sla_resolution_hours, p.close_date
     ORDER BY active_headcount DESC, p.process_code ASC`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
}

// ---------------------------------------------------------------------------
// headcount-by-cost-centre-and-process
//
// The cross-tab the mandate implies and which nothing produced. Driven from employees
// rather than from either master, so it reports where people actually sit — which is the
// only way to pair the two dimensions, given cost_centre_master.process_id is empty on
// all 927 rows.
//
// Verified against live 2026-08-07: 86 groups summing to 1,125 — every active employee,
// including the 64 with no cost centre and 143 with no process, which appear under
// UNASSIGNED rather than being dropped. A report that silently totalled 1,061 would look
// tidier and be wrong.
// ---------------------------------------------------------------------------
export async function headcountByCostCentreAndProcess(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.active_status = 1");

  const base = `
    SELECT COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(cc.client_name, p.client_name, 'UNKNOWN') AS client_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(d.dept_name, 'UNASSIGNED') AS department_name,
           COUNT(*) AS headcount,
           SUM(CASE WHEN e.cost_centre_id IS NULL OR e.process_id IS NULL THEN 1 ELSE 0 END)
             AS unmapped_in_group
      FROM employees e
      LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
      LEFT JOIN process_master p      ON p.id = e.process_id
      LEFT JOIN branch_master b       ON b.id = e.branch_id
      LEFT JOIN department_master d   ON d.id = e.department_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY cc.cost_centre_code, cc.cost_centre_name, p.process_name,
              COALESCE(cc.client_name, p.client_name, 'UNKNOWN'), b.branch_name, d.dept_name
     ORDER BY headcount DESC`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
}
