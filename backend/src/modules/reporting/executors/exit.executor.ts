/**
 * Exit & Attrition executor
 *
 * Covers codes: resignation-register, fnf-pending-register, fnf-settlement-register,
 * clearance-status-register, monthly-attrition-summary, exit-reason-analysis,
 * tenure-distribution, early-attrition-report
 *
 * Every query includes WHERE e.company_id = :companyId to enforce tenant isolation.
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
  fetchPageWithTotal,
  rethrowReportSchemaError,
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
// resignation-register
// ---------------------------------------------------------------------------
/**
 * ff-settlement-register
 *
 * Promoted from the inline case block, which had no executor and so could not be downloaded —
 * on a register of final settlement amounts.
 *
 * The row scope moved with it and is the reason this must not be simplified: the inline block
 * originally had none, so notice recovery, gratuity, advances recovery, salary hold and net
 * payable were returned for every branch to anyone who could open the report. Scope is enforced
 * in the query and nowhere else.
 *
 * appendScopeConditions is called before the date range so its clauses and parameters lead the
 * list, matching the order the placeholders appear in.
 */
export async function ffSettlementRegister(
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
  clauses.push("COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed) BETWEEN ? AND ?");
  params.push(from, to);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("ffc.id > ?"); params.push(options.cursor);
  }

  const base = `    SELECT
           ffc.id AS _cursor,
           e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed) AS last_working_day,
           ffc.notice_recovery, ffc.earned_leave_encashment AS leave_encashment,
           ffc.gratuity_amount, ffc.advances_recovery, ffc.salary_hold,
           ffc.net_payable AS net_ff_payable,
           ffc.status, ffc.is_ff_provisional
      FROM full_final_calculation ffc
      JOIN exit_request er ON er.id = ffc.exit_request_id
      JOIN employees e ON e.id = er.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed) DESC`;

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

