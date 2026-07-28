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
// Source: Shivamgiri.v_call_master_unified_kpi (cross-DB via sourceDb)
// Columns: User (emp code), CallDate, quality_score, total_calls + db_audit for audited count
// Scope: resolve employee codes from mas_hrms first, then filter Shivamgiri view
// ---------------------------------------------------------------------------
export async function agentPerformanceSummary(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const scoreMonth = monthParam(filters.month);
  const from = `${scoreMonth}-01`;
  const to   = new Date(new Date(from).getFullYear(),
    new Date(from).getMonth() + 1, 0).toISOString().slice(0, 10);

  // Resolve scoped employee codes from mas_hrms
  const eClauses: string[] = ["e.id IS NOT NULL"];
  const eParams: unknown[]  = [];
  appendScopeConditions(scope, eClauses, eParams);
  appendFilterConditions(filters, eClauses, eParams);

  const empSql = `SELECT e.employee_code,
    COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
    b.branch_name, p.process_name
    FROM mas_hrms.employees e
    LEFT JOIN mas_hrms.branch_master b ON b.id = e.branch_id
    LEFT JOIN mas_hrms.process_master p ON p.id = e.process_id
   WHERE ${eClauses.join(" AND ")}`;
  const empRows = await querySource<{ employee_code: string; employee_name: string; branch_name: string; process_name: string }>(
    empSql, eParams as (string|number|null)[]
  );
  if (empRows.length === 0) return { rows: [], rowCount: 0, isTruncated: false };

  const empMap = new Map(empRows.map(r => [r.employee_code, r]));
  const codes = empRows.map(r => r.employee_code);
  const placeholders = codes.map(() => "?").join(",");
  const qParams: (string|number|null)[] = [...codes, from, to];

  let cursorClause = "";
  if (options.mode === "worker" && options.cursor != null) {
    cursorClause = ` HAVING MIN(kpi.CallDate) > ?`;
    qParams.push(options.cursor as string);
  }

  const sql = `
    SELECT kpi.User AS employee_code,
           LEFT(kpi.CallDate, 7) AS score_month,
           COUNT(*) AS total_calls,
           ROUND(AVG(kpi.quality_score) * 100, 2) AS avg_quality_score,
           MAX(kpi.quality_score) * 100 AS max_quality_score,
           MIN(kpi.quality_score) * 100 AS min_quality_score,
           CASE WHEN AVG(kpi.quality_score) >= 0.90 THEN 'Excellent'
                WHEN AVG(kpi.quality_score) >= 0.80 THEN 'Good'
                WHEN AVG(kpi.quality_score) >= 0.70 THEN 'Average'
                ELSE 'Poor' END AS quality_band
      FROM Shivamgiri.v_call_master_unified_kpi kpi
     WHERE kpi.User IN (${placeholders})
       AND kpi.CallDate BETWEEN ? AND ?
     GROUP BY kpi.User${cursorClause}
     ORDER BY kpi.User ASC
     LIMIT ${options.limit} OFFSET ${options.mode === "worker" ? 0 : options.offset}`;

  const rows = await querySource<Record<string,unknown>>(sql, qParams);
  // Enrich with employee name / branch / process from mas_hrms lookup
  const enriched = rows.map(r => {
    const info = empMap.get(r.employee_code as string);
    return { ...r, employee_name: info?.employee_name, branch_name: info?.branch_name, process_name: info?.process_name };
  });
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? String(rows[rows.length - 1].employee_code ?? "") : null;
  return { rows: enriched, rowCount: enriched.length, isTruncated: enriched.length === options.limit, nextCursor };
}

// ---------------------------------------------------------------------------
// team-performance-summary (aggregate — no cursor)
// Source: Shivamgiri.v_call_master_unified_kpi, grouped by team lead
// ---------------------------------------------------------------------------
export async function teamPerformanceSummary(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const scoreMonth = monthParam(filters.month);
  const from = `${scoreMonth}-01`;
  const to   = new Date(new Date(from).getFullYear(),
    new Date(from).getMonth() + 1, 0).toISOString().slice(0, 10);

  // Resolve scoped employees with manager info
  const eClauses: string[] = ["e.id IS NOT NULL"];
  const eParams: unknown[]  = [];
  appendScopeConditions(scope, eClauses, eParams);
  appendFilterConditions(filters, eClauses, eParams);

  const empSql = `SELECT e.employee_code,
    COALESCE(NULLIF(tm.full_name,''), CONCAT(tm.first_name,' ',COALESCE(tm.last_name,''))) AS team_lead_name,
    b.branch_name, p.process_name
    FROM mas_hrms.employees e
    LEFT JOIN mas_hrms.employees tm ON tm.id = COALESCE(e.reporting_manager_id, e.manager_id)
    LEFT JOIN mas_hrms.branch_master b ON b.id = e.branch_id
    LEFT JOIN mas_hrms.process_master p ON p.id = e.process_id
   WHERE ${eClauses.join(" AND ")}`;
  const empRows = await querySource<{ employee_code: string; team_lead_name: string; branch_name: string; process_name: string }>(
    empSql, eParams as (string|number|null)[]
  );
  if (empRows.length === 0) return { rows: [], rowCount: 0, isTruncated: false };

  const codes = empRows.map(r => r.employee_code);
  // Group by team lead using application-side grouping (avoids cross-DB GROUP BY complexity)
  const teamMap = new Map<string, { team_lead_name: string; branch_name: string; process_name: string; codes: string[] }>();
  for (const r of empRows) {
    const key = `${r.team_lead_name}||${r.branch_name}||${r.process_name}`;
    if (!teamMap.has(key)) teamMap.set(key, { team_lead_name: r.team_lead_name, branch_name: r.branch_name, process_name: r.process_name, codes: [] });
    teamMap.get(key)!.codes.push(r.employee_code);
  }

  const placeholders = codes.map(() => "?").join(",");
  const kpiSql = `
    SELECT kpi.User AS employee_code,
           ROUND(AVG(kpi.quality_score) * 100, 2) AS avg_score
      FROM Shivamgiri.v_call_master_unified_kpi kpi
     WHERE kpi.User IN (${placeholders})
       AND kpi.CallDate BETWEEN ? AND ?
     GROUP BY kpi.User`;
  const kpiRows = await querySource<{ employee_code: string; avg_score: number }>(
    kpiSql, [...codes, from, to] as (string|number|null)[]
  );
  const kpiMap = new Map(kpiRows.map(r => [r.employee_code, r.avg_score]));

  const aggregated = Array.from(teamMap.values()).map(team => {
    const scores = team.codes.map(c => kpiMap.get(c) ?? null).filter((s): s is number => s !== null);
    return {
      score_month: scoreMonth,
      team_lead_name: team.team_lead_name,
      branch_name: team.branch_name,
      process_name: team.process_name,
      team_size: team.codes.length,
      avg_score: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 100) / 100 : null,
      max_score: scores.length ? Math.max(...scores) : null,
      min_score: scores.length ? Math.min(...scores) : null,
    };
  });

  const paged = aggregated.slice(options.offset, options.offset + options.limit);
  return { rows: paged, rowCount: aggregated.length, isTruncated: aggregated.length > paged.length };
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

  const eClauses: string[] = ["e.id IS NOT NULL"];
  const eParams: unknown[]  = [];
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

  const eClauses: string[] = ["e.id IS NOT NULL"];
  const eParams: unknown[]  = [];
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
