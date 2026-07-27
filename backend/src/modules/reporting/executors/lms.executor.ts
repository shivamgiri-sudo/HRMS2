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
  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
  appendScopeConditions(scope, clauses, params, "e");
  appendFilterConditions(filters, clauses, params, "e");

  if (filters.status) {
    clauses.push("llp.certification_status = ?");
    params.push(String(filters.status));
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           b.branch_name,
           p.process_name,
           llp.batch_no,
           llp.batch_name,
           COALESCE(llp.course_completion_pct, 0)    AS course_completion_pct,
           COALESCE(llp.mcq_best_score, 0)            AS mcq_best_score,
           llp.mcq_pass_status,
           COALESCE(llp.attendance_pct, 0)            AS attendance_pct,
           llp.certification_status,
           COALESCE(llp.readiness_score, 0)           AS readiness_score,
           llp.attrition_risk_signal,
           llp.ops_handover_ready,
           llp.last_activity_date,
           llp.synced_at
      FROM employees e
      LEFT JOIN lms_learner_progress llp ON llp.employee_code = e.employee_code
      LEFT JOIN branch_master b          ON b.id = e.branch_id
      LEFT JOIN process_master p         ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY e.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}
