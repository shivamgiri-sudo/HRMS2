/**
 * Legacy HR executor — migrated from Legacy HRMS Reports tab
 *
 * Codes: attendance-issues-register, loan-register, doj-change-register,
 *        bank-account-register, nominee-register
 *
 * Same underlying queries as the legacy-reports service, re-implemented with
 * proper scope enforcement, pagination, and the standard executor contract.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import type { ExecFilters, ExecScope, ExecOptions, ExecResult } from "./types.js";
import {
  appendScopeConditions,
  appendFilterConditions,
  monthParam,
  monthRange,
  fetchPageWithTotal,
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

/** Mask sensitive bank account numbers when scope disallows viewing. */
function sensitiveCol(canView: boolean, expr: string, alias: string): string {
  return canView ? `${expr} AS ${alias}` : `'***MASKED***' AS ${alias}`;
}

// ---------------------------------------------------------------------------
// attendance-issues-register
// ---------------------------------------------------------------------------
export async function attendanceIssuesRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];

  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  // Date filter — month or date range
  if (filters.month) {
    const { start, endExclusive } = monthRange(monthParam(filters.month));
    clauses.push("ar.session_date >= ? AND ar.session_date < ?");
    params.push(start, endExclusive);
  } else if (filters.from) {
    clauses.push("ar.session_date >= ?");
    params.push(filters.from);
    if (filters.to) {
      clauses.push("ar.session_date <= ?");
      params.push(filters.to);
    }
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("ar.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT ar.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           ar.session_date,
           ar.old_status,
           ar.new_status,
           ar.dispute_type,
           ar.reason,
           ar.status,
           ar.reviewed_at,
           ar.manager_review_note
      FROM attendance_regularization ar
      JOIN employees e ON e.id = ar.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY ar.id ASC`;

  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const rows = paged.rows as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return {
    rows: out,
    rowCount: options.includeTotal ? paged.total : out.length,
    isTruncated: paged.total > out.length,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// loan-register
// ---------------------------------------------------------------------------
export async function loanRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];

  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  if (filters.status) {
    clauses.push("el.status = ?");
    params.push(filters.status);
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("el.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT el.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           el.loan_type,
           el.amount AS loan_amount,
           el.deduction_per_month AS installment_amount,
           el.installments AS total_installments,
           el.start_date,
           el.end_date,
           el.deducted_amount,
           el.pending_amount,
           el.status
      FROM employee_loans el
      JOIN employees e ON e.id = el.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY el.id ASC`;

  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const rows = paged.rows as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return {
    rows: out,
    rowCount: options.includeTotal ? paged.total : out.length,
    isTruncated: paged.total > out.length,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// doj-change-register
// ---------------------------------------------------------------------------
export async function dojChangeRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["1 = 1"];
  const params: unknown[] = [];

  // change_doj_snapshot may not have employee_id — join via employee_code
  if (scope.branchScope.mode === "restricted") {
    const ids = scope.branchScope.ids.filter(Boolean);
    if (ids.length === 0) {
      clauses.push("1 = 0");
    } else {
      clauses.push(`e.branch_id IN (${ids.map(() => "?").join(",")})`);
      params.push(...ids);
    }
  }

  if (filters.branchId) {
    clauses.push("e.branch_id = ?");
    params.push(String(filters.branchId));
  }
  if (filters.employeeCode) {
    clauses.push("e.employee_code = ?");
    params.push(String(filters.employeeCode));
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("cds.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT cds.id AS _cursor,
           cds.employee_code,
           COALESCE(e.full_name, cds.employee_name) AS employee_name,
           COALESCE(b.branch_name, cds.branch_name, 'UNASSIGNED') AS branch_name,
           cds.old_doj,
           cds.new_doj,
           cds.remarks,
           cds.approve_status,
           cds.approve_date
      FROM change_doj_snapshot cds
      LEFT JOIN employees e ON e.employee_code = cds.employee_code
      LEFT JOIN branch_master b ON b.id = e.branch_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY cds.id ASC`;

  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const rows = paged.rows as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return {
    rows: out,
    rowCount: options.includeTotal ? paged.total : out.length,
    isTruncated: paged.total > out.length,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// bank-account-register
// ---------------------------------------------------------------------------
export async function bankAccountRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL", "e.active_status = 1"];
  const params: unknown[] = [];

  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const bankExpr = sensitiveCol(
    scope.canViewSensitiveFields,
    "e.bank_account_number",
    "account_number"
  );

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           e.bank_name,
           ${bankExpr},
           e.ifsc_code,
           e.account_type
      FROM employees e
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY e.id ASC`;

  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const rows = paged.rows as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return {
    rows: out,
    rowCount: options.includeTotal ? paged.total : out.length,
    isTruncated: paged.total > out.length,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// nominee-register
// ---------------------------------------------------------------------------
export async function nomineeRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL", "e.active_status = 1"];
  const params: unknown[] = [];

  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("en.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT en.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           en.nominee_name,
           en.relationship,
           en.date_of_birth AS dob,
           en.share_percentage AS share_pct
      FROM employee_nominee en
      JOIN employees e ON e.id = en.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY en.id ASC`;

  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const rows = paged.rows as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return {
    rows: out,
    rowCount: options.includeTotal ? paged.total : out.length,
    isTruncated: paged.total > out.length,
    nextCursor,
  };
}
