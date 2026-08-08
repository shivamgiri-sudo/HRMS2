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
import { excludeEmployeeShapedCandidatesSql } from "../../ats/ats-reporting-scope.js";
import {
  appendScopeConditions,
  appendFilterConditions,
  dateParam,
  monthParam,
  applyPagination,
  ReportScopeAccessDeniedError,
  ReportSourceUnavailableError,
} from "./types.js";

/**
 * A schema error is not an empty result.
 *
 * These two helpers used to catch ER_NO_SUCH_TABLE, ER_BAD_FIELD_ERROR and ER_PARSE_ERROR and
 * return `[]` / `0`. That turned "this report cannot run" into "there are no candidates", which
 * the grid draws exactly like a real empty result — 200, clean, no warning anywhere.
 *
 * It was not hypothetical. Measured on live mas_hrms on 2026-08-08, all five reports in this
 * file were in that state: ats_candidate holds 37,630 rows, and every one of them reported
 * nothing, because the queries name columns the table does not have — application_status,
 * applied_date, selected_date, offer_date, joining_date, offer_ctc, offer_accepted, job_id —
 * and job_posting (0 rows) instead of job_requisition. The error was logged twice per request,
 * once for the count and once for the page, and thrown away both times.
 *
 * So the error now surfaces. Five reports that returned a confident zero will return a plain
 * failure naming the column, which is worse-looking and considerably more honest: an empty
 * recruitment pipeline is the most expensive wrong answer this file can give.
 *
 * The real column mapping is known and recorded here for whoever repoints these — it is
 * deliberately NOT applied in this commit, because two of the fields have no equivalent at all
 * and that is a decision rather than a rename:
 *
 *   application_status  -> status            (Selected 1,574 / Rejected 2,589 / Waiting 1,359 /
 *                                             No Show 489 / Inactive 31,354)
 *   applied_date        -> created_at        (37,630 filled; created_date only 4,903)
 *   joining_date        -> offer_doj
 *   offer_ctc           -> offer_salary
 *   offer_accepted      -> joining_confirmation
 *   job_id              -> requisition_id    (only 200 of 37,630 filled — must stay a LEFT JOIN)
 *   jd.job_title        -> job_requisition.designation_name
 *   selected_date       -> NOTHING
 *   offer_date          -> NOTHING           (offer_status is NULL on all 37,630 rows)
 *   offer_decline_reason-> NOTHING
 *
 * offer-tracker filters on `offer_date IS NOT NULL`, so it has no answerable form against this
 * schema and should be blocked with a stated reason rather than repointed. Note also that
 * branch/process scoping through the requisition cannot work as written: job_requisition
 * carries branch_name/process_name as text and its branch_id is NULL on every row.
 */
function rethrowSchemaError(err: unknown, sql: string): never {
  const e = err as { code?: string; sqlMessage?: string };
  const code = String(e?.code ?? "");

  // A genuinely absent table is what ReportSourceUnavailableError describes, so use it — its
  // message ("required table X does not exist") is then true.
  if (code === "ER_NO_SUCH_TABLE") {
    const table = /\bFROM\s+`?([a-z_][a-z0-9_]*)`?/i.exec(sql)?.[1] ?? "unknown";
    throw new ReportSourceUnavailableError("recruitment", table, e.sqlMessage ?? "");
  }

  // A missing COLUMN is a different fault and must not borrow that wording: ats_candidate
  // exists and holds 37,630 rows, so saying the table is absent would send whoever reads it
  // looking for the wrong thing.
  if (code === "ER_BAD_FIELD_ERROR" || code === "ER_PARSE_ERROR") {
    throw new Error(
      `Recruitment report cannot run against this database's schema — ${code}: ` +
        `${e.sqlMessage ?? ""}. The table exists; the report asks for a column it does not have. ` +
        `This previously returned an empty result, which read as "no candidates".`
    );
  }
  throw err;
}

async function query(sql: string, params: unknown[]): Promise<RowDataPacket[]> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(sql, params);
    return rows;
  } catch (err: unknown) {
    rethrowSchemaError(err, sql);
  }
}

async function count(baseSql: string, params: unknown[]): Promise<number> {
  const sql = `SELECT COUNT(*) AS total FROM (${baseSql}) AS _cnt`;
  try {
    const [rows] = await db.execute<RowDataPacket[]>(sql, params);
    return Number((rows as Array<{ total?: number }>)[0]?.total ?? 0);
  } catch (err: unknown) {
    rethrowSchemaError(err, baseSql);
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
                                   AND ${excludeEmployeeShapedCandidatesSql("c")}
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
    SELECT COALESCE(c.sourcing_channel, 'Unknown') AS source_channel,
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
           COALESCE(
             NULLIF(recruiter_emp.full_name, ''),
             NULLIF(TRIM(CONCAT(COALESCE(recruiter_emp.first_name, ''), ' ', COALESCE(recruiter_emp.last_name, ''))), ''),
             recruiter_user.email,
             c.recruiter_assigned_name AS assigned_recruiter_name
           ) AS recruiter_name,
           COUNT(*) AS total_candidates,
           SUM(CASE WHEN c.application_status = 'selected'    THEN 1 ELSE 0 END) AS offers_made,
           SUM(CASE WHEN c.joining_date IS NOT NULL            THEN 1 ELSE 0 END) AS joinings
      FROM ats_candidate c
      LEFT JOIN job_posting jd ON jd.id = c.job_id
      LEFT JOIN auth_user recruiter_user ON recruiter_user.id = c.assigned_recruiter_id
      LEFT JOIN employees recruiter_emp ON recruiter_emp.user_id = recruiter_user.id AND recruiter_emp.active_status = 1
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
