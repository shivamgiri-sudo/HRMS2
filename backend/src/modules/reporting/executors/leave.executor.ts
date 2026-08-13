/**
 * Leave & Absence executor
 *
 * Codes: leave-balance, leave-allocation-register, leave-utilization,
 *        leave-trend-monthly, leave-lwp-reconciliation, maternity-paternity-register,
 *        leave-encashment-register, leave-lapse-summary, holiday-master-list
 *
 * Notes:
 *  - leave_balance_ledger actual columns: balance_year (INT), allocated_days (DECIMAL),
 *    used_days (DECIMAL), adjusted_days (DECIMAL).  No opening_balance / credited /
 *    debited / closing_balance columns exist.
 *  - leave-balance cursor is on e.id (approximate for cross-joined rows — all leave-type
 *    rows for one employee share the same cursor value, so chunk row-count varies).
 *  - leave-encashment-register targets leave_encashment_request; if that table is absent
 *    at runtime, implement a leave_request fallback with an appropriate type filter.
 *  - holiday-master-list expects hm.company_id for tenant isolation; process / dept /
 *    cost-centre scope dimensions are not applicable to this table.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import type { ExecFilters, ExecScope, ExecOptions, ExecResult } from "./types.js";
import {
  appendScopeConditions,
  appendFilterConditions,
  dateParam,
  monthParam,
  monthRange,
  yearParam,
  applyPagination,
  fetchPageWithTotal,
  ReportScopeAccessDeniedError,
  ReportSourceUnavailableError,
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
// leave-balance
// ---------------------------------------------------------------------------
/**
 * Classifies a leave_type_master row into one of the four business report buckets.
 *
 * Order matters. Maternity/paternity are tested FIRST because this deployment's
 * leave_type_master stores leave_code 'ML' for *Maternity* Leave (180 days) while
 * *Medical/Sick* leave is stored as 'SL'. The report's "ML" column means medical
 * leave, so matching on leave_name before leave_code prevents maternity being
 * counted in the ML column and simultaneously in PTL/MTL.
 *
 * Matching on both name and code keeps this correct across deployments that use
 * the legacy PTRL/MTRL aliases.
 */
const LEAVE_BUCKET_SQL = `
  CASE
    WHEN LOWER(lt.leave_name) LIKE '%matern%' OR lt.leave_code IN ('MTL','MTRL')      THEN 'PTLMTL'
    WHEN LOWER(lt.leave_name) LIKE '%patern%' OR lt.leave_code IN ('PTL','PTRL')      THEN 'PTLMTL'
    WHEN LOWER(lt.leave_name) LIKE '%casual%' OR lt.leave_code IN ('CL','CAS')        THEN 'CL'
    WHEN LOWER(lt.leave_name) LIKE '%earned%' OR LOWER(lt.leave_name) LIKE '%privilege%'
         OR lt.leave_code IN ('EL','PL_E')                                            THEN 'EL'
    WHEN LOWER(lt.leave_name) LIKE '%sick%'   OR LOWER(lt.leave_name) LIKE '%medical%'
         OR lt.leave_code IN ('SL','MED')                                             THEN 'ML'
    ELSE NULL
  END`;

/**
 * Authoritative per-bucket aggregates, reusing the same balance arithmetic the
 * Leave module already applies in leave_balance_ledger:
 *
 *   Current = allocated_days + adjusted_days   (credited before usage, incl. approved adjustments)
 *   Taken   = used_days                        (approved/posted usage only)
 *   Remain  = allocated_days + adjusted_days - used_days
 *
 * No new leave-policy calculation is introduced here and no entitlement value
 * (4 / 180 / etc.) is hardcoded — every figure comes from the ledger.
 */
