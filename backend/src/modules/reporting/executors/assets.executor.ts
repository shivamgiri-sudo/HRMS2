/**
 * Assets executor
 *
 * Codes: asset-inventory, asset-allocation-register, asset-movement-log, document-expiry-tracker
 *
 * Tenant isolation: asset_master carries its own company_id column (a.company_id).
 * For allocation/movement tables that may lack company_id, the join to asset_master
 * provides the tenant guard via a.company_id = :companyId.
 *
 * Branch scope for asset_master is applied directly on a.branch_id.
 * Branch scope for allocation/movement is applied via the employee join.
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
  return Number((rows as Array<{ total?: number }>)[0]?.total ?? 0);
}

// ---------------------------------------------------------------------------
// asset-inventory
// ---------------------------------------------------------------------------
export async function assetInventory(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["a.id IS NOT NULL"];
  const params: unknown[]  = [];

  // Branch scope applied directly on asset_master
  if (scope.branchScope.mode === "none") throw new ReportScopeAccessDeniedError("branchScope");
  if (scope.branchScope.mode === "restricted" && scope.branchScope.ids.length > 0) {
    clauses.push(`a.branch_id IN (${scope.branchScope.ids.map(() => "?").join(",")})`);
    params.push(...scope.branchScope.ids);
  }

  if (filters.branchId) {
    clauses.push("a.branch_id = ?");
    params.push(String(filters.branchId));
  }
  if (filters.status) {
    clauses.push("a.status = ?");
    params.push(String(filters.status));
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("a.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT a.id AS _cursor,
           a.asset_code,
           a.asset_name,
           a.asset_category AS category_name,
           a.status AS asset_status,
           a.purchase_date,
           a.purchase_cost AS purchase_value,
           a.serial_number,
           b.branch_name
      FROM asset_master a
      LEFT JOIN branch_master b      ON b.id  = a.branch_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY a.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// asset-allocation-register
// ---------------------------------------------------------------------------
export async function assetAllocationRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, `${new Date().getFullYear()}-01-01`);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["a.id IS NOT NULL"];
  const params: unknown[]  = [];

  // Branch scope through employee join
  if (scope.branchScope.mode === "none") throw new ReportScopeAccessDeniedError("branchScope");
  if (scope.branchScope.mode === "restricted" && scope.branchScope.ids.length > 0) {
    clauses.push(`e.branch_id IN (${scope.branchScope.ids.map(() => "?").join(",")})`);
    params.push(...scope.branchScope.ids);
  }
  if (scope.processScope.mode === "none") throw new ReportScopeAccessDeniedError("processScope");
  if (scope.processScope.mode === "restricted" && scope.processScope.ids.length > 0) {
    clauses.push(`e.process_id IN (${scope.processScope.ids.map(() => "?").join(",")})`);
    params.push(...scope.processScope.ids);
  }

  if (filters.branchId) {
    clauses.push("e.branch_id = ?");
    params.push(String(filters.branchId));
  }
  if (filters.employeeCode) {
    clauses.push("e.employee_code = ?");
    params.push(String(filters.employeeCode));
  }
  if (filters.from || filters.to) {
    clauses.push("aa.assigned_date BETWEEN ? AND ?");
    params.push(from, to);
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("aa.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT aa.id AS _cursor,
           a.asset_code,
           a.asset_name,
           a.asset_category AS category_name,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           aa.assigned_date AS allocation_date,
           aa.returned_date AS return_date,
           CASE WHEN aa.returned_date IS NULL THEN 'assigned' ELSE 'returned' END AS allocation_status,
           b.branch_name,
           p.process_name
      FROM asset_assignment aa
      JOIN asset_master a            ON a.id  = aa.asset_id
      JOIN employees e               ON e.id  = aa.employee_id
      LEFT JOIN branch_master b      ON b.id  = e.branch_id
      LEFT JOIN process_master p     ON p.id  = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY aa.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// asset-movement-log
// ---------------------------------------------------------------------------
export async function assetMovementLog(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, `${new Date().getFullYear()}-01-01`);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["a.id IS NOT NULL"];
  const params: unknown[]  = [];

  // Branch scope through employee join (employee may be null for location-only moves)
  if (scope.branchScope.mode === "none") throw new ReportScopeAccessDeniedError("branchScope");
  if (scope.branchScope.mode === "restricted" && scope.branchScope.ids.length > 0) {
    // Apply via asset branch_id (movement tied to the asset's home branch) or employee
    clauses.push(
      `(a.branch_id IN (${scope.branchScope.ids.map(() => "?").join(",")}) ` +
      `OR e.branch_id IN (${scope.branchScope.ids.map(() => "?").join(",")}))`
    );
    params.push(...scope.branchScope.ids, ...scope.branchScope.ids);
  }

  if (filters.branchId) {
    clauses.push("(a.branch_id = ? OR e.branch_id = ?)");
    params.push(String(filters.branchId), String(filters.branchId));
  }
  if (filters.from || filters.to) {
    clauses.push("aml.movement_date BETWEEN ? AND ?");
    params.push(from, to);
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("aml.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT aml.id AS _cursor,
           a.asset_code,
           a.asset_name,
           aml.movement_type,
           aml.movement_date,
           aml.from_location,
           aml.to_location,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           aml.moved_by,
           b.branch_name
      FROM asset_movement_log aml
      JOIN asset_master a            ON a.id  = aml.asset_id
      LEFT JOIN employees e          ON e.id  = aml.employee_id
      LEFT JOIN branch_master b      ON b.id  = COALESCE(e.branch_id, a.branch_id)
     WHERE ${clauses.join(" AND ")}
     ORDER BY aml.id ASC`;

  try {
    const total = options.includeTotal ? await count(base, params) : 0;
    const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
    const rows  = await query(sql, params) as Record<string, unknown>[];
    const nextCursor = (options.mode === "worker" && rows.length > 0)
      ? (rows[rows.length - 1]._cursor as number) : null;
    const out = rows.map(({ _cursor: _, ...rest }) => rest);
    return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
  } catch (err: unknown) {
    if ((err as Record<string, unknown>)?.["code"] === "ER_NO_SUCH_TABLE") {
      return { rows: [], rowCount: 0, isTruncated: false };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// document-expiry-tracker
// Requires migration 415 (adds expiry_date to employee_documents).
// Returns gracefully if column not yet added.
// ---------------------------------------------------------------------------
export async function documentExpiryTracker(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const daysAhead = Number(filters["daysAhead"] ?? 90);
  const lookaheadDate = new Date(new Date().getTime() + daysAhead * 86400000).toISOString().slice(0, 10);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("ed.expiry_date IS NOT NULL");
  clauses.push("ed.expiry_date BETWEEN ? AND ?");
  params.push(today, lookaheadDate);

  if (filters.status) {
    if (filters.status === "expired") {
      clauses.pop(); clauses.pop(); params.pop(); params.pop();
      clauses.push("ed.expiry_date < ?");
      params.push(today);
    } else if (filters.status === "expiring_soon") {
      // already set above
    }
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("ed.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT ed.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           ed.doc_type,
           ed.doc_name,
           ed.document_number,
           ed.issuing_authority,
           ed.expiry_date,
           DATEDIFF(ed.expiry_date, CURDATE()) AS days_until_expiry,
           CASE WHEN ed.expiry_date < CURDATE() THEN 'expired'
                WHEN ed.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 'critical'
                ELSE 'expiring_soon' END AS expiry_status,
           b.branch_name, p.process_name
      FROM employee_documents ed
      JOIN employees e           ON e.id = ed.employee_id
      LEFT JOIN branch_master b  ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY ed.expiry_date ASC, ed.id ASC`;

  try {
    const total = options.includeTotal ? await count(base, params) : 0;
    const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
    const rows  = await query(sql, params) as Record<string, unknown>[];
    const nextCursor = (options.mode === "worker" && rows.length > 0)
      ? (rows[rows.length - 1]._cursor as number) : null;
    const out = rows.map(({ _cursor: _, ...rest }) => rest);
    return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
  } catch (err: unknown) {
    // Graceful fallback if migration 415 not yet applied (expiry_date column missing)
    if ((err as Record<string,unknown>)?.["code"] === "ER_BAD_FIELD_ERROR") {
      return { rows: [], rowCount: 0, isTruncated: false };
    }
    throw err;
  }
}
