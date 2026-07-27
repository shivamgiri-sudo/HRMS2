/**
 * Employee / HR & Workforce executor
 *
 * Covers codes: headcount, employee-master, manager-mapping, org-structure-snapshot,
 * cost-centre-headcount, employee-movement, confirmation-due-list, contract-expiry-list,
 * lifecycle-events, increment-promotion-history, birthday-list, anniversary-list
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
  return Number((rows as any)[0]?.total ?? 0);
}

// ---------------------------------------------------------------------------
// headcount
// ---------------------------------------------------------------------------
export async function headcount(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[] = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.active_status = 1", "LOWER(COALESCE(e.employment_status,'active')) = 'active'");

  const base = `
    SELECT b.branch_name, d.dept_name AS department_name, p.process_name,
           COUNT(*) AS active_headcount
      FROM employees e
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN department_master d ON d.id = e.department_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY b.branch_name, d.dept_name, p.process_name
     ORDER BY b.branch_name, d.dept_name, p.process_name`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
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
  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  if (!filters.includeInactive) clauses.push("e.active_status = 1");

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
           e.date_of_joining, e.date_of_exit,
           b.branch_name, d.dept_name AS department_name, p.process_name, cc.cost_centre_name,
           COALESCE(NULLIF(m.full_name,''), CONCAT(m.first_name,' ',COALESCE(m.last_name,''))) AS reporting_manager
      FROM employees e
      LEFT JOIN branch_master b  ON b.id  = e.branch_id
      LEFT JOIN department_master d ON d.id = e.department_id
      LEFT JOIN process_master p    ON p.id = e.process_id
      LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
      LEFT JOIN employees m ON m.id = COALESCE(e.reporting_manager_id, e.manager_id)
     WHERE ${clauses.join(" AND ")}
     ORDER BY e.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];

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
  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.active_status = 1");

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
           b.branch_name, p.process_name
      FROM employees e
      LEFT JOIN employees m ON m.id = COALESCE(e.reporting_manager_id, e.manager_id)
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY mapping_status DESC, e.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
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
  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.active_status = 1");

  const base = `
    SELECT b.branch_name, d.dept_name AS department_name, p.process_name,
           COUNT(*) AS headcount,
           SUM(CASE WHEN COALESCE(e.reporting_manager_id, e.manager_id) IS NOT NULL THEN 1 ELSE 0 END) AS has_manager,
           SUM(CASE WHEN COALESCE(e.reporting_manager_id, e.manager_id) IS NULL     THEN 1 ELSE 0 END) AS missing_manager
      FROM employees e
      LEFT JOIN branch_master b     ON b.id = e.branch_id
      LEFT JOIN department_master d ON d.id = e.department_id
      LEFT JOIN process_master p    ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY b.branch_name, d.dept_name, p.process_name
     ORDER BY b.branch_name, d.dept_name, p.process_name`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
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
  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.active_status = 1");

  const base = `
    SELECT cc.cost_centre_name, b.branch_name,
           COUNT(*) AS headcount
      FROM employees e
      LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
      LEFT JOIN branch_master b       ON b.id  = e.branch_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY cc.cost_centre_name, b.branch_name
     ORDER BY cc.cost_centre_name, b.branch_name`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
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

  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
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
           b.branch_name, d.dept_name AS department_name, p.process_name
      FROM employees e
      LEFT JOIN branch_master b     ON b.id = e.branch_id
      LEFT JOIN department_master d ON d.id = e.department_id
      LEFT JOIN process_master p    ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY e.id ASC`;
  params.push(from, to);

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// confirmation-due-list
// ---------------------------------------------------------------------------
export async function confirmationDueList(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.active_status = 1", "e.employment_status = 'probation'");
  clauses.push("DATE_ADD(e.date_of_joining, INTERVAL COALESCE(e.probation_days,90) DAY) <= ?");
  params.push(to);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?"); params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           e.date_of_joining,
           DATE_ADD(e.date_of_joining, INTERVAL COALESCE(e.probation_days,90) DAY) AS confirmation_due_date,
           DATEDIFF(CURDATE(), DATE_ADD(e.date_of_joining, INTERVAL COALESCE(e.probation_days,90) DAY)) AS overdue_days,
           b.branch_name, p.process_name, d.dept_name AS department_name
      FROM employees e
      LEFT JOIN branch_master b     ON b.id = e.branch_id
      LEFT JOIN process_master p    ON p.id = e.process_id
      LEFT JOIN department_master d ON d.id = e.department_id
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
// contract-expiry-list
// ---------------------------------------------------------------------------
export async function contractExpiryList(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.active_status = 1", "e.contract_end_date IS NOT NULL");
  clauses.push("e.contract_end_date <= ?");
  params.push(to);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?"); params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           e.date_of_joining, e.contract_end_date,
           DATEDIFF(e.contract_end_date, CURDATE()) AS days_to_expiry,
           b.branch_name, p.process_name, d.dept_name AS department_name
      FROM employees e
      LEFT JOIN branch_master b     ON b.id = e.branch_id
      LEFT JOIN process_master p    ON p.id = e.process_id
      LEFT JOIN department_master d ON d.id = e.department_id
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

  const clauses: string[] = ["el.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
  // Scope filtering on employee dimension
  if (scope.branchScope.mode === "restricted") {
    clauses.push(`e.branch_id IN (${scope.branchScope.ids.map(() => "?").join(",")})`);
    params.push(...scope.branchScope.ids);
  }
  clauses.push("el.event_date BETWEEN ? AND ?");
  params.push(from, to);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("el.id > ?"); params.push(options.cursor);
  }

  const base = `
    SELECT el.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           el.event_type, el.event_date, el.event_detail,
           el.effective_date, el.created_by_name,
           b.branch_name, p.process_name
      FROM employee_lifecycle_event el
      JOIN employees e ON e.id = el.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY el.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// increment-promotion-history
// ---------------------------------------------------------------------------
export async function incrementPromotionHistory(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, `${new Date().getFullYear()}-01-01`);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["sir.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
  if (scope.branchScope.mode === "restricted") {
    clauses.push(`e.branch_id IN (${scope.branchScope.ids.map(() => "?").join(",")})`);
    params.push(...scope.branchScope.ids);
  }
  clauses.push("sir.effective_date BETWEEN ? AND ?");
  params.push(from, to);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("sir.id > ?"); params.push(options.cursor);
  }

  const base = `
    SELECT sir.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           sir.request_type, sir.old_designation, sir.new_designation,
           sir.old_salary, sir.new_salary, sir.effective_date, sir.approval_status,
           b.branch_name, p.process_name
      FROM salary_increment_request sir
      JOIN employees e ON e.id = sir.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY sir.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// birthday-list
// ---------------------------------------------------------------------------
export async function birthdayList(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const month = Number(filters.month ?? new Date().getMonth() + 1);

  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.active_status = 1", "MONTH(e.date_of_birth) = ?");
  params.push(month);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?"); params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           e.date_of_birth, MONTH(e.date_of_birth) AS birth_month, DAY(e.date_of_birth) AS birth_day,
           b.branch_name, p.process_name, d.dept_name AS department_name
      FROM employees e
      LEFT JOIN branch_master b     ON b.id = e.branch_id
      LEFT JOIN process_master p    ON p.id = e.process_id
      LEFT JOIN department_master d ON d.id = e.department_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY birth_month ASC, birth_day ASC, e.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// anniversary-list
// ---------------------------------------------------------------------------
export async function anniversaryList(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const month = Number(filters.month ?? new Date().getMonth() + 1);

  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.active_status = 1", "MONTH(e.date_of_joining) = ?");
  params.push(month);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?"); params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           e.date_of_joining,
           TIMESTAMPDIFF(YEAR, e.date_of_joining, CURDATE()) AS years_of_service,
           MONTH(e.date_of_joining) AS join_month, DAY(e.date_of_joining) AS join_day,
           b.branch_name, p.process_name, d.dept_name AS department_name
      FROM employees e
      LEFT JOIN branch_master b     ON b.id = e.branch_id
      LEFT JOIN process_master p    ON p.id = e.process_id
      LEFT JOIN department_master d ON d.id = e.department_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY join_month ASC, join_day ASC, e.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}