function bucketAggregates(): string {
  const buckets: Array<[string, string]> = [
    ['cl', 'CL'], ['ml', 'ML'], ['el', 'EL'], ['ptl_mtl', 'PTLMTL'],
  ];
  const parts: string[] = [];
  for (const [prefix, bucket] of buckets) {
    parts.push(
      `ROUND(COALESCE(SUM(CASE WHEN ${LEAVE_BUCKET_SQL} = '${bucket}' ` +
      `THEN COALESCE(lbl.allocated_days,0) + COALESCE(lbl.adjusted_days,0) END),0),2) AS ${prefix}_current`
    );
  }
  for (const [prefix, bucket] of buckets) {
    parts.push(
      `ROUND(COALESCE(SUM(CASE WHEN ${LEAVE_BUCKET_SQL} = '${bucket}' ` +
      `THEN COALESCE(lbl.used_days,0) END),0),2) AS ${prefix}_taken`
    );
  }
  for (const [prefix, bucket] of buckets) {
    // Floored at 0 to match leaveService.getBalance(), the canonical UI path —
    // without this, this report could show a negative remaining balance the
    // UI shows as 0 for the same employee/bucket. (2026-08-13 audit)
    parts.push(
      `GREATEST(0, ROUND(COALESCE(SUM(CASE WHEN ${LEAVE_BUCKET_SQL} = '${bucket}' ` +
      `THEN COALESCE(lbl.allocated_days,0) + COALESCE(lbl.adjusted_days,0) ` +
      `- COALESCE(lbl.used_days,0) END),0),2)) AS ${prefix}_remain`
    );
  }
  return parts.join(',\n           ');
}

/**
 * leave-balance — one row per employee, CL / ML / EL / PTL-MTL pivoted into
 * Current / Taken / Remain column groups.
 *
 * Grain is strictly one row per employee (primary key: employee code). Employees
 * with no ledger row for a leave type still appear, with 0 for that type, because
 * leave_balance_ledger is LEFT JOINed onto employees.
 *
 * The reporting month selects the ledger balance_year. The year is a validated
 * safe integer embedded as a literal to avoid positional-? conflicts between the
 * JOIN ON parameter and the WHERE parameters.
 */
