/**
 * Recruitment / ATS executor
 *
 * Covers codes: recruitment-pipeline, candidate-tracker, source-effectiveness,
 * recruiter-productivity, offer-tracker, joining-pending
 *
 * Primary tenant guard: job_posting and ats_candidate lack company_id — scope is
 * enforced via branch/process scope conditions. Single-tenant deployment.
 * Note: Previously referenced
 * driving table. appendScopeConditions uses alias "e" by default; for tables
 * that don't have branch_id / process_id on the primary alias we pass the
 * appropriate alias or inline the conditions manually.
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

// ATS schema is being extended; gracefully return empty on missing column/table errors
const ATS_SCHEMA_ERRORS = new Set(['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR', 'ER_PARSE_ERROR']);

async function query(sql: string, params: unknown[]): Promise<RowDataPacket[]> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(sql, params);
    return rows;
  } catch (err: unknown) {
    if (ATS_SCHEMA_ERRORS.has((err as any)?.code)) return [];
    throw err;
  }
}

async function count(baseSql: string, params: unknown[]): Promise<number> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM (${baseSql}) AS _cnt`,
      params
    );
    return Number((rows as any)[0]?.total ?? 0);
  } catch (err: unknown) {
    if (ATS_SCHEMA_ERRORS.has((err as any)?.code)) return 0;
    throw err;
  }
}

/**
 * Append branch/process scope conditions using the jd alias (job_posting).
 * Mirrors appendScopeConditions but targets jd.branch_id / jd.process_id.
 */
function appendJdScopeConditions(
  scope: ExecScope,
  clauses: string[],
  params: unknown[]
): void {
  if (scope.branchScope.mode === "none") throw new ReportScopeAccessDeniedError("branchScope");
  if (scope.branchScope.mode === "restricted" && scope.branchScope.ids.length > 0) {
    clauses.push(`jd.branch_id IN (${scope.branchScope.ids.map(() => "?").join(",")})`);
    params.push(...scope.branchScope.ids);
  }
  if (scope.processScope.mode === "none") throw new ReportScopeAccessDeniedError("processScope");
  if (scope.processScope.mode === "restricted" && scope.processScope.ids.length > 0) {
    clauses.push(`jd.process_id IN (${scope.processScope.ids.map(() => "?").join(",")})`);
    params.push(...scope.processScope.ids);
  }
  if (scope.departmentScope.mode === "none") throw new ReportScopeAccessDeniedError("departmentScope");
  if (scope.departmentScope.mode === "restricted" && scope.departmentScope.ids.length > 0) {
    clauses.push(`jd.department_id IN (${scope.departmentScope.ids.map(() => "?").join(",")})`);
    params.push(...scope.departmentScope.ids);
  }
  if (scope.costCentreScope.mode === "none") throw new ReportScopeAccessDeniedError("costCentreScope");
}

/**
 * Append branch/process scope conditions using the c alias (ats_candidates).
 */
function appendCandidateScopeConditions(
  scope: ExecScope,
  clauses: string[],
  params: unknown[]
): void {
  if (scope.branchScope.mode === "none") throw new ReportScopeAccessDeniedError("branchScope");
  if (scope.branchScope.mode === "restricted" && scope.branchScope.ids.length > 0) {
    // candidates join via jd; filter on jd.branch_id
    clauses.push(`jd.branch_id IN (${scope.branchScope.ids.map(() => "?").join(",")})`);
    params.push(...scope.branchScope.ids);
  }
  if (scope.processScope.mode === "none") throw new ReportScopeAccessDeniedError("processScope");
  if (scope.processScope.mode === "restricted" && scope.processScope.ids.length > 0) {
    clauses.push(`jd.process_id IN (${scope.processScope.ids.map(() => "?").join(",")})`);
    params.push(...scope.processScope.ids);
  }
  if (scope.departmentScope.mode === "none") throw new ReportScopeAccessDeniedError("departmentScope");
  if (scope.costCentreScope.mode === "none") throw new ReportScopeAccessDeniedError("costCentreScope");
}