export async function resignationRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, `${new Date().getFullYear()}-01-01`);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  // `eer.id IS NOT NULL` used to sit here, which turned the LEFT JOIN below into an inner
  // join and required every resignation to have an exit_request row. exit_request holds 2
  // rows in the whole database, and neither belongs to a 2026 resignation — so the register
  // returned nothing while 1,543 people resigned in the default window and 29,070 have a
  // resignation_date overall. Measured on live 2026-08-08: 1,543 in range, 0 of them with an
  // exit_request row.
  //
  // The date source was already corrected to employees.resignation_date — the comment saying
  // so is right below — but the guard requiring the exit workflow was left behind, so the
  // report still could not return a row. Same shape as the attrition reports that read an
  // empty attrition_record while 1,666 people left.
  //
  // exit_request stays a LEFT JOIN and supplies its detail where it exists. Where it does not,
  // the workflow simply was not used; those columns say so rather than rendering blank, which
  // in a register reads as missing data rather than an absent process.
  // exit_request has no resignation_date; employees.resignation_date is the real one
  // (29,070 rows populated).
  clauses.push("e.resignation_date BETWEEN ? AND ?");
  params.push(from, to);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           e.resignation_date,
           -- exit_request stores proposed and confirmed separately; neither is called
           -- last_working_day, and employees has date_of_exit rather than that name.
           COALESCE(eer.last_working_day_confirmed, eer.last_working_day_proposed, e.date_of_exit)
             AS last_working_day,
           COALESCE(eer.exit_reason_category, 'NOT_RECORDED') AS exit_reason,
           COALESCE(eer.status, 'NO_EXIT_REQUEST') AS status,
           COALESCE(eer.notice_period_days, 0) AS notice_days,
           -- Cost centre was absent and process came through as a bare NULL. Both are
           -- mandatory on an employee-grain report, and a register of leavers that cannot be
           -- read by cost centre cannot be reconciled to anything. UNASSIGNED rather than
           -- NULL: an employee with no mapping is a fact worth showing, not a blank cell.
           COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           -- Both catalogues already declared these two, so the grid drew a Designation and a
           -- DOJ column for a query that emitted neither. They come straight off employees.
           des.designation_name,
           e.date_of_joining
      FROM employees e
      LEFT JOIN exit_request eer ON eer.employee_id = e.id
      LEFT JOIN branch_master b           ON b.id = e.branch_id
      LEFT JOIN process_master p          ON p.id = e.process_id
      LEFT JOIN cost_centre_master cc     ON cc.id = e.cost_centre_id
      LEFT JOIN designation_master des    ON des.id = e.designation_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY e.id ASC`;

  try {
    const total = options.includeTotal ? await count(base, params) : 0;
    const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
    const rows  = await query(sql, params) as Record<string, unknown>[];
    const nextCursor = (options.mode === "worker" && rows.length > 0)
      ? (rows[rows.length - 1]._cursor as number) : null;
    const out = rows.map(({ _cursor: _, ...rest }) => rest);
    return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
  } catch (err: unknown) {
    // Was: return an empty result on a missing table or column. For an exit report that
    // reads as "nobody left and nothing is owed", which is the reassuring answer and so the
    // one nobody questions. All three source tables and all 22 referenced columns exist in
    // production (verified 2026-08-11), so this path is unreachable today — which is exactly
    // why it must fail loudly if that ever stops being true.
    rethrowReportSchemaError("exit", err, base);
  }
}

// ---------------------------------------------------------------------------
// fnf-pending-register
// ---------------------------------------------------------------------------
export async function fnfPendingRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  // employment_status is stored in mixed case: 28,200 rows 'Resigned' against 2,118
  // 'resigned' (measured 2026-08-07). The column collates utf8mb4_unicode_ci, which is
  // case-insensitive, so a bare lowercase IN(...) already matches all 30,318 — verified
  // both forms return the same count. The LOWER() is harmless insurance against a future
  // case-sensitive collation, not a fix for a comparison that failed.
  //
  // (An earlier note here said the lowercase form "matched nothing and this register was
  // always empty". That is not what the data shows; whatever emptied the register, it was
  // not the casing.)
  //
  // Note 'terminated' (501 rows) is deliberately still excluded — whether termination
  // belongs in the F&F pending register is a policy call, not a schema fix.
  clauses.push("LOWER(e.employment_status) IN ('resigned','separated')");
  // employees has no fnf_status. The F&F state lives on full_final_calculation,
  // reached through exit_request.
  clauses.push("COALESCE(ffc.status,'PENDING') NOT IN ('completed','settled')");

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           e.date_of_exit,
           COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed, e.date_of_exit)
             AS last_working_day,
           e.employment_status,
           COALESCE(ffc.status,'PENDING') AS fnf_status,
           DATEDIFF(CURDATE(), COALESCE(e.date_of_exit, er.last_working_day_confirmed,
                                        er.last_working_day_proposed)) AS days_since_exit,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name
      FROM employees e
      LEFT JOIN exit_request er            ON er.employee_id = e.id
      LEFT JOIN full_final_calculation ffc ON ffc.exit_request_id = er.id
      LEFT JOIN branch_master b  ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY e.id ASC`;

  try {
    const total = options.includeTotal ? await count(base, params) : 0;
    const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
    const rows  = await query(sql, params) as Record<string, unknown>[];
    const nextCursor = (options.mode === "worker" && rows.length > 0)
      ? (rows[rows.length - 1]._cursor as number) : null;
    const out = rows.map(({ _cursor: _, ...rest }) => rest);
    return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
  } catch (err: unknown) {
    // Was: return an empty result on a missing table or column. For an exit report that
    // reads as "nobody left and nothing is owed", which is the reassuring answer and so the
    // one nobody questions. All three source tables and all 22 referenced columns exist in
    // production (verified 2026-08-11), so this path is unreachable today — which is exactly
    // why it must fail loudly if that ever stops being true.
    rethrowReportSchemaError("exit", err, base);
  }
}

