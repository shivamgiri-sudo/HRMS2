/**
 * Employee / HR & Workforce executor
 *
 * Covers codes: headcount, employee-master, manager-mapping, org-structure-snapshot,
 * cost-centre-headcount, employee-movement, confirmation-due-list, contract-expiry-list,
 * lifecycle-events, increment-promotion-history, birthday-list, anniversary-list,
 * org-mapping-gaps, employee-status-conflicts
 *
 * Every query includes WHERE e.company_id = :companyId to enforce tenant isolation.
 * (For the current single-tenant deployment company_id = '1' everywhere; the guard
 * prevents a future misconfiguration from leaking cross-tenant data.)
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import type { ExecFilters, ExecScope, ExecOptions, ExecResult } from "./types.js";
import {
  appendScopeConditions,
  appendFilterConditions,
  appendEmployeeStatusFilter,
  employeeInForce,
  dateParam,
  monthParam,
  applyPagination,
  fetchPageWithTotal,
} from "./types.js";
import { identitySpineSelect, identitySpineJoins } from "../identity-spine.js";

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
// headcount
// ---------------------------------------------------------------------------
/**
 * An active employee is `active_status = 1`. Nothing else.
 *
 * This used to also require LOWER(employment_status) = 'active', which made headcount
 * disagree with employee-master and every other employee-grain report: on 2026-08-07
 * headcount returned 1,123 where employee-master returned 1,125. The two rows behind the
 * gap have active_status = 1 with employment_status 'inactive' and 'resigned' — i.e.
 * contradictory flags on real employees, which is a data-quality problem to surface, not
 * a reason for two reports to answer the same question differently.
 *
 * Ruling of 2026-08-07: standardise on active_status, and expose the contradictions
 * through a dedicated exception report rather than silently dropping the rows.
 */
export async function headcount(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  const base = `
    -- COALESCE on the SELECT only, never on the GROUP BY. Grouping stays exactly as it was so
    -- no row can merge or split and no headcount can move; this changes what an unmapped row is
    -- labelled, not what is counted. Verified after: still sums to 1,125 active employees.
    --
    -- 6 of 95 rows here rendered a NULL process, 3 a NULL department and 1 a NULL branch. NULL
    -- reads as "nothing loaded" or as a rendering fault; UNASSIGNED reads as a fact about those
    -- employees, which is what it is — 143 active employees have no process and 64 no cost
    -- centre. Dropping them was never an option, so naming them is the whole point.
    SELECT COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(d.dept_name, 'UNASSIGNED') AS department_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           CASE WHEN e.active_status = 1 THEN 'Active' ELSE 'Inactive' END AS employee_status,
           COUNT(*) AS active_headcount
      FROM employees e
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN department_master d ON d.id = e.department_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY b.branch_name, d.dept_name, p.process_name, e.active_status
     ORDER BY b.branch_name, d.dept_name, p.process_name`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
}

