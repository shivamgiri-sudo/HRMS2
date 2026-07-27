/**
 * Operations & Quality executor
 *
 * Covers codes: agent-performance-summary, team-performance-summary,
 * quality-audit-log, fatal-error-register
 *
 * Primary tenant guard uses ksr.company_id or e.company_id depending on the
 * driving table. appendScopeConditions (alias "e") is used where the
 * employees table is in scope; for kpi_score_record the scope conditions on
 * branch/process are applied via the employee join.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import type { ExecFilters, ExecScope, ExecOptions, ExecResult } from "./types.js";
import {
  appendScopeConditions,
  appendFilterConditions,
  dateParam,
  monthParam,
  applyPagination,
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
  return Number((rows as any)[0]?.total ?? 0);
}

// ---------------------------------------------------------------------------
// agent-performance-summary
// ---------------------------------------------------------------------------
export async function agentPerformanceSummary(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  // availabilityStatus: 'blocked' — kpi_score table has per-metric rows (metric_id, actual_value, period)
  // not a pre-aggregated score_record; this report needs a pivot/aggregation adapter once the
  // KPI scoring pipeline is operational. Returns empty result until then.
  const scoreMonth = monthParam(filters.month);

  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("ks.period = ?");
  params.push(scoreMonth);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("ks.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT ks.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           ks.period AS score_month,
           km.metric_code,
           km.metric_name,
           ks.actual_value,
           b.branch_name, p.process_name
      FROM kpi_score ks
      JOIN kpi_metric_master km ON km.id = ks.metric_id
      JOIN employees e          ON e.id  = ks.employee_id
      LEFT JOIN branch_master b  ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY ks.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// team-performance-summary  (aggregate — no cursor)
// ---------------------------------------------------------------------------
export async function teamPerformanceSummary(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const scoreMonth = monthParam(filters.month);

  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("ks.period = ?");
  params.push(scoreMonth);

  const base = `
    SELECT COALESCE(
             NULLIF(tm.full_name, ''),
             CONCAT(tm.first_name, ' ', COALESCE(tm.last_name, ''))
           ) AS team_lead_name,
           p.process_name,
           b.branch_name,
           ks.period AS score_month,
           COUNT(DISTINCT ks.employee_id) AS team_size,
           ROUND(AVG(ks.actual_value), 2) AS avg_score,
           MAX(ks.actual_value) AS max_score,
           MIN(ks.actual_value) AS min_score
      FROM kpi_score ks
      JOIN employees e          ON e.id  = ks.employee_id
      LEFT JOIN employees tm    ON tm.id = COALESCE(e.reporting_manager_id, e.manager_id)
      LEFT JOIN branch_master b  ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY team_lead_name, p.process_name, b.branch_name, ks.period
     ORDER BY b.branch_name, p.process_name, ks.period`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
}

// ---------------------------------------------------------------------------
// quality-audit-log
// ---------------------------------------------------------------------------
export async function qualityAuditLog(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, `${new Date().getFullYear()}-01-01`);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("qar.audit_date BETWEEN ? AND ?");
  params.push(from, to);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("qar.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT qar.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           qar.audit_date,
           qar.call_id,
           qar.score,
           qar.fatal_error,
           qar.auditor_name,
           qar.feedback,
           b.branch_name, p.process_name
      FROM quality_audit_record qar
      JOIN employees e         ON e.id  = qar.employee_id
      LEFT JOIN branch_master b  ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY qar.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// fatal-error-register
// ---------------------------------------------------------------------------
export async function fatalErrorRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, `${new Date().getFullYear()}-01-01`);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("qar.audit_date BETWEEN ? AND ?");
  params.push(from, to);
  // Accept any of the three possible column names across schema versions
  clauses.push("(qar.fatal_error = 1 OR qar.score = 0 OR qar.is_fatal = 1)");

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("qar.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT qar.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           qar.audit_date,
           qar.call_id,
           qar.score,
           qar.fatal_error,
           qar.auditor_name,
           qar.feedback,
           b.branch_name, p.process_name
      FROM quality_audit_record qar
      JOIN employees e         ON e.id  = qar.employee_id
      LEFT JOIN branch_master b  ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY qar.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}
