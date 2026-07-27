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
import { querySource } from "../../../db/sourceDb.js";
import type { ExecFilters, ExecScope, ExecOptions, ExecResult } from "./types.js";
import {
  appendScopeConditions,
  appendFilterConditions,
  dateParam,
  monthParam,
  applyPagination,
  ReportScopeAccessDeniedError,
} from "./types.js";

const OPS_SCHEMA_ERRORS = new Set(['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR']);

async function query(sql: string, params: unknown[]): Promise<RowDataPacket[]> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(sql, params);
    return rows;
  } catch (err: unknown) {
    if (OPS_SCHEMA_ERRORS.has(String((err as Record<string, unknown>)?.["code"] ?? ""))) return [];
    throw err;
  }
}

async function count(baseSql: string, params: unknown[]): Promise<number> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM (${baseSql}) AS _cnt`,
      params
    );
    return Number((rows as Array<{ total?: number }>)[0]?.total ?? 0);
  } catch (err: unknown) {
    if (OPS_SCHEMA_ERRORS.has(String((err as Record<string, unknown>)?.["code"] ?? ""))) return 0;
    throw err;
  }
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
// Source: db_audit.call_quality_assessment (cross-DB via sourceDb / qualified refs)
// Joins to mas_hrms.employees on employee_code = cqa.User for scope filtering.
// ---------------------------------------------------------------------------
export async function qualityAuditLog(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, `${new Date().getFullYear()}-01-01`);
  const to    = dateParam(filters.to, today);

  const eClauses: string[] = ["e.company_id = ?"];
  const eParams: unknown[]  = [scope.companyId];
  appendScopeConditions(scope, eClauses, eParams);
  appendFilterConditions(filters, eClauses, eParams);

  // Build scoped employee code list then query db_audit
  const empSql = `SELECT e.employee_code FROM mas_hrms.employees e
    LEFT JOIN mas_hrms.branch_master b ON b.id = e.branch_id
    LEFT JOIN mas_hrms.process_master p ON p.id = e.process_id
   WHERE ${eClauses.join(" AND ")}`;
  const empRows = await querySource<{ employee_code: string }>(empSql, eParams as (string|number|null)[]);
  if (empRows.length === 0) return { rows: [], rowCount: 0, isTruncated: false };

  const codes = empRows.map(r => r.employee_code);
  const placeholders = codes.map(() => "?").join(",");
  const qParams: (string|number|null)[] = [...codes, from, to];
  const cursor = options.cursor;
  let cursorClause = "";
  if (options.mode === "worker" && cursor != null) {
    cursorClause = ` AND cqa.id > ?`;
    qParams.push(cursor as string);
  }

  const sql = `
    SELECT cqa.id AS call_id,
           cqa.User AS employee_code,
           cqa.CallDate AS audit_date,
           ROUND(cqa.quality_percentage, 2) AS score,
           CASE WHEN cqa.quality_percentage < 50
                 AND (cqa.professionalism_maintained = 0 OR cqa.active_listening = 0)
                THEN 1 ELSE 0 END AS fatal_error,
           cqa.Campaign AS process_name
      FROM db_audit.call_quality_assessment cqa
     WHERE cqa.User IN (${placeholders})
       AND cqa.CallDate BETWEEN ? AND ?
       ${cursorClause}
     ORDER BY cqa.id ASC${options.mode === "worker" ? ` LIMIT ${options.limit}` : ` LIMIT ${options.limit} OFFSET ${options.offset}`}`;

  const rows = await querySource<Record<string,unknown>>(sql, qParams);
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1].call_id as string) : null;
  return { rows, rowCount: rows.length, isTruncated: rows.length === options.limit, nextCursor };
}

// ---------------------------------------------------------------------------
// fatal-error-register
// Source: db_audit.call_quality_assessment — fatal = low score + missing competency
// ---------------------------------------------------------------------------
export async function fatalErrorRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, `${new Date().getFullYear()}-01-01`);
  const to    = dateParam(filters.to, today);

  const eClauses: string[] = ["e.company_id = ?"];
  const eParams: unknown[]  = [scope.companyId];
  appendScopeConditions(scope, eClauses, eParams);
  appendFilterConditions(filters, eClauses, eParams);

  const empSql = `SELECT e.employee_code FROM mas_hrms.employees e
    LEFT JOIN mas_hrms.branch_master b ON b.id = e.branch_id
    LEFT JOIN mas_hrms.process_master p ON p.id = e.process_id
   WHERE ${eClauses.join(" AND ")}`;
  const empRows = await querySource<{ employee_code: string }>(empSql, eParams as (string|number|null)[]);
  if (empRows.length === 0) return { rows: [], rowCount: 0, isTruncated: false };

  const codes = empRows.map(r => r.employee_code);
  const placeholders = codes.map(() => "?").join(",");
  const qParams: (string|number|null)[] = [...codes, from, to];
  const cursor = options.cursor;
  let cursorClause = "";
  if (options.mode === "worker" && cursor != null) {
    cursorClause = ` AND cqa.id > ?`;
    qParams.push(cursor as string);
  }

  const sql = `
    SELECT cqa.id AS call_id,
           cqa.User AS employee_code,
           cqa.CallDate AS audit_date,
           ROUND(cqa.quality_percentage, 2) AS score,
           cqa.Campaign AS process_name
      FROM db_audit.call_quality_assessment cqa
     WHERE cqa.User IN (${placeholders})
       AND cqa.CallDate BETWEEN ? AND ?
       AND cqa.quality_percentage < 50
       AND (cqa.professionalism_maintained = 0 OR cqa.active_listening = 0)
       ${cursorClause}
     ORDER BY cqa.id ASC${options.mode === "worker" ? ` LIMIT ${options.limit}` : ` LIMIT ${options.limit} OFFSET ${options.offset}`}`;

  const rows = await querySource<Record<string,unknown>>(sql, qParams);
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1].call_id as string) : null;
  return { rows, rowCount: rows.length, isTruncated: rows.length === options.limit, nextCursor };
}