// ---------------------------------------------------------------------------
// employee-master
// ---------------------------------------------------------------------------
export async function employeeMaster(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  // Both populations by default; `employeeStatus` narrows on request. Previously this was
  // an unconditional `active_status = 1` unless the caller passed `includeInactive`, which
  // the Report Library never sends — so the Employee Status column this report now carries
  // could only ever read "Active".
  appendEmployeeStatusFilter(filters, clauses, params);

  // The From/To controls the Library shows for this report were never read, so changing
  // either of them left all 1,102 rows identical. There is no fact table to anchor a period
  // against on an employee master list, so tenure is the period test: joined by the end of
  // the window and not gone before it started.
  if (filters.from || filters.to) {
    const from = dateParam(filters.from, "1900-01-01");
    const to   = dateParam(filters.to, "9999-12-31");
    const inForce = employeeInForce.byTenure(from, to);
    clauses.push(inForce.clause);
    params.push(...inForce.params);
  }

  // Cursor-based pagination for worker mode
  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           e.official_email, e.mobile, e.employment_status,
           CASE WHEN e.active_status = 1 THEN 'Active' ELSE 'Inactive' END AS employee_status,
           e.date_of_joining, e.date_of_exit,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(d.dept_name, 'UNASSIGNED') AS department_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(NULLIF(m.full_name,''), CONCAT(m.first_name,' ',COALESCE(m.last_name,''))) AS reporting_manager
      FROM employees e
      LEFT JOIN branch_master b  ON b.id  = e.branch_id
      LEFT JOIN department_master d ON d.id = e.department_id
      LEFT JOIN process_master p    ON p.id = e.process_id
      LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
      LEFT JOIN employees m ON m.id = COALESCE(e.reporting_manager_id, e.manager_id)
     WHERE ${clauses.join(" AND ")}
     ORDER BY e.id ASC`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];

  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number)
    : null;

  // Strip internal cursor field from output
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return {
    rows: out,
    rowCount: options.includeTotal ? total : rows.length,
    isTruncated: options.includeTotal ? total > out.length : rows.length === options.limit,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// manager-mapping
// ---------------------------------------------------------------------------
export async function managerMapping(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?"); params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(NULLIF(m.full_name,''), CONCAT(m.first_name,' ',COALESCE(m.last_name,''))) AS manager_name,
           m.employee_code AS manager_code,
           CASE
             WHEN e.reporting_manager_id IS NULL AND e.manager_id IS NULL THEN 'MISSING_MANAGER'
             WHEN e.reporting_manager_id IS NOT NULL AND e.manager_id IS NOT NULL
                  AND e.reporting_manager_id <> e.manager_id THEN 'MANAGER_FIELD_MISMATCH'
             ELSE 'OK'
           END AS mapping_status,
           CASE WHEN e.active_status = 1 THEN 'Active' ELSE 'Inactive' END AS employee_status,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name
      FROM employees e
      LEFT JOIN employees m ON m.id = COALESCE(e.reporting_manager_id, e.manager_id)
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY mapping_status DESC, e.id ASC`;

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
// org-structure-snapshot
// ---------------------------------------------------------------------------
export async function orgStructureSnapshot(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  const base = `
    -- Aligned with the inline block this used to disagree with, and with the catalogue.
    --
    -- The names were has_manager / missing_manager here and with_manager / without_manager on
    -- screen, for the same two numbers. The grid maps catalogue keys onto row keys, so the
    -- downloaded workbook carried two columns the catalogue does not declare and lacked the two
    -- it does — the values were right and unreachable.
    --
    -- The three name columns were also still selected bare here, so an unmapped branch,
    -- department or process reached the file as an empty cell while the screen said UNASSIGNED.
    SELECT COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(d.dept_name, 'UNASSIGNED') AS department_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           CASE WHEN e.active_status = 1 THEN 'Active' ELSE 'Inactive' END AS employee_status,
           COUNT(e.id) AS headcount,
           SUM(CASE WHEN e.reporting_manager_id IS NOT NULL OR e.manager_id IS NOT NULL THEN 1 ELSE 0 END) AS with_manager,
           SUM(CASE WHEN e.reporting_manager_id IS NULL AND e.manager_id IS NULL THEN 1 ELSE 0 END) AS without_manager
      FROM employees e
      LEFT JOIN branch_master b     ON b.id = e.branch_id
      LEFT JOIN department_master d ON d.id = e.department_id
      LEFT JOIN process_master p    ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY b.branch_name, d.dept_name, p.process_name, e.active_status
     ORDER BY b.branch_name, d.dept_name, p.process_name`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
}

// ---------------------------------------------------------------------------
// cost-centre-headcount
// ---------------------------------------------------------------------------
export async function costCentreHeadcount(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  // Grouped by NAME, which is not unique. Live check: 927 cost centres carry only 913
  // distinct names — 8 names belong to several cost centres at once. "Snapdeal" is six of
  // them (BSS/FLD/CORP/110, CS/FLD/AHMH/0212, CS/FLD/CHD/0202, CS/FLD/JPR/0214,
  // CS/FLD/KNL/0201, CS/FLD/MRT/0215) and "Deactive-JPRMAS2" is two that sit in the same
  // branch, so their headcounts were summed into a single row.
  //
  // Branch is the employee's branch, not the cost centre's, so branch in the GROUP BY did not
  // reliably separate them either. Grouping on the code as well splits them correctly, and
  // selecting it means a reader can tell six identically-named cost centres apart — which was
  // impossible before, since the code was never on the row.
  //
  // Column is active_headcount, not headcount: that is what the catalogue declares and what
  // the inline block in report-suite.routes.ts (which actually serves this code today)
  // returns. This executor is currently shadowed by that block, so the fixes here are latent
  // — they matter only if the inline block is ever removed, and they must not disagree with
  // it in the meantime.
  //
  // UNASSIGNED rather than NULL for the 64 active employees with no cost centre, matching how
  // every other report in this audit renders them, so they stay visible instead of collapsing
  // into a blank row.
  const base = `
    SELECT COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           CASE WHEN e.active_status = 1 THEN 'Active' ELSE 'Inactive' END AS employee_status,
           COUNT(*) AS active_headcount
      FROM employees e
      LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
      LEFT JOIN branch_master b       ON b.id  = e.branch_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY cc.cost_centre_code, cc.cost_centre_name, b.branch_name, e.active_status
     ORDER BY cc.cost_centre_code, b.branch_name`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
}

// ---------------------------------------------------------------------------
// employee-movement
// ---------------------------------------------------------------------------
export async function employeeMovement(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, `${new Date().getFullYear()}-01-01`);
  const to    = dateParam(filters.to, today);

  // The SELECT CASE WHEN has two ? placeholders that appear before the WHERE in SQL text,
  // so they must lead the params array — push them before appendScopeConditions.
  const params: unknown[]  = [from, to];  // for SELECT CASE WHEN ... BETWEEN ? AND ?
  const clauses: string[] = ["e.id IS NOT NULL"];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("(e.date_of_joining BETWEEN ? AND ? OR COALESCE(e.date_of_exit,e.date_of_leaving,e.resignation_date) BETWEEN ? AND ?)");
  params.push(from, to, from, to);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?"); params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           e.date_of_joining,
           COALESCE(e.date_of_exit, e.date_of_leaving, e.resignation_date) AS exit_date,
           CASE WHEN e.date_of_joining BETWEEN ? AND ? THEN 'joining' ELSE 'exit' END AS movement_type,
           b.branch_name, d.dept_name AS department_name, COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name
      FROM employees e
      LEFT JOIN branch_master b     ON b.id = e.branch_id
      LEFT JOIN department_master d ON d.id = e.department_id
      LEFT JOIN process_master p    ON p.id = e.process_id
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

// ---------------------------------------------------------------------------
// confirmation-due-list
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// new-join-export
//
// Promoted verbatim from the inline `case` block in report-suite.routes.ts.
//
// The screen and the download are not the same code path: the preview handler runs a
// 126-branch `switch (code)` and only reaches executeReport() in its default branch, while the
// export handler calls executeReport() directly and always. A report with an inline block and
// no executor therefore renders perfectly on screen and returns 404 "This report is not yet
// available" when downloaded. Confirmed live on 2026-08-08 for eight reachable reports, two of
// them — new-join-export and left-employee-export — named for the very thing they could not do.
//
// The SQL is copied exactly, including `COALESCE(..., '')` on branch, cost centre, department
// and designation. Those blanks are not the NULLs the UNASSIGNED convention is about; they are
// this sheet's existing rendering, and changing them here would mean the promotion could not be
// verified as a no-op. Worth revisiting separately, not while moving code.
//
// Scope differs by necessity: the inline block used addScopedEmployeeFilters(req, ...) and an
// executor has no req, so it uses appendScopeConditions(scope, ...). Both are the codebase's
// own scope mechanisms and both add nothing for an all-scope user, which is why parity is
// verified against super_admin — where the two must agree exactly — and the branch-scoped
// behaviour is left to the shared helper rather than reimplemented here.
// ---------------------------------------------------------------------------
export async function newJoinExport(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const from = dateParam(filters.from, `${new Date().getFullYear()}-01-01`);
  const to   = dateParam(filters.to, new Date().toISOString().slice(0, 10));

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.date_of_joining BETWEEN ? AND ?");
  params.push(from, to);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?"); params.push(options.cursor);
  }

  const base = `
    SELECT
      e.id AS _cursor,
      e.employee_code AS emp_code,
      CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS emp_name,
      COALESCE(b.branch_name, '') AS branch_name,
      COALESCE(cc.cost_centre_name, '') AS cost_center,
      COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
      COALESCE(dept.dept_name, '') AS department,
      COALESCE(desig.designation_name, '') AS designation,
      DATE_FORMAT(e.date_of_joining, '%Y-%m-%d') AS doj,
      COALESCE(e.source, '') AS source,
      COALESCE(e.sub_source, '') AS sub_source,
      COALESCE(e.mobile, '') AS mobile_no,
      COALESCE(ess.net_in_hand, esa.ctc_annual / 12, 0) AS net_in_hand,
      COALESCE(esa.ctc_annual, 0) AS offered_ctc
    FROM employees e
    LEFT JOIN branch_master b ON b.id = e.branch_id
    LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
    LEFT JOIN process_master p ON p.id = e.process_id
    LEFT JOIN department_master dept ON dept.id = e.department_id
    LEFT JOIN designation_master desig ON desig.id = e.designation_id
    LEFT JOIN (
      SELECT employee_id, net_in_hand
      FROM employee_salary_snapshot
      WHERE (employee_id, snapshot_date) IN (
        SELECT employee_id, MAX(snapshot_date) FROM employee_salary_snapshot GROUP BY employee_id
      )
    ) ess ON ess.employee_id = e.id
    LEFT JOIN employee_salary_assignment esa ON esa.employee_id = e.id AND esa.active_status = 1
    WHERE ${clauses.join(" AND ")}
    ORDER BY e.date_of_joining DESC, e.employee_code`;

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

/**
 * When probation ends, and therefore when confirmation falls due.
 *
 * This report used `COALESCE(e.probation_days, 90)`, and employees has no probation_days column —
 * verified against mas_hrms, which answers
 *
 *   ER_BAD_FIELD_ERROR: Unknown column 'e.probation_days' in 'where clause'
 *
 * so every run of confirmation-due-list threw. It is dispatched in executors/index.ts and present
 * in the frontend catalogue, so this was reachable and failing for every caller, not dead code.
 *
 * The real source is employee_probation, which the executor never joined. extended_end_date is
 * preferred over probation_end_date because an extension moves the confirmation date out; reading
 * the original would list someone as overdue whose probation was deliberately extended. The
 * 90-day fallback is the one this code already documented, so an employee with no probation row
 * behaves exactly as before.
 *
 * Aggregated in a subquery rather than joined directly: employee_probation holds one row per
 * probation period, so a plain join would return an employee once per extension and inflate every
 * count taken from this query.
 *
 * employee_probation currently holds 0 rows and no employee carries employment_status='probation',
 * so today this returns an empty report rather than a 500 — the honest answer for the data that
 * exists, and it starts producing rows the moment probation tracking is populated.
 */
const CONFIRMATION_DUE_DATE =
  "COALESCE(ep.probation_end_date, DATE_ADD(e.date_of_joining, INTERVAL 90 DAY))";

const CONFIRMATION_DUE_JOIN = `
      LEFT JOIN (
        SELECT employee_id,
               MAX(COALESCE(extended_end_date, probation_end_date)) AS probation_end_date
          FROM employee_probation
         GROUP BY employee_id
      ) ep ON ep.employee_id = e.id`;

/**
 * left-employee-export
 *
 * Promoted from the inline case block so the screen and the downloaded XLSX run one
 * implementation. It had no executor at all, so the export handler — which calls
 * executeReport() directly and never sees the inline switch — answered 404 "This report is not
 * yet available" on a report whose entire purpose is to be exported.
 *
 * Moved only after the operator-precedence defect in its WHERE was fixed. The clause
 * "active_status = 0 OR employment_status IN (...)" was pushed unparenthesised into an array
 * joined with AND, which re-associated the whole predicate: super_admin received 57,501 rows
 * where 1,574 was correct, and a branch-scoped user received 1,338 rows every one of which
 * belonged to another branch. Promoting it before that would have carried a scope bypass into
 * a second code path.
 *
 * SQL copied verbatim, including the COALESCE(..., '') blanks. Those are this sheet's
 * existing rendering, not the NULLs the UNASSIGNED convention addresses, and changing them here
 * would mean the promotion could not be verified as a no-op.
 *
 * The two correlated subqueries are also carried unchanged: the latest exit_request per
 * employee, and the latest salary snapshot per employee via a row-constructor IN. Both are
 * slow — this report takes roughly 15s even with the predicate corrected — but rewriting them
 * is an optimisation, and an optimisation hidden inside a move is not verifiable as either.
 */
export async function leftEmployeeExport(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const from = dateParam(filters.from, `${new Date().getFullYear()}-01-01`);
  const to   = dateParam(filters.to, new Date().toISOString().slice(0, 10));

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  // Parentheses are load-bearing: this array is joined with AND, which binds tighter than OR.
  clauses.push("(e.active_status = 0 OR e.employment_status IN ('resigned','inactive','Resigned','Exit'))");
  clauses.push("COALESCE(e.date_of_leaving, e.date_of_exit) BETWEEN ? AND ?");
  params.push(from, to);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?"); params.push(options.cursor);
  }

  const base = `
    SELECT
      e.id AS _cursor,
      e.employee_code AS emp_code,
      CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS emp_name,
      COALESCE(dept.dept_name, '') AS department,
      COALESCE(desig.designation_name, '') AS designation,
      COALESCE(b.branch_name, '') AS branch_name,
      COALESCE(cc.cost_centre_name, '') AS cost_center,
      COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
      COALESCE(e.mobile, '') AS mobile_no,
      DATE_FORMAT(e.date_of_joining, '%Y-%m-%d') AS doj,
      DATE_FORMAT(COALESCE(e.date_of_leaving, e.date_of_exit), '%Y-%m-%d') AS left_date,
      COALESCE(er.exit_reason_category, '') AS left_remarks,
      COALESCE(e.source, '') AS source,
      COALESCE(e.sub_source, '') AS sub_source,
      COALESCE(ess.net_in_hand, esa.ctc_annual / 12, 0) AS net_in_hand,
      COALESCE(esa.ctc_annual, 0) AS offered_ctc
    FROM employees e
    LEFT JOIN department_master dept ON dept.id = e.department_id
    LEFT JOIN designation_master desig ON desig.id = e.designation_id
    LEFT JOIN branch_master b ON b.id = e.branch_id
    LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
    LEFT JOIN process_master p ON p.id = e.process_id
    LEFT JOIN exit_request er ON er.employee_id = e.id
          AND er.status IN ('confirmed','cleared','completed')
          AND er.id = (SELECT id FROM exit_request WHERE employee_id = e.id ORDER BY created_at DESC LIMIT 1)
    LEFT JOIN (
      SELECT employee_id, net_in_hand
      FROM employee_salary_snapshot
      WHERE (employee_id, snapshot_date) IN (
        SELECT employee_id, MAX(snapshot_date) FROM employee_salary_snapshot GROUP BY employee_id
      )
    ) ess ON ess.employee_id = e.id
    LEFT JOIN employee_salary_assignment esa ON esa.employee_id = e.id AND esa.active_status = 1
    WHERE ${clauses.join(" AND ")}
    ORDER BY left_date DESC, e.employee_code
  `;

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

/**
 * bank-missing
 *
 * Promoted from the inline case block. It had no executor, so the export handler — which calls
 * executeReport() directly and never reaches the inline switch — answered 404 on download while
 * the screen rendered normally.
 *
 * SQL copied verbatim. Note the predicate is deliberately asymmetric: the LEFT JOIN restricts to
 * the primary, active bank record, and the WHERE then keeps only employees where that record is
 * absent or unverified. An employee with a verified primary account and a stale secondary one is
 * correctly excluded, which is the point of the report.
 */
export async function bankMissing(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.active_status = 1");

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?"); params.push(options.cursor);
  }

  const base = `    SELECT
           e.id AS _cursor,
           e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           CASE WHEN ebd.id IS NULL THEN 'MISSING_BANK' WHEN COALESCE(ebd.verified,0)=0 THEN 'UNVERIFIED_BANK' ELSE 'OK' END AS bank_status,
           CASE WHEN e.active_status = 1 THEN 'Active' ELSE 'Inactive' END AS employee_status
      FROM employees e
      LEFT JOIN employee_bank_detail ebd ON ebd.employee_id = e.id AND ebd.active_status = 1 AND ebd.is_primary = 1
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     AND (ebd.id IS NULL OR COALESCE(ebd.verified,0)=0)
     ORDER BY bank_status DESC, employee_name`;

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

/**
 * increment-requests
 *
 * Promoted from the inline case block, which had no executor and so could not be downloaded.
 *
 * The inline version guarded its WHERE with a ternary that fell back to 1=1 when no scope
 * clause had been added. That guard is unnecessary here and deliberately not carried: an
 * executor always seeds the array, so the clause list is never empty and a fallback that can
 * never fire only invites someone to trust it later.
 */
export async function incrementRequests(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("sir.id > ?"); params.push(options.cursor);
  }

  const base = `    SELECT
           sir.id AS _cursor,
           sir.id, e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           sir.current_ctc, sir.proposed_ctc, sir.increment_percentage, sir.effective_from, sir.status,
           sir.communication_status, sir.letter_status, sir.created_at
      FROM salary_increment_request sir
      JOIN employees e ON e.id = sir.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY ${options.mode === "worker" ? "sir.id ASC" : "sir.created_at DESC"}`;

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

export async function confirmationDueList(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.active_status = 1", "e.employment_status = 'probation'");
  clauses.push(`${CONFIRMATION_DUE_DATE} <= ?`);
  params.push(to);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?"); params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           e.date_of_joining,
           ${CONFIRMATION_DUE_DATE} AS confirmation_due_date,
           DATEDIFF(CURDATE(), ${CONFIRMATION_DUE_DATE}) AS overdue_days,
           CASE WHEN e.active_status = 1 THEN 'Active' ELSE 'Inactive' END AS employee_status,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name, d.dept_name AS department_name
      FROM employees e
      LEFT JOIN branch_master b     ON b.id = e.branch_id
      LEFT JOIN process_master p    ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
      LEFT JOIN department_master d ON d.id = e.department_id${CONFIRMATION_DUE_JOIN}
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

// ---------------------------------------------------------------------------
// contract-expiry-list
// ---------------------------------------------------------------------------
export async function contractExpiryList(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.active_status = 1", "ec.contract_end_date IS NOT NULL");
  clauses.push("ec.contract_end_date <= ?");
  params.push(to);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?"); params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           e.date_of_joining, ec.contract_end_date,
           DATEDIFF(ec.contract_end_date, CURDATE()) AS days_to_expiry,
           CASE WHEN e.active_status = 1 THEN 'Active' ELSE 'Inactive' END AS employee_status,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name, d.dept_name AS department_name
      FROM employees e
      LEFT JOIN branch_master b     ON b.id = e.branch_id
      LEFT JOIN process_master p    ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
      LEFT JOIN department_master d ON d.id = e.department_id
      -- employees has no contract_end_date; the real column is on employee_contract, which this
      -- query never joined, so every run threw ER_BAD_FIELD_ERROR. Aggregated per employee because
      -- employee_contract holds one row per contract, renewals included, and a plain join would
      -- return an employee once per contract and inflate every count. MAX() is the latest expiry,
      -- which is what an expiry report is asking about.
      LEFT JOIN (
        SELECT employee_id, MAX(contract_end_date) AS contract_end_date
          FROM employee_contract
         GROUP BY employee_id
      ) ec ON ec.employee_id = e.id
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

// ---------------------------------------------------------------------------
// lifecycle-events
// ---------------------------------------------------------------------------
export async function lifecycleEvents(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, `${new Date().getFullYear()}-01-01`);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["el.id IS NOT NULL"];
  const params: unknown[]  = [];
  // Scope filtering on employee dimension
  // Was branch-only, so a process-restricted viewer saw salary increments for
  // every process in their branch. This report exposes current_ctc and
  // proposed_ctc across 14,467 salary_increment_request rows; NOIDA alone runs
  // 20 processes over 351 employees, 26 users hold an explicit
  // scope_type='process' assignment, and any employee with a process_id
  // resolves to a restricted process scope (983 active).
  //
  // appendScopeConditions is what the other 99 report functions use: branch AND
  // process AND department AND cost centre, plus the access-denied and sentinel
  // handling the inline version never had.
  appendScopeConditions(scope, clauses, params, "e");
  // employee_lifecycle_event records effective_date, not event_date.
  clauses.push("el.effective_date BETWEEN ? AND ?");
  params.push(from, to);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("el.id > ?"); params.push(options.cursor);
  }

  const base = `
    SELECT el.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           el.event_type,
           el.effective_date AS event_date,
           el.remarks AS event_detail,
           el.effective_date,
           -- the table stores initiated_by as a user id and carries no name column;
           -- report it as not-tracked rather than failing the whole query.
           NULL AS created_by_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name
      FROM employee_lifecycle_event el
      JOIN employees e ON e.id = el.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY el.id ASC`;

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

/**
 * increment-promotion-history
 *
 * Aligned with the inline block. Screen showed 1,408 rows and the download 1,368, with five
 * columns in the file that the catalogue does not name and six on screen that it does.
 *
 * Reads employee_job_history, which records both increments and promotions — change_type
 * distinguishes them, and the old/new designation and CTC pairs are what make a row meaningful.
 * Dropping either pair would leave a row saying something changed without saying what.
 */
export async function incrementPromotionHistory(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const from = dateParam(filters.from, `${new Date().getFullYear()}-01-01`);
  const to   = dateParam(filters.to, new Date().toISOString().slice(0, 10));

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params, "e");
  appendFilterConditions(filters, clauses, params);
  clauses.push("ejh.effective_date BETWEEN ? AND ?");
  params.push(from, to);

  const base = `
    SELECT e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(zpm.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(zcc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(zcc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           ejh.change_type, ejh.effective_date,
           fd.designation_name AS old_designation, td.designation_name AS new_designation,
           ejh.from_ctc_annual AS old_ctc, ejh.to_ctc_annual AS new_ctc,
           ejh.reason AS remarks
      FROM employee_job_history ejh
      JOIN employees e ON e.id = ejh.employee_id
      LEFT JOIN designation_master fd ON fd.id = ejh.from_designation_id
      LEFT JOIN designation_master td ON td.id = ejh.to_designation_id
      LEFT JOIN cost_centre_master zcc ON zcc.id = e.cost_centre_id
      LEFT JOIN process_master zpm ON zpm.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY ejh.effective_date DESC`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length, nextCursor: null };
}