// ---------------------------------------------------------------------------
// fnf-settlement-register
// Actual table: full_final_calculation (011_exit_management.sql), joined via exit_request.
// ---------------------------------------------------------------------------
export async function fnfSettlementRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, `${new Date().getFullYear()}-01-01`);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.employment_status IN ('Exited','Separated','Resigned')");
  clauses.push("COALESCE(ffc.approved_at, e.date_of_exit) BETWEEN ? AND ?");
  params.push(from, to);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(xcc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(xcc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(ffc.approved_at, e.date_of_exit) AS settlement_date,
           NULL AS total_earnings,   -- full_final_calculation stores components, not a gross total
           NULL AS total_deductions, -- deriving one would be inventing payroll arithmetic
           COALESCE(ffc.net_payable, 0)       AS net_payable,
           COALESCE(ffc.status, 'pending')    AS payment_status,
           ffc.is_ff_provisional,
           LEFT(COALESCE(ffc.approved_at, e.date_of_exit), 7) AS settlement_month,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name
      FROM employees e
      LEFT JOIN exit_request er            ON er.employee_id = e.id
      LEFT JOIN full_final_calculation ffc ON ffc.exit_request_id = er.id
      LEFT JOIN branch_master b            ON b.id = e.branch_id
      LEFT JOIN process_master p           ON p.id = e.process_id
      LEFT JOIN cost_centre_master xcc ON xcc.id = e.cost_centre_id
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
// clearance-status-register
// Actual table: exit_clearance_checklist (011_exit_management.sql).
// One row per dept per exit — aggregate across depts for a summary view.
// ---------------------------------------------------------------------------
export async function clearanceStatusRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.employment_status IN ('resigned','separated','exited')");

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           er.status AS exit_status,
           er.last_working_day_confirmed AS last_working_day,
           SUM(CASE WHEN ec.status = 'cleared' THEN 1 ELSE 0 END) AS depts_cleared,
           COUNT(ec.id) AS depts_total,
           MAX(CASE WHEN ec.status NOT IN ('cleared','waived') THEN ec.department ELSE NULL END) AS pending_dept,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name
      FROM employees e
      LEFT JOIN exit_request er              ON er.employee_id = e.id
      LEFT JOIN exit_clearance_checklist ec  ON ec.exit_request_id = er.id
      LEFT JOIN branch_master b              ON b.id = e.branch_id
      LEFT JOIN process_master p             ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc     ON sp_cc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     -- ONLY_FULL_GROUP_BY: cost centre columns belong here as well as in the SELECT.
     GROUP BY e.id, e.employee_code, e.full_name, e.first_name, e.last_name,
              er.status, er.last_working_day_confirmed, b.branch_name, p.process_name,
              sp_cc.cost_centre_code, sp_cc.cost_centre_name
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
// monthly-attrition-summary  (aggregate — no cursor)
// ---------------------------------------------------------------------------
export async function monthlyAttritionSummary(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, `${new Date().getFullYear()}-01-01`);
  const to    = dateParam(filters.to, today);

  // Joiners and exits are counted in two passes and unioned, because they are different
  // employees: someone who joined in July and someone who left in July share a month but
  // nothing else, so no single GROUP BY over one date column can produce both.
  //
  // The scope and filter clauses have to be built — and bound — once per half. Both halves
  // are identical in shape, so the parameter array is simply the first half's list followed
  // by the second's, in the order the placeholders appear. That ordering is the whole
  // correctness argument: mysql2 binds positionally, and a half-and-half query is exactly
  // where an appended parameter silently lands in the wrong slot.
  const joinClauses: string[] = ["e.id IS NOT NULL"];
  const joinParams: unknown[] = [];
  appendScopeConditions(scope, joinClauses, joinParams);
  appendFilterConditions(filters, joinClauses, joinParams);
  joinClauses.push("e.date_of_joining >= ? AND e.date_of_joining < DATE_ADD(?, INTERVAL 1 DAY)");
  joinParams.push(from, to);

  const exitClauses: string[] = ["e.id IS NOT NULL"];
  const exitParams: unknown[] = [];
  appendScopeConditions(scope, exitClauses, exitParams);
  appendFilterConditions(filters, exitClauses, exitParams);
  exitClauses.push(
    "COALESCE(e.date_of_exit, e.resignation_date) >= ? " +
    "AND COALESCE(e.date_of_exit, e.resignation_date) < DATE_ADD(?, INTERVAL 1 DAY)",
  );
  exitParams.push(from, to);

  const params = [...joinParams, ...exitParams];

  // opening_hc, closing_hc, avg_hc and attrition_pct are NOT emitted, though both catalogues
  // once declared them. Point-in-time headcount cannot be derived from this data: 28,398 of
  // 58,627 employees are inactive with no exit date recorded (2026-08-08), so "employed at
  // the start of month M" is unanswerable — deriving it from dates alone counts all 28,398
  // as still employed and reports an opening headcount near 29,500 against a real active
  // headcount of 1,125. Choosing a substitute denominator changes a headline attrition
  // figure, which is a business decision and not one to make inside a report executor.
  // Joiners and exits are both exact and are what this report now states.
  const base = `
    SELECT u.month,
           u.branch_name,
           u.process_name,
           SUM(u.is_joiner) AS joiners,
           SUM(u.is_exit)   AS exits
      FROM (
        SELECT DATE_FORMAT(e.date_of_joining, '%Y-%m') AS month,
               COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
               COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
               1 AS is_joiner, 0 AS is_exit
          FROM employees e
          LEFT JOIN branch_master b  ON b.id = e.branch_id
          LEFT JOIN process_master p ON p.id = e.process_id
         WHERE ${joinClauses.join(" AND ")}
        UNION ALL
        SELECT DATE_FORMAT(COALESCE(e.date_of_exit, e.resignation_date), '%Y-%m') AS month,
               COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
               COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
               0 AS is_joiner, 1 AS is_exit
          FROM employees e
          LEFT JOIN branch_master b  ON b.id = e.branch_id
          LEFT JOIN process_master p ON p.id = e.process_id
         WHERE ${exitClauses.join(" AND ")}
      ) u
     GROUP BY u.month, u.branch_name, u.process_name
     ORDER BY u.month DESC, u.branch_name, u.process_name`;

  try {
    const total = options.includeTotal ? await count(base, params) : 0;
    const sql   = applyPagination(base, options);
    const rows  = await query(sql, params) as Record<string, unknown>[];
    return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
  } catch (err: unknown) {
    // Was: return an empty result on a missing table or column. For an exit report that
    // reads as "nobody left and nothing is owed", which is the reassuring answer and so the
    // one nobody questions. All three source tables and all 22 referenced columns exist in
    // production (verified 2026-08-11), so this path is unreachable today — which is exactly
    // why it must fail loudly if that ever stops being true.
    rethrowReportSchemaError("exit", err, base);
  }
}

// ---------------------------------------------------------------------------
// exit-reason-analysis  (aggregate — no cursor)
// ---------------------------------------------------------------------------
export async function exitReasonAnalysis(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("COALESCE(e.date_of_exit, e.resignation_date) IS NOT NULL");

  const base = `
    -- employees carries no resignation_reason; the reason is recorded on exit_request.
    -- Only 2 exit_request rows exist against ~29k exited employees, so almost every row
    -- will read 'Not Specified' — that is the truth about the data, not a defect here.
    SELECT COALESCE(er.resignation_reason, er.exit_reason_category, 'Not Specified') AS exit_reason,
           COUNT(*) AS count,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name
      FROM employees e
      LEFT JOIN exit_request er  ON er.employee_id = e.id
      LEFT JOIN branch_master b  ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY exit_reason, b.branch_name, p.process_name
     ORDER BY count DESC, b.branch_name, p.process_name`;

  try {
    const total = options.includeTotal ? await count(base, params) : 0;
    const sql   = applyPagination(base, options);
    const rows  = await query(sql, params) as Record<string, unknown>[];
    return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
  } catch (err: unknown) {
    // Was: return an empty result on a missing table or column. For an exit report that
    // reads as "nobody left and nothing is owed", which is the reassuring answer and so the
    // one nobody questions. All three source tables and all 22 referenced columns exist in
    // production (verified 2026-08-11), so this path is unreachable today — which is exactly
    // why it must fail loudly if that ever stops being true.
    rethrowReportSchemaError("exit", err, base);
  }
}

// ---------------------------------------------------------------------------
// tenure-distribution  (aggregate — no cursor)
// ---------------------------------------------------------------------------
export async function tenureDistribution(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.active_status = 1", "LOWER(COALESCE(e.employment_status,'active')) = 'active'");

  const base = `
    SELECT CASE
             WHEN TIMESTAMPDIFF(MONTH, e.date_of_joining, CURDATE()) < 3  THEN '0-3 months'
             WHEN TIMESTAMPDIFF(MONTH, e.date_of_joining, CURDATE()) < 6  THEN '3-6 months'
             WHEN TIMESTAMPDIFF(MONTH, e.date_of_joining, CURDATE()) < 12 THEN '6-12 months'
             WHEN TIMESTAMPDIFF(YEAR,  e.date_of_joining, CURDATE()) < 2  THEN '1-2 years'
             WHEN TIMESTAMPDIFF(YEAR,  e.date_of_joining, CURDATE()) < 5  THEN '2-5 years'
             ELSE '5+ years'
           END AS tenure_bucket,
           COUNT(*) AS headcount,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name
      FROM employees e
      LEFT JOIN branch_master b  ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY tenure_bucket, b.branch_name, p.process_name
     ORDER BY b.branch_name, p.process_name, tenure_bucket`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
}

// ---------------------------------------------------------------------------
// early-attrition-report  (left within 90 days of joining)
// ---------------------------------------------------------------------------
export async function earlyAttritionReport(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, `${new Date().getFullYear()}-01-01`);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.date_of_exit IS NOT NULL");
  clauses.push("DATEDIFF(e.date_of_exit, e.date_of_joining) <= 90");
  clauses.push("e.date_of_exit BETWEEN ? AND ?");
  params.push(from, to);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(xcc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(xcc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           e.date_of_joining,
           e.date_of_exit AS date_of_exit,
           DATEDIFF(e.date_of_exit, e.date_of_joining) AS days_employed,
           -- see the note in exit-reason-analysis: the reason lives on exit_request
           COALESCE(er.resignation_reason, er.exit_reason_category) AS resignation_reason,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name
      FROM employees e
      LEFT JOIN exit_request er  ON er.employee_id = e.id
      LEFT JOIN branch_master b  ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master xcc ON xcc.id = e.cost_centre_id
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
