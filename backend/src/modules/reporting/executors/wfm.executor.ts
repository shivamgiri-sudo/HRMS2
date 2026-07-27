/**
 * WFM (Workforce Management) executor
 *
 * Codes: roster-published, roster-variance, shift-swap-register, week-off-calendar
 *
 * WFM primary tables do not carry company_id directly; tenant isolation is
 * enforced via JOIN employees e WHERE e.company_id = :companyId.
 * Branch / process scope is applied through the employee join (alias "e"),
 * except for shift-swap where the requester alias is "e_req".
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
// roster-published
// ---------------------------------------------------------------------------
export async function rosterPublished(
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
  clauses.push("wra.roster_date BETWEEN ? AND ?", "wra.roster_status = 'published'");
  params.push(from, to);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("wra.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT wra.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           wra.roster_date,
           ws.shift_name,
           TIME_FORMAT(ws.start_time, '%H:%i') AS shift_start,
           TIME_FORMAT(ws.end_time,   '%H:%i') AS shift_end,
           ws.shift_duration_minutes,
           wra.roster_status,
           b.branch_name,
           p.process_name
      FROM wfm_roster_assignment wra
      JOIN employees e              ON e.id  = wra.employee_id
      LEFT JOIN wfm_shift_master ws ON ws.id = wra.shift_id
      LEFT JOIN branch_master b     ON b.id  = e.branch_id
      LEFT JOIN process_master p    ON p.id  = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY wra.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// roster-variance
// ---------------------------------------------------------------------------
export async function rosterVariance(
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
  clauses.push("wra.roster_date BETWEEN ? AND ?");
  params.push(from, to);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("wra.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT wra.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           wra.roster_date,
           ws.shift_name AS planned_shift,
           adr.attendance_status AS actual_status,
           CASE
             WHEN adr.attendance_status IS NULL     THEN 'NO_ATTENDANCE_DATA'
             WHEN adr.attendance_status = 'absent'  THEN 'ABSENT_ON_ROSTER'
             ELSE 'OK'
           END AS variance_flag,
           b.branch_name,
           p.process_name
      FROM wfm_roster_assignment wra
      JOIN employees e                ON e.id  = wra.employee_id
      LEFT JOIN wfm_shift_master ws   ON ws.id = wra.shift_id
      LEFT JOIN attendance_daily_record adr
             ON adr.employee_id = wra.employee_id
            AND adr.record_date = wra.roster_date
      LEFT JOIN branch_master b       ON b.id  = e.branch_id
      LEFT JOIN process_master p      ON p.id  = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY wra.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// shift-swap-register
// Scoped via the requester's employee record (alias e_req).
// ---------------------------------------------------------------------------
export async function shiftSwapRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, `${new Date().getFullYear()}-01-01`);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["e_req.company_id = ?"];
  const params: unknown[]  = [scope.companyId];

  // Manual scope via requester employee — standard alias "e" not available here
  if (scope.branchScope.mode === "none") throw new ReportScopeAccessDeniedError("branchScope");
  if (scope.branchScope.mode === "restricted" && scope.branchScope.ids.length > 0) {
    clauses.push(`e_req.branch_id IN (${scope.branchScope.ids.map(() => "?").join(",")})`);
    params.push(...scope.branchScope.ids);
  }
  if (scope.processScope.mode === "none") throw new ReportScopeAccessDeniedError("processScope");
  if (scope.processScope.mode === "restricted" && scope.processScope.ids.length > 0) {
    clauses.push(`e_req.process_id IN (${scope.processScope.ids.map(() => "?").join(",")})`);
    params.push(...scope.processScope.ids);
  }

  // Narrowing filters scoped to requester
  appendFilterConditions(filters, clauses, params, "e_req");

  clauses.push("ssr.swap_date BETWEEN ? AND ?");
  params.push(from, to);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("ssr.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT ssr.id AS _cursor,
           e_req.employee_code AS requester_code,
           CONCAT(e_req.first_name,' ',COALESCE(e_req.last_name,'')) AS requester_name,
           e_swp.employee_code AS swappee_code,
           CONCAT(e_swp.first_name,' ',COALESCE(e_swp.last_name,'')) AS swappee_name,
           ssr.swap_date,
           ssr.original_shift,
           ssr.swap_to_shift,
           ssr.approval_status,
           ssr.requested_at,
           b.branch_name,
           p.process_name
      FROM wfm_shift_swap_request ssr
      JOIN employees e_req           ON e_req.id = ssr.requester_id
      LEFT JOIN employees e_swp      ON e_swp.id = ssr.swappee_id
      LEFT JOIN branch_master b      ON b.id     = e_req.branch_id
      LEFT JOIN process_master p     ON p.id     = e_req.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY ssr.id ASC`;

  try {
    const total = options.includeTotal ? await count(base, params) : 0;
    const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
    const rows  = await query(sql, params) as Record<string, unknown>[];
    const nextCursor = (options.mode === "worker" && rows.length > 0)
      ? (rows[rows.length - 1]._cursor as number) : null;
    const out = rows.map(({ _cursor: _, ...rest }) => rest);
    return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
  } catch (err: unknown) {
    if ((err as any)?.code === 'ER_NO_SUCH_TABLE') {
      return { rows: [], rowCount: 0, isTruncated: false };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// week-off-calendar
// Derived from wfm_roster_assignment rows where is_week_off = 1 or shift_name = 'WO'.
// ---------------------------------------------------------------------------
export async function weekOffCalendar(
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
  clauses.push("wra.roster_date BETWEEN ? AND ?");
  clauses.push("(wra.is_week_off = 1 OR ws.shift_name = 'WO')");
  params.push(from, to);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("wra.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT wra.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           wra.roster_date AS week_off_date,
           DAYNAME(wra.roster_date)  AS week_off_day,
           b.branch_name,
           p.process_name
      FROM wfm_roster_assignment wra
      JOIN employees e              ON e.id  = wra.employee_id
      LEFT JOIN wfm_shift_master ws ON ws.id = wra.shift_id
      LEFT JOIN branch_master b     ON b.id  = e.branch_id
      LEFT JOIN process_master p    ON p.id  = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY wra.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}
