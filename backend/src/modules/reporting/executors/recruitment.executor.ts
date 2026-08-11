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
  fetchPageWithTotal,
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
 *
 * job_requisition.branch_id is NULL on every row in production, so we cannot
 * filter through jd. Instead we scope on c.applied_for_branch / applied_for_process
 * via a sub-select against branch_master / process_master when the scope is
 * restricted. For "all" scope this adds no predicate.
 */
function appendCandidateScopeConditions(
  scope: ExecScope,
  clauses: string[],
  params: unknown[]
): void {
  if (scope.branchScope.mode === "none") throw new ReportScopeAccessDeniedError("branchScope");
  if (scope.branchScope.mode === "restricted" && scope.branchScope.ids.length > 0) {
    clauses.push(
      `c.applied_for_branch IN (SELECT branch_name FROM branch_master WHERE id IN (${scope.branchScope.ids.map(() => "?").join(",")}))`
    );
    params.push(...scope.branchScope.ids);
  }
  if (scope.processScope.mode === "none") throw new ReportScopeAccessDeniedError("processScope");
  if (scope.processScope.mode === "restricted" && scope.processScope.ids.length > 0) {
    clauses.push(
      `c.applied_for_process IN (SELECT process_name FROM process_master WHERE id IN (${scope.processScope.ids.map(() => "?").join(",")}))`
    );
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
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
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

  if (filters.branchId)  { clauses.push("c.applied_for_branch  = (SELECT branch_name  FROM branch_master  WHERE id = ? LIMIT 1)"); params.push(String(filters.branchId)); }
  if (filters.processId) { clauses.push("c.applied_for_process = (SELECT process_name FROM process_master WHERE id = ? LIMIT 1)"); params.push(String(filters.processId)); }
  if (filters.status)    { clauses.push("c.status = ?");  params.push(String(filters.status)); }
  clauses.push("c.created_at BETWEEN ? AND ?");
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
           c.status AS application_status,
           c.current_stage,
           c.created_at AS applied_date,
           c.offer_doj AS joining_date,
           jd.designation_name AS job_title,
           c.applied_for_branch AS branch_name,
           c.applied_for_process AS process_name
      FROM ats_candidate c
      LEFT JOIN job_requisition jd ON jd.id = c.requisition_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY c.id ASC`;

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

  if (scope.branchScope.mode === "none") throw new ReportScopeAccessDeniedError("branchScope");
  if (scope.branchScope.mode === "restricted" && scope.branchScope.ids.length > 0) {
    clauses.push(`c.applied_for_branch IN (SELECT branch_name FROM branch_master WHERE id IN (${scope.branchScope.ids.map(() => "?").join(",")}))`);
    params.push(...scope.branchScope.ids);
  }
  if (scope.processScope.mode === "none") throw new ReportScopeAccessDeniedError("processScope");
  // A "restricted" process scope threw only on "none" and was otherwise never turned into a
  // predicate, so a process-restricted viewer read every process in their branches. This is
  // the same clause recruiterProductivity already had; source-effectiveness simply lacked it.
  if (scope.processScope.mode === "restricted" && scope.processScope.ids.length > 0) {
    clauses.push(`c.applied_for_process IN (SELECT process_name FROM process_master WHERE id IN (${scope.processScope.ids.map(() => "?").join(",")}))`);
    params.push(...scope.processScope.ids);
  }
  if (scope.departmentScope.mode === "none") throw new ReportScopeAccessDeniedError("departmentScope");
  if (scope.costCentreScope.mode === "none") throw new ReportScopeAccessDeniedError("costCentreScope");

  if (filters.branchId)  { clauses.push("c.applied_for_branch  = (SELECT branch_name  FROM branch_master  WHERE id = ? LIMIT 1)"); params.push(String(filters.branchId)); }
  if (filters.processId) { clauses.push("c.applied_for_process = (SELECT process_name FROM process_master WHERE id = ? LIMIT 1)"); params.push(String(filters.processId)); }

  // 29,926 of ats_candidate's 37,686 rows are legacy EMPLOYEE records. Counting them here
  // inflated every channel's application count roughly 4x and dragged every selection rate
  // toward zero, because those rows carry no recruitment status.
  clauses.push(excludeEmployeeShapedCandidatesSql("c"));

  const base = `
    SELECT COALESCE(c.sourcing_channel, 'Unknown') AS source_channel,
           COUNT(*) AS total_applications,
           SUM(CASE WHEN LOWER(c.status) IN ('selected','offered','onboarded','joined') THEN 1 ELSE 0 END) AS selections,
           ROUND(
             SUM(CASE WHEN LOWER(c.status) IN ('selected','offered','onboarded','joined') THEN 1 ELSE 0 END) * 100.0
             / NULLIF(COUNT(*), 0),
             2
           ) AS selection_rate_pct
      FROM ats_candidate c
     WHERE ${clauses.join(" AND ")}
     GROUP BY source_channel
     ORDER BY total_applications DESC`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
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
    clauses.push(`c.applied_for_branch IN (SELECT branch_name FROM branch_master WHERE id IN (${scope.branchScope.ids.map(() => "?").join(",")}))`);
    params.push(...scope.branchScope.ids);
  }
  if (scope.processScope.mode === "none") throw new ReportScopeAccessDeniedError("processScope");
  if (scope.processScope.mode === "restricted" && scope.processScope.ids.length > 0) {
    clauses.push(`c.applied_for_process IN (SELECT process_name FROM process_master WHERE id IN (${scope.processScope.ids.map(() => "?").join(",")}))`);
    params.push(...scope.processScope.ids);
  }
  if (scope.departmentScope.mode === "none") throw new ReportScopeAccessDeniedError("departmentScope");
  if (scope.costCentreScope.mode === "none") throw new ReportScopeAccessDeniedError("costCentreScope");

  if (filters.branchId)  { clauses.push("c.applied_for_branch  = (SELECT branch_name  FROM branch_master  WHERE id = ? LIMIT 1)"); params.push(String(filters.branchId)); }
  if (filters.processId) { clauses.push("c.applied_for_process = (SELECT process_name FROM process_master WHERE id = ? LIMIT 1)"); params.push(String(filters.processId)); }

  // Same 29,926 legacy employee records as source-effectiveness. Left in, they were attributed
  // to whichever recruiter happened to sit on the imported row.
  clauses.push(excludeEmployeeShapedCandidatesSql("c"));

  const base = `
    SELECT c.assigned_recruiter_id,
           COALESCE(
             NULLIF(recruiter_emp.full_name, ''),
             NULLIF(TRIM(CONCAT(COALESCE(recruiter_emp.first_name, ''), ' ', COALESCE(recruiter_emp.last_name, ''))), ''),
             recruiter_user.email,
             -- An "AS assigned_recruiter_name" used to sit here, inside the COALESCE argument
             -- list, which is not valid SQL: an argument cannot carry an alias. The statement
             -- failed to parse, so recruiter-productivity was the one ATS report still
             -- returning 500 after the other four were repaired in 8947ac1f. The catalogue
             -- declares recruiter_name and no assigned_recruiter_name, so the outer alias is
             -- the intended one and this is a leftover from moving the column into COALESCE.
             c.recruiter_assigned_name
           ) AS recruiter_name,
           -- COUNT(DISTINCT c.id), not COUNT(*), and the same for the two measures below.
           -- The employees join is on user_id, which is NOT unique among active rows: one
           -- user_id currently carries 50 active employees rows (measured 2026-08-11), so
           -- every candidate assigned to that recruiter was counted 50 times. The candidate
           -- id is the grain this report is actually about, so counting it distinctly makes
           -- the numbers independent of how many rows the join produces.
           COUNT(DISTINCT c.id) AS total_candidates,
           COUNT(DISTINCT CASE WHEN LOWER(c.status) IN ('selected','offered','onboarded','joined') THEN c.id END) AS offers_made,
           COUNT(DISTINCT CASE WHEN c.offer_doj IS NOT NULL THEN c.id END) AS joinings
      FROM ats_candidate c
      LEFT JOIN auth_user recruiter_user ON recruiter_user.id = c.assigned_recruiter_id
      LEFT JOIN employees recruiter_emp ON recruiter_emp.user_id = recruiter_user.id AND recruiter_emp.active_status = 1
     WHERE ${clauses.join(" AND ")}
     -- ONLY_FULL_GROUP_BY is enabled and MySQL resolves the alias to its underlying expression,
     -- so grouping by the alias alone fails: recruiter_emp.full_name is then a nonaggregated
     -- column outside the grouping.
     --
     -- The expression is repeated here rather than its inputs being listed separately. Listing
     -- the inputs also compiles and, on today's data, returns the same 52 rows — but it groups
     -- by what the name is BUILT from rather than by the name itself, so the moment two
     -- candidates resolve to the same recruiter through different fallbacks they would split
     -- into separate rows. Grouping by the whole COALESCE states the intended grain directly:
     -- one row per recruiter as named.
     GROUP BY c.assigned_recruiter_id,
              COALESCE(
                NULLIF(recruiter_emp.full_name, ''),
                NULLIF(TRIM(CONCAT(COALESCE(recruiter_emp.first_name, ''), ' ', COALESCE(recruiter_emp.last_name, ''))), ''),
                recruiter_user.email,
                c.recruiter_assigned_name
              )
     ORDER BY total_candidates DESC`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
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

  if (filters.branchId)  { clauses.push("c.applied_for_branch  = (SELECT branch_name  FROM branch_master  WHERE id = ? LIMIT 1)"); params.push(String(filters.branchId)); }
  if (filters.processId) { clauses.push("c.applied_for_process = (SELECT process_name FROM process_master WHERE id = ? LIMIT 1)"); params.push(String(filters.processId)); }
  // offer_date does not exist; proxy: candidates whose current_stage reached offer
  clauses.push("LOWER(c.current_stage) IN ('offered','offer','onboarded','joined')");
  clauses.push("c.created_at BETWEEN ? AND ?");
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
           c.status AS application_status,
           c.current_stage,
           c.offer_salary AS offer_ctc,
           c.joining_confirmation AS offer_accepted,
           c.offer_doj AS joining_date,
           jd.designation_name AS job_title,
           c.applied_for_branch AS branch_name,
           c.applied_for_process AS process_name
      FROM ats_candidate c
      LEFT JOIN job_requisition jd ON jd.id = c.requisition_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY c.id ASC`;

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

  if (filters.branchId)  { clauses.push("c.applied_for_branch  = (SELECT branch_name  FROM branch_master  WHERE id = ? LIMIT 1)"); params.push(String(filters.branchId)); }
  if (filters.processId) { clauses.push("c.applied_for_process = (SELECT process_name FROM process_master WHERE id = ? LIMIT 1)"); params.push(String(filters.processId)); }
  // Candidates who reached offer stage but have no confirmed joining date
  clauses.push("LOWER(c.current_stage) IN ('offered','offer')");
  clauses.push("c.offer_doj IS NULL");

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
           c.status AS application_status,
           c.current_stage,
           DATEDIFF(CURDATE(), c.created_at) AS days_since_application,
           jd.designation_name AS job_title,
           c.applied_for_branch AS branch_name,
           c.applied_for_process AS process_name
      FROM ats_candidate c
      LEFT JOIN job_requisition jd ON jd.id = c.requisition_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY c.id ASC`;

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