// ---------------------------------------------------------------------------
// birthday-list
// ---------------------------------------------------------------------------
/**
 * birthday-list
 *
 * Every active employee with a date_of_birth, ordered by how soon the date falls — not just the
 * current month.
 *
 * This executor filtered MONTH(date_of_birth) = the current month, so the screen listed 1,116
 * people and the downloaded file 126. The catalogue settles it: it declares
 * days_until_birthday, which only makes sense across the whole year, and the month filter
 * would make that column constant within a single page.
 *
 * Ported from the inline block verbatim so both paths run one implementation.
 */
export async function birthdayList(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.active_status = 1", "e.date_of_birth IS NOT NULL");

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?"); params.push(options.cursor);
  }

  const base = `    SELECT
           e.id AS _cursor,
           e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           e.date_of_birth,
           DATE_FORMAT(e.date_of_birth, '%d %b') AS birthday_display,
           DATEDIFF(
           DATE(CONCAT(YEAR(CURDATE()), '-', MONTH(e.date_of_birth), '-', DAY(e.date_of_birth))),
           CURDATE()
           ) + IF(
           DATE(CONCAT(YEAR(CURDATE()), '-', MONTH(e.date_of_birth), '-', DAY(e.date_of_birth))) < CURDATE(), 365, 0
           ) AS days_until_birthday,
           CASE WHEN e.active_status = 1 THEN 'Active' ELSE 'Inactive' END AS employee_status,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(d.dept_name, 'UNASSIGNED') AS department_name,
           COALESCE(pr.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(ccm.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(ccm.cost_centre_name, 'UNASSIGNED') AS cost_centre_name
      FROM employees e
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN department_master d ON d.id = e.department_id
      LEFT JOIN process_master pr ON pr.id = e.process_id
      LEFT JOIN cost_centre_master ccm ON ccm.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY days_until_birthday ASC`;

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
// anniversary-list
// ---------------------------------------------------------------------------
/**
 * anniversary-list
 *
 * Every active employee with a date_of_joining, ordered by how soon the date falls — not just the
 * current month.
 *
 * This executor filtered MONTH(date_of_joining) = the current month, so the screen listed 1,127
 * people and the downloaded file 66. The catalogue settles it: it declares
 * days_until_anniversary, which only makes sense across the whole year, and the month filter
 * would make that column constant within a single page.
 *
 * Ported from the inline block verbatim so both paths run one implementation.
 */
