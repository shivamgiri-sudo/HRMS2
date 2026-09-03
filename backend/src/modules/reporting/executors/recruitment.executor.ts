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
  businessToday,
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
      -- ── READ THIS BEFORE TRUSTING total_candidates ──────────────────────────
      -- Candidates are attached by BRANCH + PROCESS, not by any posting key. So
      -- total_candidates is "candidates in this posting's branch and process", NOT
      -- "candidates who applied to this posting". Two postings for one branch+process each
      -- report the whole pool, and summing the column across rows therefore double counts.
      --
      -- Measured against production 2026-08-11, which is why this is documented rather than
      -- changed:
      --   job_posting            0 rows  -> this report returns nothing today, so the
      --                                     duplication above is latent, not live
      --   job_requisition       15 rows  -> the analogous table has branch+process groups of
      --                                     5, 4, 2 and 1, so a 5x inflation is the shape to
      --                                     expect once postings exist
      --   ats_candidate.requisition_id   populated on 196 of 7,770 genuine candidates (2.5%)
      --
      -- requisition_id is the key that would attribute candidates correctly. Switching to it
      -- today would produce a near-empty report — a different report, not a fix — and with
      -- zero postings there is no way to verify either version against real data. Repoint it
      -- when requisition_id is actually being written, and check the totals then.
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

  /**
   * Emits the names both catalogs declare. candidate_id, candidate_name, source, last_activity
   * and recruiter were declared and never produced, so five of twelve columns rendered
   * em-dashes on every row while the values sat in differently-named aliases (candidate_code,
   * full_name) or were simply not selected.
   *
   * The original aliases are kept alongside the declared ones: nothing else is known to read
   * them, but they cost one projection each and removing them could break a saved export.
   *
   * Source coverage is thin — sourcing_channel is filled on 5,702 of 38,328 rows — so the
   * column is COALESCEd to 'Unknown' rather than left NULL, which distinguishes "not recorded"
   * from a rendering fault. recruiter falls back across the three recruiter name columns this
   * table carries (recruiter_assigned_name 5,655, recruiter_name 5,035, plus the joined user)
   * because different intake paths populate different ones.
   */
  const base = `
    SELECT c.id AS _cursor,
           c.candidate_code,
           c.candidate_code AS candidate_id,
           c.full_name,
           c.full_name AS candidate_name,
           c.mobile,
           c.email,
           c.status AS application_status,
           c.current_stage,
           c.created_at AS applied_date,
           c.offer_doj AS joining_date,
           COALESCE(NULLIF(TRIM(c.sourcing_channel), ''), 'Unknown') AS source,
           -- Latest real movement: the newest stage transition, falling back to the row's own
           -- updated_at when the candidate has no stage history.
           COALESCE(sl.last_stage_at, c.updated_at) AS last_activity,
           COALESCE(
             NULLIF(TRIM(c.recruiter_assigned_name), ''),
             NULLIF(TRIM(c.recruiter_name), ''),
             -- The name lives on employees, not on auth_user, which holds only the
             -- credential columns (id/email/password_hash/...). ru.full_name does not
             -- exist, so this whole query threw ER_BAD_FIELD_ERROR and the report
             -- returned nothing. Same shape the recruiter-productivity query above
             -- already uses: employees joined off the recruiter's user id, email last.
             NULLIF(TRIM(ru_emp.full_name), ''),
             NULLIF(TRIM(CONCAT(COALESCE(ru_emp.first_name, ''), ' ', COALESCE(ru_emp.last_name, ''))), ''),
             ru.email
           ) AS recruiter,
           jd.designation_name AS job_title,
           c.applied_for_branch AS branch_name,
           c.applied_for_process AS process_name
      FROM ats_candidate c
      LEFT JOIN job_requisition jd ON jd.id = c.requisition_id
      LEFT JOIN auth_user ru ON ru.id = COALESCE(c.assigned_recruiter_id, c.recruiter_id)
      LEFT JOIN employees ru_emp ON ru_emp.user_id = ru.id AND ru_emp.active_status = 1
      LEFT JOIN (
        SELECT candidate_id, MAX(stage_date) AS last_stage_at
          FROM ats_candidate_stage_log
         GROUP BY candidate_id
      ) sl ON sl.candidate_id = c.id
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

  // The From/To controls the Library offers for this report were never read, so changing the
  // range returned a byte-identical six rows. Applied to created_at, which is this table's
  // real applied_date (37,630 rows filled against 4,903 on created_date — see the header note).
  // DATE() so a DATETIME value on the closing day is not excluded by an inclusive bound.
  const from = dateParam(filters.from, `${new Date().getFullYear()}-01-01`);
  const to   = dateParam(filters.to, businessToday());
  clauses.push("DATE(c.created_at) BETWEEN ? AND ?");
  params.push(from, to);

  /**
   * Column names follow the catalogs, which BOTH declared
   * source / applications / shortlisted / interviewed / offered / joined / conversion_rate /
   * avg_time_to_hire / cost_per_hire while this query emitted
   * source_channel / total_applications / selections / selection_rate_pct.
   *
   * Not one name overlapped, so the grid drew nine headers and nine em-dashes on every row —
   * the report looked completely empty despite returning data. The catalogs also declared
   * `source` as the primaryKey, so with it absent every row hashed to the same empty key and
   * the duplicate detector flagged the whole result set as duplicates.
   *
   * The funnel stages are now derived from ats_candidate.status rather than left unmapped:
   *   shortlisted  status reached shortlist or beyond
   *   interviewed  status reached interview or beyond
   *   offered      offer extended
   *   joined       actually onboarded/joined
   * conversion_rate is joined/applications, which is what a source-effectiveness reading
   * wants — the previous selection_rate_pct counted offers as successes.
   *
   * cost_per_hire has no source in this schema: there is no spend-per-channel table anywhere
   * in mas_hrms. It is emitted as NULL rather than a fabricated number, so the column reads
   * as "not captured" instead of implying a cost the business never recorded.
   */
  /**
   * Funnel stages, derived from the columns this schema actually populates.
   *
   * `status` does NOT carry funnel stages — its live values are Inactive(31,345),
   * Rejected(2,909), Selected(1,703), Waiting(1,426), No Show(596), Hold(221) and a few
   * others. It has no 'shortlisted', 'interviewed', 'offered' or 'joined'. The funnel lives in
   * current_stage: Applied(34,900), Offered(1,247), Round 1- HR Screening(944),
   * Round 2- Op's(495), Arrival(248), Interview - Skill Test(156), Round 3- Client(74),
   * offer_approved(54), Selection Discussion(34), Onboarded(28), converted(16).
   *
   * profile_status is the only 100%-filled progression column (registered 36,515 /
   * selected 1,238 / onboarding_sent 435 / onboarded 81 / profile_submitted 59), so it backs
   * up the joined test where current_stage was never advanced.
   *
   * offer_status exists on the table but is filled on 0 of 38,328 rows, so it is not used —
   * reading it would have produced a column of zeros that looked like a computed result.
   */
  const PRE_FUNNEL  = "LOWER(COALESCE(c.current_stage,'')) IN ('', 'applied', 'new', 'screening')";
  const SHORTLISTED = `NOT (${PRE_FUNNEL})`;
  const INTERVIEWED =
    "(LOWER(COALESCE(c.current_stage,'')) LIKE 'round %' " +
    " OR LOWER(COALESCE(c.current_stage,'')) LIKE 'round_%' " +
    " OR LOWER(COALESCE(c.current_stage,'')) LIKE 'interview%' " +
    " OR LOWER(COALESCE(c.current_stage,'')) IN ('selection discussion','offered','offer_approved','onboarded','converted','selected'))";
  const OFFERED =
    "(LOWER(COALESCE(c.current_stage,'')) IN ('offered','offer_approved','onboarded','converted') " +
    " OR c.offer_doj IS NOT NULL OR c.offer_salary IS NOT NULL)";
  const JOINED =
    "(LOWER(COALESCE(c.current_stage,'')) IN ('onboarded','converted') " +
    " OR LOWER(COALESCE(c.profile_status,'')) = 'onboarded' " +
    " OR c.employee_code IS NOT NULL)";

  const base = `
    SELECT COALESCE(c.sourcing_channel, 'Unknown') AS source,
           COUNT(*) AS applications,
           SUM(CASE WHEN ${SHORTLISTED} THEN 1 ELSE 0 END) AS shortlisted,
           SUM(CASE WHEN ${INTERVIEWED} THEN 1 ELSE 0 END) AS interviewed,
           SUM(CASE WHEN ${OFFERED}     THEN 1 ELSE 0 END) AS offered,
           SUM(CASE WHEN ${JOINED}      THEN 1 ELSE 0 END) AS joined,
           ROUND(SUM(CASE WHEN ${JOINED} THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 2) AS conversion_rate,
           -- Days from application to joining, averaged over the rows where both dates exist.
           ROUND(AVG(CASE WHEN ${JOINED} AND c.offer_doj IS NOT NULL AND c.created_at IS NOT NULL
                          THEN DATEDIFF(c.offer_doj, c.created_at) END), 1) AS avg_time_to_hire,
           NULL AS cost_per_hire
      FROM ats_candidate c
     WHERE ${clauses.join(" AND ")}
     GROUP BY source
     ORDER BY applications DESC`;

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

  // The From/To controls the Library offers were never read, so a recruiter's productivity was
  // reported over all time no matter what period was chosen — the same 58 rows for every range.
  // Applied to created_at, this table's real applied_date, wrapped in DATE() so a DATETIME on
  // the closing day is not excluded by the inclusive upper bound.
  const from = dateParam(filters.from, `${new Date().getFullYear()}-01-01`);
  const to   = dateParam(filters.to, businessToday());
  clauses.push("DATE(c.created_at) BETWEEN ? AND ?");
  params.push(from, to);

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
           COUNT(DISTINCT c.id) AS candidates_sourced,
           COUNT(DISTINCT CASE WHEN LOWER(c.status) IN ('selected','offered','onboarded','joined') THEN c.id END) AS offers_made,
           COUNT(DISTINCT CASE WHEN c.offer_doj IS NOT NULL THEN c.id END) AS joinings,
           /**
            * Declared-but-never-produced columns. Seven of nine were em-dashes on every row:
            * branch_name, active_requisitions, candidates_sourced, interviews_scheduled,
            * hires, avg_time_to_fill, offer_acceptance_rate.
            *
            * candidates_sourced and hires are aliases of measures already computed here.
            *
            * branch_name is the recruiter's OWN branch from the employees row, not the
            * candidate's applied_for_branch — a recruiter working several branches would
            * otherwise split into one row per branch and break the "one row per recruiter"
            * grain this report declares.
            *
            * interviews_scheduled counts candidates who reached an interview stage, from
            * current_stage. status carries no interview value (its values are Inactive,
            * Rejected, Selected, Waiting, No Show, Hold), so it cannot answer this.
            *
            * active_requisitions counts distinct requisition_id, which is populated on only
            * 531 of 38,328 rows — so this reads low for reasons of data capture, not
            * arithmetic. Counted distinctly rather than left unmapped so the number that does
            * exist is shown.
            *
            * avg_time_to_fill is application date to expected joining date, over the rows
            * where both are present (offer_doj is filled on 1,048 rows).
            *
            * offer_acceptance_rate is joinings/offers_made as a percentage, guarded against
            * divide-by-zero so a recruiter with no offers reads NULL rather than erroring.
            */
           COUNT(DISTINCT CASE WHEN c.offer_doj IS NOT NULL THEN c.id END) AS hires,
           COALESCE(NULLIF(TRIM(recruiter_branch.branch_name), ''), 'UNASSIGNED') AS branch_name,
           COUNT(DISTINCT c.requisition_id) AS active_requisitions,
           COUNT(DISTINCT CASE
             WHEN LOWER(COALESCE(c.current_stage,'')) LIKE 'round %'
               OR LOWER(COALESCE(c.current_stage,'')) LIKE 'round_%'
               OR LOWER(COALESCE(c.current_stage,'')) LIKE 'interview%'
               OR LOWER(COALESCE(c.current_stage,'')) IN ('selection discussion','offered','offer_approved','onboarded','converted')
             THEN c.id END) AS interviews_scheduled,
           ROUND(AVG(CASE WHEN c.offer_doj IS NOT NULL AND c.created_at IS NOT NULL
                          THEN DATEDIFF(c.offer_doj, c.created_at) END), 1) AS avg_time_to_fill,
           ROUND(
             COUNT(DISTINCT CASE WHEN c.offer_doj IS NOT NULL THEN c.id END) * 100.0
             / NULLIF(COUNT(DISTINCT CASE WHEN LOWER(c.status) IN ('selected','offered','onboarded','joined') THEN c.id END), 0),
             2
           ) AS offer_acceptance_rate
      FROM ats_candidate c
      LEFT JOIN auth_user recruiter_user ON recruiter_user.id = c.assigned_recruiter_id
      LEFT JOIN employees recruiter_emp ON recruiter_emp.user_id = recruiter_user.id AND recruiter_emp.active_status = 1
      -- The recruiter's own branch, for the declared branch_name column.
      LEFT JOIN branch_master recruiter_branch ON recruiter_branch.id = recruiter_emp.branch_id
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
              ),
              -- Same reasoning as the name above: group by the emitted expression, not by
              -- recruiter_branch.branch_name, so ONLY_FULL_GROUP_BY is satisfied and the grain
              -- is stated as "one row per recruiter as named, at their branch as shown".
              COALESCE(NULLIF(TRIM(recruiter_branch.branch_name), ''), 'UNASSIGNED')
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

  /**
   * Emits the seven names both catalogs declare and this query never produced:
   * candidate_name, offer_date, offered_ctc, offer_status, expected_joining, actual_joining,
   * decline_reason. Seven of ten columns were em-dashes on every row.
   *
   * Where the value existed under another alias it is simply also emitted under the declared
   * one (offered_ctc from offer_salary, expected_joining from offer_doj). The date fields have
   * no column on ats_candidate at all and are derived from ats_candidate_stage_log, which is
   * the real record of when each transition happened:
   *   offer_date     first transition INTO an offer stage
   *   actual_joining first transition INTO onboarded/converted
   *
   * offer_status does NOT come from ats_candidate.offer_status: that column exists but is
   * filled on 0 of 38,328 rows. It is derived from the signals that are populated —
   * joining_confirmation (Yes 265 / Need Clarification 7 / No 2) and the joined stage — so the
   * column states something true instead of being uniformly empty.
   *
   * decline_reason maps to rejection_voc (1,421 rows). hard_reject_reason is 0/38,328 and
   * rejection_reason does not exist, so rejection_voc is the only populated source.
   */
  const base = `
    SELECT c.id AS _cursor,
           c.candidate_code,
           c.full_name,
           c.full_name AS candidate_name,
           c.mobile,
           c.email,
           c.status AS application_status,
           c.current_stage,
           c.offer_salary AS offer_ctc,
           c.offer_salary AS offered_ctc,
           c.joining_confirmation AS offer_accepted,
           sl.offer_stage_at AS offer_date,
           c.offer_doj AS joining_date,
           c.offer_doj AS expected_joining,
           sl.joined_stage_at AS actual_joining,
           CASE
             WHEN LOWER(COALESCE(c.current_stage,'')) IN ('onboarded','converted')
               OR LOWER(COALESCE(c.profile_status,'')) = 'onboarded' THEN 'Joined'
             WHEN LOWER(COALESCE(c.joining_confirmation,'')) = 'yes'  THEN 'Accepted'
             WHEN LOWER(COALESCE(c.joining_confirmation,'')) = 'no'   THEN 'Declined'
             WHEN TRIM(COALESCE(c.joining_confirmation,'')) <> ''     THEN c.joining_confirmation
             WHEN LOWER(COALESCE(c.status,'')) = 'rejected'           THEN 'Rejected'
             ELSE 'Pending'
           END AS offer_status,
           c.rejection_voc AS decline_reason,
           jd.designation_name AS job_title,
           c.applied_for_branch AS branch_name,
           c.applied_for_process AS process_name
      FROM ats_candidate c
      LEFT JOIN job_requisition jd ON jd.id = c.requisition_id
      LEFT JOIN (
        SELECT candidate_id,
               MIN(CASE WHEN LOWER(to_stage) IN ('offered','offer','offer_approved') THEN stage_date END) AS offer_stage_at,
               MIN(CASE WHEN LOWER(to_stage) IN ('onboarded','converted')             THEN stage_date END) AS joined_stage_at
          FROM ats_candidate_stage_log
         GROUP BY candidate_id
      ) sl ON sl.candidate_id = c.id
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

  /**
   * Emits the six declared names this query never produced: candidate_name,
   * offer_acceptance_date, expected_joining, days_to_joining, recruiter, last_contact.
   *
   * Note what this report selects on: current_stage reached offer AND offer_doj IS NULL. So
   * expected_joining is NULL for every row BY CONSTRUCTION — that is the definition of the
   * worklist, not a mapping fault, and the column is emitted so the grid shows a blank rather
   * than an em-dash that reads like a fetch failure. days_to_joining is likewise NULL here;
   * it is kept because the catalogs declare it and a future variant of this list that includes
   * dated offers will populate it.
   *
   * The other four come from real sources:
   *   offer_acceptance_date  stage_log transition into offer_approved, or the offer stage where
   *                          joining_confirmation is 'Yes'
   *   recruiter              recruiter_assigned_name / recruiter_name / joined auth_user
   *   last_contact           newest stage transition, falling back to updated_at
   */
  const base = `
    SELECT c.id AS _cursor,
           c.candidate_code,
           c.full_name,
           c.full_name AS candidate_name,
           c.mobile,
           c.email,
           c.status AS application_status,
           c.current_stage,
           DATEDIFF(CURDATE(), c.created_at) AS days_since_application,
           COALESCE(sl.accepted_stage_at,
                    CASE WHEN LOWER(COALESCE(c.joining_confirmation,'')) = 'yes'
                         THEN sl.offer_stage_at END) AS offer_acceptance_date,
           c.offer_doj AS expected_joining,
           CASE WHEN c.offer_doj IS NULL THEN NULL
                ELSE DATEDIFF(c.offer_doj, CURDATE()) END AS days_to_joining,
           COALESCE(
             NULLIF(TRIM(c.recruiter_assigned_name), ''),
             NULLIF(TRIM(c.recruiter_name), ''),
             -- The name lives on employees, not on auth_user, which holds only the
             -- credential columns (id/email/password_hash/...). ru.full_name does not
             -- exist, so this whole query threw ER_BAD_FIELD_ERROR and the report
             -- returned nothing. Same shape the recruiter-productivity query above
             -- already uses: employees joined off the recruiter's user id, email last.
             NULLIF(TRIM(ru_emp.full_name), ''),
             NULLIF(TRIM(CONCAT(COALESCE(ru_emp.first_name, ''), ' ', COALESCE(ru_emp.last_name, ''))), ''),
             ru.email
           ) AS recruiter,
           COALESCE(sl.last_stage_at, c.updated_at) AS last_contact,
           jd.designation_name AS job_title,
           c.applied_for_branch AS branch_name,
           c.applied_for_process AS process_name
      FROM ats_candidate c
      LEFT JOIN job_requisition jd ON jd.id = c.requisition_id
      LEFT JOIN auth_user ru ON ru.id = COALESCE(c.assigned_recruiter_id, c.recruiter_id)
      LEFT JOIN employees ru_emp ON ru_emp.user_id = ru.id AND ru_emp.active_status = 1
      LEFT JOIN (
        SELECT candidate_id,
               MAX(stage_date) AS last_stage_at,
               MIN(CASE WHEN LOWER(to_stage) IN ('offered','offer')   THEN stage_date END) AS offer_stage_at,
               MIN(CASE WHEN LOWER(to_stage) = 'offer_approved'       THEN stage_date END) AS accepted_stage_at
          FROM ats_candidate_stage_log
         GROUP BY candidate_id
      ) sl ON sl.candidate_id = c.id
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