export async function leaveBalance(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  // Month drives the report; fall back to `year` for backward compatibility.
  const month = monthParam(filters.month);
  const year  = filters.month ? Number(month.slice(0, 4)) : yearParam(filters.year);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.active_status = 1");

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  // Worker mode keysets on e.id, so it must order by e.id to stay consistent.
  // Preview/export use the business default sort: EmpCode ascending.
  const orderBy = options.mode === "worker"
    ? "e.id ASC"
    : "e.employee_code ASC, e.id ASC";

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code AS emp_code,
           COALESCE(NULLIF(e.full_name,''), TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS emp_name,
           COALESCE(b.branch_name,'') AS branch_name,
           -- Canonical master relationship only. The legacy denormalised
           -- employees.cost_center free-text column is deliberately not used.
           COALESCE(NULLIF(cc.cost_centre_name,''), NULLIF(cc.cost_centre_code,''), '') AS cost_center,
           COALESCE(p.process_name,'') AS process_name,
           ${bucketAggregates()}
      FROM employees e
      LEFT JOIN branch_master b       ON b.id  = e.branch_id
      LEFT JOIN process_master p      ON p.id  = e.process_id
      LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
      LEFT JOIN leave_balance_ledger lbl
             ON lbl.employee_id = e.id
            AND lbl.balance_year = ${year}
      -- active_status = 1 is REQUIRED, not cosmetic. Production retains retired
      -- leave types that still hold ledger history: 'SL' (Sick Leave, retired in
      -- favour of 'ML' Medical Leave) and 'PL' (Paternity, superseded by 'PTRL').
      -- Without this filter SL is summed into the ML column on top of ML, and PL
      -- into PTL/MTL on top of PTRL/MTRL — double-counting retired entitlements.
      LEFT JOIN leave_type_master lt  ON lt.id = lbl.leave_type_id
                                     AND lt.active_status = 1
     WHERE ${clauses.join(" AND ")}
     GROUP BY e.id, e.employee_code, e.full_name, e.first_name, e.last_name,
              b.branch_name, cc.cost_centre_name, cc.cost_centre_code, p.process_name
     ORDER BY ${orderBy}`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return {
    rows: out,
    rowCount: options.includeTotal ? total : rows.length,
    isTruncated: options.includeTotal ? total > out.length : rows.length === options.limit,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// leave-allocation-register
// ---------------------------------------------------------------------------
export async function leaveAllocationRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  if (filters.year) {
    clauses.push("la.balance_year = ?");
    params.push(yearParam(filters.year));
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("la.id > ?");
    params.push(options.cursor);
  }

  // Allocations live in leave_balance_ledger. There is no `leave_allocation` table in
  // mas_hrms and there never has been (verified 2026-08-07) — the catch below turned the
  // resulting ER_NO_SUCH_TABLE into an empty result, so this report has always shown
  // zero allocations against a ledger holding 4,656 rows for 2026 alone.
  //
  // The ledger has no effective_from/effective_to/allocation_reason columns, so those are
  // not emitted rather than faked. It does carry adjusted_days and used_days, which are
  // part of the same allocation picture, so they are included.
  const base = `
    SELECT la.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           lt.leave_name, lt.leave_code,
           la.balance_year, la.allocated_days, la.adjusted_days, la.used_days,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name
      FROM leave_balance_ledger la
      JOIN employees e           ON e.id  = la.employee_id
      JOIN leave_type_master lt  ON lt.id = la.leave_type_id
      LEFT JOIN branch_master b  ON b.id  = e.branch_id
      LEFT JOIN process_master p ON p.id  = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY la.id ASC`;

  try {
    const total = options.includeTotal ? await count(base, params) : 0;
    const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
    const rows  = await query(sql, params) as Record<string, unknown>[];
    const nextCursor = (options.mode === "worker" && rows.length > 0)
      ? (rows[rows.length - 1]._cursor as number) : null;
    const out = rows.map(({ _cursor: _, ...rest }) => rest);
    return {
      rows: out,
      rowCount: options.includeTotal ? total : rows.length,
      isTruncated: options.includeTotal ? total > out.length : rows.length === options.limit,
      nextCursor,
    };
  } catch (err: unknown) {
    const mysqlCode = (err as Record<string, unknown>)?.["code"];
    if (mysqlCode === "ER_NO_SUCH_TABLE" || mysqlCode === "ER_BAD_TABLE_ERROR") {
      return { rows: [], rowCount: 0, isTruncated: false };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// leave-utilization
// ---------------------------------------------------------------------------
export async function leaveUtilization(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, `${new Date().getFullYear()}-01-01`);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("lr.status = 'approved'");
  clauses.push("lr.from_date BETWEEN ? AND ?");
  params.push(from, to);

  // Grain is one row per leave request, so the keyset cursor is the request id.
  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("lr.id > ?");
    params.push(options.cursor);
  }

  // One row per approved leave request, matching the business-supplied format:
  // SR# | EMPLOYEE_CODE | EMPLOYEE_NAME | LEAVE_NAME | LEAVE TYPE | DAYS_USED |
  // START DATE | END DATE | BRANCH_NAME | PROCESS_NAME | LEAVE REQUST DATE |
  // LEAVE APPROVED DATE | APPROVED BY | LEAVE REMARKS
  //
  // Previously this aggregated with GROUP BY + SUM(total_days) + COUNT(*), which
  // collapsed each employee's requests into one row per leave type and could not
  // carry per-request dates. Maternity and paternity requests appear here like any
  // other leave type, so a separate register is no longer needed.
  //
  // Dates render as dd-MMM-yy (30-Jul-26) to match the supplied format.
  const base = `
    SELECT lr.id AS _cursor,
           ROW_NUMBER() OVER (ORDER BY lr.from_date DESC, e.employee_code ASC) AS sr_no,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS employee_name,
           COALESCE(zcc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(zcc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           lt.leave_name,
           lt.leave_code AS leave_type,
           lr.total_days AS days_used,
           DATE_FORMAT(lr.from_date, '%d-%b-%y') AS start_date,
           DATE_FORMAT(lr.to_date,   '%d-%b-%y') AS end_date,
           COALESCE(b.branch_name, '')  AS branch_name,
           COALESCE(p.process_name, '') AS process_name,
           COALESCE(DATE_FORMAT(COALESCE(lr.requested_at, lr.applied_at), '%d-%b-%y'), '') AS leave_request_date,
           -- Both of these render blank on every row today, and it is the data not the SQL:
           -- leave_request.approved_at and approved_by are NULL on all 2,678 rows (measured
           -- 2026-08-10), even for requests whose status IS 'approved'. So the approval is
           -- recorded as a status but never stamped with who or when. Left as-is rather than
           -- substituted with updated_at, which would put a fabricated approval date in front of
           -- a reader; the columns start filling the moment the approval path writes them.
           COALESCE(DATE_FORMAT(lr.approved_at, '%d-%b-%y'), '') AS leave_approved_date,
           COALESCE(NULLIF(appr.employee_code,''), NULLIF(lr.approved_by,''), '') AS approved_by,
           COALESCE(NULLIF(lr.reason,''), '') AS leave_remarks
      FROM leave_request lr
      JOIN employees e           ON e.id  = lr.employee_id
      JOIN leave_type_master lt  ON lt.id = lr.leave_type_id
      LEFT JOIN branch_master b  ON b.id  = e.branch_id
      LEFT JOIN process_master p ON p.id  = e.process_id
      LEFT JOIN employees appr   ON appr.id = lr.approved_by
      LEFT JOIN cost_centre_master zcc ON zcc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY lr.from_date DESC, e.employee_code ASC`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return {
    rows: out,
    rowCount: options.includeTotal ? total : rows.length,
    isTruncated: options.includeTotal ? total > out.length : rows.length === options.limit,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// leave-trend-monthly
// ---------------------------------------------------------------------------
/**
 * Pure aggregate — no cursor.  applyPagination is used in all modes including worker.
 */
export async function leaveTrendMonthly(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, `${new Date().getFullYear()}-01-01`);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("lr.status = 'approved'");
  clauses.push("lr.from_date BETWEEN ? AND ?");
  params.push(from, to);

  const base = `
    SELECT LEFT(lr.from_date,7) AS leave_month,
           lt.leave_name, lt.leave_code,
           SUM(lr.total_days) AS total_days,
           COUNT(DISTINCT lr.employee_id) AS employee_count,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name
      FROM leave_request lr
      JOIN employees e           ON e.id  = lr.employee_id
      JOIN leave_type_master lt  ON lt.id = lr.leave_type_id
      LEFT JOIN branch_master b  ON b.id  = e.branch_id
      LEFT JOIN process_master p ON p.id  = e.process_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY LEFT(lr.from_date,7),
              lt.id, lt.leave_name, lt.leave_code,
              b.branch_name, p.process_name
     ORDER BY leave_month ASC, lt.leave_name ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = applyPagination(base, options); // always — aggregate report has no cursor
  const rows  = await query(sql, params) as Record<string, unknown>[];
  return {
    rows,
    rowCount: options.includeTotal ? total : rows.length,
    isTruncated: total > rows.length,
  };
}

// ---------------------------------------------------------------------------
// leave-lwp-reconciliation
// ---------------------------------------------------------------------------
/**
 * leave-lwp-reconciliation
 *
 * Attendance LWP against payroll LWP, per employee, for one month.
 *
 * This executor and the inline block returned different reports: 650 rows on screen against
 * 1,569 in the downloaded file. The catalogue declares eight columns — employee_code,
 * employee_name, process_name, cost_centre_code, cost_centre_name, lwp_days_attendance,
 * lwp_days_payroll, variance — which is exactly the inline shape. The executor emitted its own
 * set including branch_name and omitting the payroll side's framing.
 *
 * Ported verbatim from the inline block, which carries a correction made earlier in this audit
 * that this executor never had: the salary_prep_run placeholder sits inside a LEFT JOIN, which
 * binds before the WHERE, so the month must be unshifted to the front of the parameter list.
 * With it pushed last, a branch-scoped user's branch id was bound as the run month and the
 * report returned nothing at all — 0 rows against 200, measured when that was fixed.
 *
 * The month filter keeps the inline block's DATE_FORMAT form rather than being rewritten to a
 * sargable range, so this stays a move rather than a move plus an optimisation.
 */
export async function leaveLwpReconciliation(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const month = monthParam(filters.month);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("DATE_FORMAT(adr.record_date,'%Y-%m') = ?");
  params.push(month);

  const base = `    SELECT e.id AS _cursor,
           e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(zpm.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(zcc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(zcc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           SUM(adr.lwp_value) AS lwp_days_attendance,
           COALESCE(spl.lwp_days, 0) AS lwp_days_payroll,
           SUM(adr.lwp_value) - COALESCE(spl.lwp_days, 0) AS variance
      FROM attendance_daily_record adr
      JOIN employees e ON e.id = adr.employee_id
      LEFT JOIN salary_prep_run spr ON spr.run_month = ?
      LEFT JOIN salary_prep_line spl ON spl.employee_id = e.id AND spl.run_id = spr.id
      LEFT JOIN cost_centre_master zcc ON zcc.id = e.cost_centre_id
      LEFT JOIN process_master zpm ON zpm.id = e.process_id
     WHERE ${clauses.join(" AND ")} AND adr.lwp_value > 0
     GROUP BY e.id, e.employee_code, e.first_name, e.last_name, spl.lwp_days
     HAVING lwp_days_attendance > 0
     ORDER BY ABS(variance) DESC`;

  // The salary_prep_run placeholder is in the JOIN, which binds before the WHERE.
  params.unshift(month);

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor: null };
}

// ---------------------------------------------------------------------------
// maternity-paternity-register
// ---------------------------------------------------------------------------
export async function maternityPaternityRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push(
    "(lt.leave_code IN ('MAT','PAT','ML','PL') OR LOWER(lt.leave_name) LIKE '%maternity%' OR LOWER(lt.leave_name) LIKE '%paternity%')"
  );

  if (filters.from || filters.to) {
    const today = new Date().toISOString().slice(0, 10);
    const from  = dateParam(filters.from, `${new Date().getFullYear()}-01-01`);
    const to    = dateParam(filters.to, today);
    clauses.push("lr.from_date BETWEEN ? AND ?");
    params.push(from, to);
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("lr.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT lr.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           lt.leave_name,
           lr.from_date, lr.to_date, lr.total_days,
           lr.status AS approval_status,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name
      FROM leave_request lr
      JOIN employees e           ON e.id  = lr.employee_id
      JOIN leave_type_master lt  ON lt.id = lr.leave_type_id
      LEFT JOIN branch_master b  ON b.id  = e.branch_id
      LEFT JOIN process_master p ON p.id  = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY lr.id ASC`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return {
    rows: out,
    rowCount: options.includeTotal ? total : rows.length,
    isTruncated: options.includeTotal ? total > out.length : rows.length === options.limit,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// leave-encashment-register
// ---------------------------------------------------------------------------
/**
 * Targets the dedicated leave_encashment_request table.
 * If that table does not exist at runtime, implement a fallback against
 * leave_request WHERE leave_type_code = 'encashment' or equivalent.
 */
export async function leaveEncashmentRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  if (filters.from || filters.to) {
    const today = new Date().toISOString().slice(0, 10);
    const from  = dateParam(filters.from, `${new Date().getFullYear()}-01-01`);
    const to    = dateParam(filters.to, today);
    clauses.push("ler.requested_date BETWEEN ? AND ?");
    params.push(from, to);
  }

  if (filters.status) {
    clauses.push("ler.approval_status = ?");
    params.push(String(filters.status));
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("ler.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT ler.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           lt.leave_name, lt.leave_code,
           ler.encashment_days, ler.amount,
           ler.approval_status, ler.requested_date,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name
      FROM leave_encashment_request ler
      JOIN employees e           ON e.id  = ler.employee_id
      JOIN leave_type_master lt  ON lt.id = ler.leave_type_id
      LEFT JOIN branch_master b  ON b.id  = e.branch_id
      LEFT JOIN process_master p ON p.id  = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY ler.id ASC`;

  try {
    const total = options.includeTotal ? await count(base, params) : 0;
    const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
    const rows  = await query(sql, params) as Record<string, unknown>[];
    const nextCursor = (options.mode === "worker" && rows.length > 0)
      ? (rows[rows.length - 1]._cursor as number) : null;
    const out = rows.map(({ _cursor: _, ...rest }) => rest);
    return {
      rows: out,
      rowCount: options.includeTotal ? total : rows.length,
      isTruncated: options.includeTotal ? total > out.length : rows.length === options.limit,
      nextCursor,
    };
  } catch (err: unknown) {
    const mysqlCode = (err as Record<string, unknown>)?.["code"];
    if (mysqlCode === "ER_NO_SUCH_TABLE" || mysqlCode === "ER_BAD_TABLE_ERROR") {
      // leave_encashment_request does not exist in mas_hrms (verified 2026-08-07), and
      // the leave_request fallback suggested in this file's header was never built. An
      // empty result made encashment look like a settled, zero-liability question.
      throw new ReportSourceUnavailableError(
        "leave-encashment-register",
        "leave_encashment_request",
        "Leave encashment is not recorded in this database; the report is marked blocked in the catalog."
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// leave-lapse-summary
// ---------------------------------------------------------------------------
/**
 * leave-lapse-summary
 *
 * One row per employee per leave type per expired balance year.
 *
 * The executor and the inline block disagreed — 3,000 rows on screen against 2,916 in the
 * downloaded file. The catalogue declares nine columns (employee_code, employee_name,
 * process_name, cost_centre_code, cost_centre_name, leave_code, leave_name, balance_year,
 * lapsed_days), which is exactly the inline shape.
 *
 * Ported verbatim. Note the two filters that define what "lapsed" means here and must stay
 * together: only balance years BEFORE the current one, and only positive remaining balance.
 * Either one alone gives a different report — the first without the second counts fully-used
 * allocations as lapses, and the second without the first counts this year's untaken leave as
 * already gone.
 */
export async function leaveLapseSummary(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const currentYear = new Date().getFullYear();

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("lbl.balance_year < ?");
  params.push(currentYear);

  const base = `    SELECT lbl.id AS _cursor,
           e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(zpm.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(zcc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(zcc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           lt.leave_code, lt.leave_name, lbl.balance_year,
           GREATEST(lbl.allocated_days + lbl.adjusted_days - lbl.used_days, 0) AS lapsed_days
      FROM leave_balance_ledger lbl
      JOIN employees e ON e.id = lbl.employee_id
      JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
      LEFT JOIN cost_centre_master zcc ON zcc.id = e.cost_centre_id
      LEFT JOIN process_master zpm ON zpm.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     AND (lbl.allocated_days + lbl.adjusted_days - lbl.used_days) > 0
     ORDER BY employee_name, lbl.balance_year`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor: null };
}

/**
 * holiday-master-list
 *
 * Aligned with the inline block. The screen ran that block and the download ran this executor,
 * which returned a different column set — the catalogue names the inline shape.
 *
 * No row scope, deliberately and unchanged: a holiday calendar is organisation-wide reference
 * data, not employee data, so there is nothing to scope by. The branch join is descriptive — a
 * holiday may be branch-specific or apply everywhere, in which case branch_name is NULL.
 */
export async function holidayMasterList(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const year = Number(filters.year ?? new Date().getFullYear());
  const params: unknown[] = [year];

  const base = `
    SELECT lhm.holiday_date, lhm.holiday_name, lhm.holiday_type,
           lhm.active_status, b.branch_name
      FROM leave_holiday_master lhm
      LEFT JOIN branch_master b ON b.id = lhm.branch_id
     WHERE YEAR(lhm.holiday_date) = ?
     ORDER BY lhm.holiday_date ASC`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length, nextCursor: null };
}
