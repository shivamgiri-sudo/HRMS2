/**
 * Assets executor
 *
 * Codes: asset-inventory, asset-allocation-register, asset-movement-log
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
  const clauses: string[] = ["a.company_id = ?"];
  const params: unknown[]  = [scope.companyId];

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
    clauses.push("a.asset_status = ?");
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
           ac.category_name,
           a.asset_status,
           a.purchase_date,
           a.purchase_value,
           a.current_value,
           a.serial_number,
           a.location,
           b.branch_name
      FROM asset_master a
      LEFT JOIN branch_master b      ON b.id  = a.branch_id
      LEFT JOIN asset_category ac    ON ac.id = a.category_id
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

  const clauses: string[] = ["a.company_id = ?"];
  const params: unknown[]  = [scope.companyId];

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
    clauses.push("aa.allocation_date BETWEEN ? AND ?");
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
           ac.category_name,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           aa.allocation_date,
           aa.return_date,
           aa.allocation_status,
           b.branch_name,
           p.process_name
      FROM asset_allocation aa
      JOIN asset_master a            ON a.id  = aa.asset_id
      JOIN employees e               ON e.id  = aa.employee_id
      LEFT JOIN branch_master b      ON b.id  = e.branch_id
      LEFT JOIN process_master p     ON p.id  = e.process_id
      LEFT JOIN asset_category ac    ON ac.id = a.category_id
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

  const clauses: string[] = ["a.company_id = ?"];
  const params: unknown[]  = [scope.companyId];

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

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}