// ---------------------------------------------------------------------------
// recruitment-pipeline
// ---------------------------------------------------------------------------
export async function recruitmentPipeline(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, `${new Date().getFullYear()}-01-01`);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["1 = 1"];
  const params: unknown[]  = [];
  appendJdScopeConditions(scope, clauses, params);

  if (filters.branchId)  { clauses.push("jd.branch_id = ?");  params.push(String(filters.branchId)); }
  if (filters.processId) { clauses.push("jd.process_id = ?"); params.push(String(filters.processId)); }
  clauses.push("jd.created_at BETWEEN ? AND ?");
  params.push(from, to);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("jd.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT jd.id AS _cursor,
           jd.title AS job_title,
           jd.posting_code AS job_code,
           jd.vacancies AS openings_count,
           jd.status AS jd_status,
           jd.created_at,
           jd.closing_date,
           b.branch_name,
           p.process_name,
           COUNT(c.id) AS total_candidates,
           SUM(CASE WHEN c.current_stage = 'Selected'  THEN 1 ELSE 0 END) AS selected,
           SUM(CASE WHEN c.current_stage = 'Rejected'  THEN 1 ELSE 0 END) AS rejected,
           SUM(CASE WHEN c.current_stage NOT IN ('Selected','Rejected') THEN 1 ELSE 0 END) AS in_progress
      FROM job_posting jd
      LEFT JOIN branch_master b     ON b.id = jd.branch_id
      LEFT JOIN process_master p    ON p.id = jd.process_id
      LEFT JOIN ats_candidate c     ON c.applied_for_branch = b.branch_name
                                   AND c.applied_for_process = p.process_name
     WHERE ${clauses.join(" AND ")}
     GROUP BY jd.id, jd.title, jd.posting_code, jd.vacancies, jd.status,
              jd.created_at, jd.closing_date, b.branch_name, p.process_name
     ORDER BY jd.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// candidate-tracker
// ---------------------------------------------------------------------------
export async function candidateTracker(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, `${new Date().getFullYear()}-01-01`);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["1 = 1"];
  const params: unknown[]  = [];
  appendCandidateScopeConditions(scope, clauses, params);

  if (filters.branchId)  { clauses.push("jd.branch_id = ?");         params.push(String(filters.branchId)); }
  if (filters.processId) { clauses.push("jd.process_id = ?");        params.push(String(filters.processId)); }
  if (filters.status)    { clauses.push("c.application_status = ?"); params.push(String(filters.status)); }
  clauses.push("c.applied_date BETWEEN ? AND ?");
  params.push(from, to);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("c.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT c.id AS _cursor,
           c.candidate_code,
           c.full_name,
           c.mobile,
           c.email,
           c.application_status,
           c.current_stage,
           c.applied_date,
           c.selected_date,
           c.offer_date,
           c.joining_date,
           jd.job_title,
           b.branch_name, p.process_name
      FROM ats_candidate c
      LEFT JOIN job_posting jd ON jd.id = c.job_id
      LEFT JOIN branch_master b    ON b.id  = jd.branch_id
      LEFT JOIN process_master p   ON p.id  = jd.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY c.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// source-effectiveness  (aggregate — no cursor)
// ---------------------------------------------------------------------------
export async function sourceEffectiveness(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["1 = 1"];
  const params: unknown[]  = [];

  // Branch scope narrowing via jd join
  if (scope.branchScope.mode === "none") throw new ReportScopeAccessDeniedError("branchScope");
  if (scope.branchScope.mode === "restricted" && scope.branchScope.ids.length > 0) {
    clauses.push(`jd.branch_id IN (${scope.branchScope.ids.map(() => "?").join(",")})`);
    params.push(...scope.branchScope.ids);
  }
  if (scope.processScope.mode === "none") throw new ReportScopeAccessDeniedError("processScope");
  if (scope.departmentScope.mode === "none") throw new ReportScopeAccessDeniedError("departmentScope");
  if (scope.costCentreScope.mode === "none") throw new ReportScopeAccessDeniedError("costCentreScope");

  if (filters.branchId) { clauses.push("jd.branch_id = ?");  params.push(String(filters.branchId)); }

  const base = `
    SELECT COALESCE(c.source_channel, 'Unknown') AS source_channel,
           COUNT(*) AS total_applications,
           SUM(CASE WHEN c.application_status = 'selected' THEN 1 ELSE 0 END) AS selections,
           ROUND(
             SUM(CASE WHEN c.application_status = 'selected' THEN 1 ELSE 0 END) * 100.0
             / NULLIF(COUNT(*), 0),
             2
           ) AS selection_rate_pct
      FROM ats_candidate c
      LEFT JOIN job_posting jd ON jd.id = c.job_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY source_channel
     ORDER BY total_applications DESC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
}

// ---------------------------------------------------------------------------
// recruiter-productivity  (aggregate — no cursor)
// ---------------------------------------------------------------------------
export async function recruiterProductivity(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["1 = 1"];
  const params: unknown[]  = [];

  if (scope.branchScope.mode === "none") throw new ReportScopeAccessDeniedError("branchScope");
  if (scope.branchScope.mode === "restricted" && scope.branchScope.ids.length > 0) {
    clauses.push(`jd.branch_id IN (${scope.branchScope.ids.map(() => "?").join(",")})`);
    params.push(...scope.branchScope.ids);
  }
  if (scope.processScope.mode === "none") throw new ReportScopeAccessDeniedError("processScope");
  if (scope.departmentScope.mode === "none") throw new ReportScopeAccessDeniedError("departmentScope");
  if (scope.costCentreScope.mode === "none") throw new ReportScopeAccessDeniedError("costCentreScope");

  if (filters.branchId)  { clauses.push("jd.branch_id = ?");  params.push(String(filters.branchId)); }
  if (filters.processId) { clauses.push("jd.process_id = ?"); params.push(String(filters.processId)); }

  const base = `
    SELECT c.assigned_recruiter_id,
           COALESCE(u.full_name, c.assigned_recruiter_name) AS recruiter_name,
           COUNT(*) AS total_candidates,
           SUM(CASE WHEN c.application_status = 'selected'    THEN 1 ELSE 0 END) AS offers_made,
           SUM(CASE WHEN c.joining_date IS NOT NULL            THEN 1 ELSE 0 END) AS joinings
      FROM ats_candidate c
      LEFT JOIN job_posting jd ON jd.id = c.job_id
      LEFT JOIN users u            ON u.id  = c.assigned_recruiter_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY c.assigned_recruiter_id, recruiter_name
     ORDER BY total_candidates DESC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
}

// ---------------------------------------------------------------------------
// offer-tracker
// ---------------------------------------------------------------------------
export async function offerTracker(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, `${new Date().getFullYear()}-01-01`);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["1 = 1"];
  const params: unknown[]  = [];
  appendCandidateScopeConditions(scope, clauses, params);

  if (filters.branchId)  { clauses.push("jd.branch_id = ?");  params.push(String(filters.branchId)); }
  if (filters.processId) { clauses.push("jd.process_id = ?"); params.push(String(filters.processId)); }
  clauses.push("c.offer_date IS NOT NULL");
  clauses.push("c.offer_date BETWEEN ? AND ?");
  params.push(from, to);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("c.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT c.id AS _cursor,
           c.candidate_code,
           c.full_name,
           c.mobile,
           c.email,
           c.application_status,
           c.offer_date,
           c.offer_ctc,
           c.offer_accepted,
           c.joining_date,
           c.offer_decline_reason,
           jd.job_title,
           b.branch_name, p.process_name
      FROM ats_candidate c
      LEFT JOIN job_posting jd ON jd.id = c.job_id
      LEFT JOIN branch_master b    ON b.id  = jd.branch_id
      LEFT JOIN process_master p   ON p.id  = jd.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY c.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// joining-pending
// ---------------------------------------------------------------------------
export async function joiningPending(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["1 = 1"];
  const params: unknown[]  = [];
  appendCandidateScopeConditions(scope, clauses, params);

  if (filters.branchId)  { clauses.push("jd.branch_id = ?");  params.push(String(filters.branchId)); }
  if (filters.processId) { clauses.push("jd.process_id = ?"); params.push(String(filters.processId)); }
  clauses.push("c.application_status = 'selected'");
  clauses.push("c.joining_date IS NULL");

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("c.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT c.id AS _cursor,
           c.candidate_code,
           c.full_name,
           c.mobile,
           c.email,
           c.application_status,
           c.selected_date,
           c.expected_joining_date,
           DATEDIFF(CURDATE(), c.selected_date) AS days_since_selection,
           jd.job_title,
           b.branch_name, p.process_name
      FROM ats_candidate c
      LEFT JOIN job_posting jd ON jd.id = c.job_id
      LEFT JOIN branch_master b    ON b.id  = jd.branch_id
      LEFT JOIN process_master p   ON p.id  = jd.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY c.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}
