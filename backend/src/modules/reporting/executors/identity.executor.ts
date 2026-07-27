/**
 * Identity / statutory identity executor
 *
 * Codes: uan-status-report, esic-status-report, pan-verification-status,
 *        bank-account-verification, identity-source-snapshot
 *
 * SECURITY: UAN, ESIC, PAN and bank account numbers are masked when
 * scope.canViewSensitiveFields === false.  Masking is applied at SQL
 * SELECT level so sensitive values never travel through Node.js memory.
 *
 * All queries use e.company_id = :companyId for tenant isolation.
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

/** Returns a SQL expression for a sensitive field — masked or real. */
function sensitiveCol(canView: boolean, expr: string, alias: string): string {
  return canView ? `${expr} AS ${alias}` : `'***MASKED***' AS ${alias}`;
}

// ---------------------------------------------------------------------------
// uan-status-report
// ---------------------------------------------------------------------------
export async function uanStatusReport(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.active_status = 1");

  if (filters.status) {
    if (filters.status === "MISSING_UAN") {
      clauses.push("(e.uan_number IS NULL OR TRIM(e.uan_number) = '')");
    } else if (filters.status === "HAS_UAN") {
      clauses.push("(e.uan_number IS NOT NULL AND TRIM(e.uan_number) != '')");
    }
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const uanExpr = sensitiveCol(scope.canViewSensitiveFields, "e.uan_number", "uan_number");

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           ${uanExpr},
           e.pf_number,
           CASE
             WHEN e.uan_number IS NOT NULL AND TRIM(e.uan_number) != '' THEN 'HAS_UAN'
             ELSE 'MISSING_UAN'
           END AS uan_status,
           b.branch_name,
           p.process_name
      FROM employees e
      LEFT JOIN branch_master b  ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY e.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// esic-status-report
// ---------------------------------------------------------------------------
export async function esicStatusReport(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.active_status = 1");

  if (filters.status) {
    if (filters.status === "ESIC_MISSING") {
      clauses.push("e.esic_applicable = 1 AND (e.esic_number IS NULL OR TRIM(e.esic_number) = '')");
    } else if (filters.status === "NOT_APPLICABLE") {
      clauses.push("e.esic_applicable = 0");
    } else if (filters.status === "HAS_ESIC") {
      clauses.push("e.esic_applicable = 1 AND e.esic_number IS NOT NULL AND TRIM(e.esic_number) != ''");
    }
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const esicExpr = sensitiveCol(scope.canViewSensitiveFields, "e.esic_number", "esic_number");

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           ${esicExpr},
           e.esic_applicable,
           CASE
             WHEN e.esic_applicable = 1 AND (e.esic_number IS NULL OR TRIM(e.esic_number) = '') THEN 'ESIC_MISSING'
             WHEN e.esic_applicable = 0                                                          THEN 'NOT_APPLICABLE'
             ELSE 'HAS_ESIC'
           END AS esic_status,
           b.branch_name,
           p.process_name
      FROM employees e
      LEFT JOIN branch_master b  ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY e.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// pan-verification-status
// ---------------------------------------------------------------------------
export async function panVerificationStatus(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.active_status = 1");

  if (filters.status) {
    if (filters.status === "MISSING_PAN") {
      clauses.push("(e.pan_number IS NULL OR TRIM(e.pan_number) = '')");
    } else if (filters.status === "VERIFIED") {
      clauses.push("e.pan_verified = 1");
    } else if (filters.status === "UNVERIFIED") {
      clauses.push("e.pan_number IS NOT NULL AND TRIM(e.pan_number) != '' AND (e.pan_verified IS NULL OR e.pan_verified = 0)");
    }
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const panExpr = sensitiveCol(scope.canViewSensitiveFields, "e.pan_number", "pan_number");

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           ${panExpr},
           CASE
             WHEN e.pan_number IS NULL OR TRIM(e.pan_number) = '' THEN 'MISSING_PAN'
             WHEN e.pan_verified = 1                               THEN 'VERIFIED'
             ELSE 'UNVERIFIED'
           END AS pan_status,
           b.branch_name,
           p.process_name
      FROM employees e
      LEFT JOIN branch_master b  ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY e.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// bank-account-verification
// Falls back to employees table fields if employee_bank_account does not exist.
// The query uses employees directly; the dedicated bank table is not assumed
// to be present in all deployments.
// ---------------------------------------------------------------------------
export async function bankAccountVerification(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.active_status = 1");

  if (filters.status) {
    if (filters.status === "MISSING_BANK") {
      clauses.push("(e.bank_account_number IS NULL OR TRIM(e.bank_account_number) = '')");
    } else if (filters.status === "VERIFIED") {
      clauses.push("e.bank_verified = 1");
    } else if (filters.status === "UNVERIFIED") {
      clauses.push(
        "e.bank_account_number IS NOT NULL AND TRIM(e.bank_account_number) != '' " +
        "AND (e.bank_verified IS NULL OR e.bank_verified = 0)"
      );
    }
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const bankExpr = sensitiveCol(
    scope.canViewSensitiveFields,
    "e.bank_account_number",
    "bank_account_number"
  );

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           ${bankExpr},
           e.bank_name,
           e.bank_ifsc,
           CASE
             WHEN e.bank_account_number IS NULL OR TRIM(e.bank_account_number) = '' THEN 'MISSING_BANK'
             WHEN e.bank_verified = 1                                                THEN 'VERIFIED'
             ELSE 'UNVERIFIED'
           END AS bank_status,
           b.branch_name,
           p.process_name
      FROM employees e
      LEFT JOIN branch_master b  ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY e.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// identity-source-snapshot
// Reads the snapshot table populated by the identity-source-snapshot sync job.
// Falls back gracefully if the table does not yet exist.
// ---------------------------------------------------------------------------
export async function identitySourceSnapshot(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  try {
    const clauses: string[] = ["e.company_id = ?"];
    const params: unknown[]  = [scope.companyId];
    appendScopeConditions(scope, clauses, params);
    appendFilterConditions(filters, clauses, params);

    if (filters.status) {
      clauses.push("eis.match_status = ?");
      params.push(String(filters.status));
    }

    if (options.mode === "worker" && options.cursor != null) {
      clauses.push("eis.id > ?");
      params.push(options.cursor);
    }

    const base = `
      SELECT eis.id AS _cursor,
             e.employee_code,
             COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
             eis.source_system,
             eis.source_employee_id,
             eis.match_status,
             eis.last_synced_at,
             b.branch_name,
             p.process_name
        FROM employee_identity_snapshot eis
        JOIN employees e               ON e.id  = eis.employee_id
        LEFT JOIN branch_master b      ON b.id  = e.branch_id
        LEFT JOIN process_master p     ON p.id  = e.process_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY eis.id ASC`;

    const total = options.includeTotal ? await count(base, params) : 0;
    const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
    const rows  = await query(sql, params) as Record<string, unknown>[];
    const nextCursor = (options.mode === "worker" && rows.length > 0)
      ? (rows[rows.length - 1]._cursor as number) : null;
    const out = rows.map(({ _cursor: _, ...rest }) => rest);
    return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
  } catch {
    // Table does not yet exist — return empty result set
    return { rows: [], rowCount: 0, isTruncated: false };
  }
}