export async function anniversaryList(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.active_status = 1", "e.date_of_joining IS NOT NULL");

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?"); params.push(options.cursor);
  }

  const base = `    SELECT
           e.id AS _cursor,
           e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           e.date_of_joining,
           TIMESTAMPDIFF(YEAR, e.date_of_joining, CURDATE()) AS years_of_service,
           DATEDIFF(
           DATE(CONCAT(YEAR(CURDATE()), '-', MONTH(e.date_of_joining), '-', DAY(e.date_of_joining))),
           CURDATE()
           ) + IF(
           DATE(CONCAT(YEAR(CURDATE()), '-', MONTH(e.date_of_joining), '-', DAY(e.date_of_joining))) < CURDATE(), 365, 0
           ) AS days_until_anniversary,
           CASE WHEN e.active_status = 1 THEN 'Active' ELSE 'Inactive' END AS employee_status,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(d.dept_name, 'UNASSIGNED') AS department_name,
           COALESCE(pr.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(ccm.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(ccm.cost_centre_name, 'UNASSIGNED') AS cost_centre_name
      FROM employees e
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN department_master d ON d.id = e.department_id
      LEFT JOIN process_master pr ON pr.id = e.process_id
      LEFT JOIN cost_centre_master ccm ON ccm.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY days_until_anniversary ASC`;

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
// org-mapping-gaps
//
// The counterpart to rendering UNASSIGNED rather than dropping unmapped rows: this is
// where those rows become someone's work. One row per active employee missing at least
// one org attribute, with the missing ones named.
//
// Baseline against live mas_hrms, 2026-08-07 — 200 of 1,125 active employees have at
// least one gap:
//   cost centre    64 missing
//   process       143 missing
//   designation   119 missing
//   manager       153 missing   (COALESCE(reporting_manager_id, manager_id); counting
//                                reporting_manager_id alone gives 162, which is why the
//                                COALESCE matters — 9 employees are mapped only via the
//                                duplicate manager_id column)
//   department     13 missing
//   branch         10 missing
// ---------------------------------------------------------------------------
export async function orgMappingGaps(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push(`(
    e.cost_centre_id IS NULL
    OR e.process_id IS NULL
    OR e.designation_id IS NULL
    OR e.department_id IS NULL
    OR e.branch_id IS NULL
    OR COALESCE(e.reporting_manager_id, e.manager_id) IS NULL
  )`);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           ${identitySpineSelect("e")},
           CASE WHEN e.active_status = 1 THEN 'Active' ELSE 'Inactive' END AS employee_status,
           CONCAT_WS(', ',
             CASE WHEN e.cost_centre_id IS NULL THEN 'COST_CENTRE' END,
             CASE WHEN e.process_id     IS NULL THEN 'PROCESS' END,
             CASE WHEN e.designation_id IS NULL THEN 'DESIGNATION' END,
             CASE WHEN e.department_id  IS NULL THEN 'DEPARTMENT' END,
             CASE WHEN e.branch_id      IS NULL THEN 'BRANCH' END,
             CASE WHEN COALESCE(e.reporting_manager_id, e.manager_id) IS NULL THEN 'REPORTING_MANAGER' END
           ) AS missing_attributes,
           (
             (e.cost_centre_id IS NULL) + (e.process_id IS NULL) + (e.designation_id IS NULL)
             + (e.department_id IS NULL) + (e.branch_id IS NULL)
             + (COALESCE(e.reporting_manager_id, e.manager_id) IS NULL)
           ) AS missing_count
      FROM employees e
      ${identitySpineJoins("e")}
     WHERE ${clauses.join(" AND ")}
     ORDER BY missing_count DESC, e.id ASC`;

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
// employee-status-conflicts
//
// active_status and employment_status are two independent flags that can contradict each
// other. Standardising every report on active_status (2026-08-07) means a row flagged
// active_status = 1 but employment_status 'resigned' is now counted as a current
// employee — correct for consistency, and exactly the row HR needs to see and resolve.
//
// This is the safety net for that decision, so nothing is hidden rather than fixed.
// Baseline: 2 rows (one 'inactive', one 'resigned'). It also reports the reverse case —
// active_status = 0 with an active-looking employment_status — which would otherwise be
// invisible to every report, since they all filter to active_status = 1.
// ---------------------------------------------------------------------------
export async function employeeStatusConflicts(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  // Deliberately not filtered to active_status = 1: half the point is the rows where
  // active_status = 0 disagrees with employment_status.
  clauses.push(`(
    (e.active_status = 1 AND LOWER(COALESCE(e.employment_status,'active')) <> 'active')
    OR (e.active_status = 0 AND LOWER(COALESCE(e.employment_status,'')) = 'active')
  )`);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           ${identitySpineSelect("e")},
           CASE
             WHEN e.active_status = 1 THEN 'ACTIVE_FLAG_BUT_INACTIVE_STATUS'
             ELSE 'INACTIVE_FLAG_BUT_ACTIVE_STATUS'
           END AS conflict_type,
           e.date_of_exit,
           e.date_of_leaving,
           e.resignation_date,
           CASE
             WHEN e.active_status = 1
               THEN 'Counted as active by every report. Resolve employment_status or clear active_status.'
             ELSE 'Excluded from every report despite an active employment_status.'
           END AS reporting_impact
      FROM employees e
      ${identitySpineJoins("e")}
     WHERE ${clauses.join(" AND ")}
     ORDER BY e.active_status DESC, e.id ASC`;

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
