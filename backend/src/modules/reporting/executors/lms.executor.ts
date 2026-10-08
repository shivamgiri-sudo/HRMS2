/**
 * LMS / Training executor
 *
 * Covers codes: training-completion-status
 *
 * Source: lms_learner_progress (250_lms_integration_schema.sql)
 * This table is synced from the external LMS via the integration layer.
 * It is the approved snapshot surface — no direct LMS DB write from here.
 *
 * companyId guard: lms_learner_progress uses employee_code as the join key;
 * scope is enforced via a sub-query join to mas_hrms.employees.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import type { ExecFilters, ExecScope, ExecOptions, ExecResult } from "./types.js";
import {
  appendScopeConditions,
  appendFilterConditions,
  applyPagination,
  fetchPageWithTotal,
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

// ---------------------------------------------------------------------------
// training-completion-status
// ---------------------------------------------------------------------------
export async function trainingCompletionStatus(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  // `employees` has no company_id column — this deployment is single-tenant, and
  // ExecScope.companyId is a hardcoded '1' placeholder (see resolveFullScope: "single-tenant;
  // extend when multi-tenant"). The clause therefore threw "Unknown column 'e.company_id' in
  // 'where clause'" and this report 500'd for everyone. Dropped rather than rewritten: there
  // is no tenant column to guard on, and row scope is enforced by appendScopeConditions below.
  // If multi-tenancy lands, the guard belongs there, applied uniformly, not re-added here.
  //
  // active_status = 1 is the agreed active definition and is REQUIRED here, not optional:
  // with the broken clause removed and nothing in its place the report returned all 58,627
  // employee rows ever created — the same 52x overstatement that cc_headcount had.
  const clauses: string[] = ["e.active_status = 1"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params, "e");
  appendFilterConditions(filters, clauses, params, "e");

  // The LMS sync does not carry a certification_status column into
  // lms_learner_progress, so this filter cannot be honoured. Fail loudly rather
  // than dropping the clause, which would return unfiltered rows that look filtered.
  if (filters.status) {
    throw new Error(
      "training-completion-status: the 'status' filter is unavailable — certification status is not synced from the LMS into lms_learner_progress."
    );
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           llp.batch_no,
           llp.batch_name,
           -- course_completion_pct, mcq_pass_status, attendance_pct,
           -- certification_status and last_activity_date are NOT synced from the
           -- deployed LMS into lms_learner_progress. They are reported as NULL
           -- (not tracked) instead of 0, which would read as a real measurement,
           -- and instead of being selected outright, which broke the whole report.
           NULL                                       AS course_completion_pct,
           COALESCE(llp.mcq_best_score, 0)            AS mcq_best_score,
           NULL                                       AS mcq_pass_status,
           NULL                                       AS attendance_pct,
           NULL                                       AS certification_status,
           COALESCE(llp.readiness_score, 0)           AS readiness_score,
           llp.attrition_risk_signal,
           llp.ops_handover_ready,
           NULL                                       AS last_activity_date,
           llp.synced_at
      FROM employees e
      LEFT JOIN lms_learner_progress llp
             ON llp.employee_code COLLATE utf8mb4_unicode_ci
              = e.employee_code   COLLATE utf8mb4_unicode_ci
      LEFT JOIN branch_master b          ON b.id = e.branch_id
      LEFT JOIN process_master p         ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY e.id ASC`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}
