/**
 * Shared types for the report executor layer.
 *
 * All executors receive ExecFilters, ExecScope, and ExecOptions.
 * They return ExecResult. No executor fetches all rows and then slices — the
 * limit/cursor/offset in ExecOptions must be applied at the SQL level.
 *
 * Security rules enforced here:
 *   - Empty DimensionScope.ids never means "all"; use mode === "all" for that.
 *   - Executors must fail closed when mode === "none".
 *   - companyId must appear in every executor query (WHERE employee.company_id = :companyId).
 */

export interface ExecFilters {
  branchId?: string;
  processId?: string;
  departmentId?: string;
  costCentreId?: string;
  managerId?: string;
  employeeCode?: string;
  from?: string;
  to?: string;
  month?: string;
  year?: string;
  financialYear?: string;
  status?: string;
  includeInactive?: boolean;
  [key: string]: unknown;
}

/**
 * "all"        → user has unrestricted access to this dimension (e.g. super_admin).
 * "restricted" → user may only see records in ids[].
 * "none"       → scope resolution failed; executor MUST reject with access-denied.
 *
 * Never use empty ids[] to mean "all" — that ambiguity is the reason for ScopeMode.
 */
export type ScopeMode = "all" | "restricted" | "none";

export interface DimensionScope {
  mode: ScopeMode;
  ids: string[]; // meaningful only when mode === "restricted"
}

/**
 * Full multi-dimensional scope resolved once by resolveFullScope() and passed
 * through every executor call. Executors must NOT re-query the auth tables.
 *
 * companyId is mandatory — every executor must include it in SQL to prevent
 * cross-tenant data leakage via manipulated filter params.
 */
export interface ExecScope {
  companyId: string;
  isSuperAdmin: boolean;

  branchScope: DimensionScope;
  processScope: DimensionScope;
  departmentScope: DimensionScope;
  costCentreScope: DimensionScope;

  managerEmployeeId?: string;        // for manager-scoped reports
  subordinateEmployeeIds?: string[]; // pre-resolved for team reports
  selfEmployeeId?: string;           // for employee self-service reports

  canViewAllEmployees: boolean;       // false → restricted to scope above
  canViewSensitiveFields: boolean;    // false → mask bank/PAN/UAN in output
  canExportSensitiveReports: boolean; // false → 403 on sensitive export endpoint

  // User roles (raw) — used by executors to gate highly_restricted fields
  roles: string[];
}

/**
 * Options controlling how the executor queries the database.
 *
 * A limit of 0 is INVALID — validated at call sites. Worker mode must use
 * REPORT_WORKER_CHUNK_SIZE (configured, never 0).
 *
 * cursor:  keyset pagination cursor for worker mode (null = start from beginning)
 * asOf:    fixed snapshot ISO timestamp for multi-chunk consistency where keyset
 *          pagination cannot guarantee a stable dataset
 */
export interface ExecOptions {
  limit: number;       // > 0 always; enforced by callers
  offset: number;      // for preview/export offset pagination
  cursor?: string | number | null; // for worker keyset pagination
  includeTotal: boolean;
  mode: "preview" | "export" | "worker";
  asOf?: string;       // ISO datetime for snapshot-isolation reads
}

/**
 * Standard option presets (import and use instead of constructing inline).
 */
export const PREVIEW_OPTIONS: ExecOptions = {
  limit: 100,
  offset: 0,
  cursor: null,
  includeTotal: true,
  mode: "preview",
};

export const EXPORT_OPTIONS: ExecOptions = {
  limit: 501,
  offset: 0,
  cursor: null,
  includeTotal: false,
  mode: "export",
};

export function workerOptions(
  chunkSize: number,
  cursor: string | number | null,
  asOf: string
): ExecOptions {
  return {
    limit: chunkSize,
    offset: 0,
    cursor,
    includeTotal: false,
    mode: "worker",
    asOf,
  };
}

export interface ExecResult {
  rows: Record<string, unknown>[];
  rowCount: number;       // COUNT(*) result or rows.length for worker chunks
  isTruncated: boolean;   // true when rowCount > rows.length
  nextCursor?: string | number | null; // null/absent = no more pages
}

export type ExecutorFn = (
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
) => Promise<ExecResult>;

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class ReportExecutorNotFoundError extends Error {
  constructor(public readonly code: string) {
    super(`No executor registered for report code: ${code}`);
    this.name = "ReportExecutorNotFoundError";
  }
}

export class ReportExecutionError extends Error {
  constructor(
    public readonly code: string,
    public readonly cause: unknown
  ) {
    super(`Execution failed for report code: ${code}`);
    this.name = "ReportExecutionError";
  }
}

export class ReportScopeAccessDeniedError extends Error {
  constructor(dimension: string) {
    super(`Access denied: ${dimension} scope resolved to 'none'`);
    this.name = "ReportScopeAccessDeniedError";
  }
}

/**
 * The report's source table does not exist in this database.
 *
 * Several executors used to catch ER_NO_SUCH_TABLE and return `{ rows: [] }`, which
 * rendered as a normal, empty report — indistinguishable from "there is genuinely
 * nothing to show". On 2026-08-07 five reports were in that state against live
 * mas_hrms, each quietly reporting nothing for a table that had never been created.
 *
 * An empty compliance or exceptions report is the most expensive wrong answer these can
 * give, so an absent source is now an error with the missing table named in it.
 */
export class ReportSourceUnavailableError extends Error {
  constructor(
    public readonly code: string,
    public readonly missingTable: string,
    public readonly detail?: string
  ) {
    super(
      `Report "${code}" is unavailable: required table \`${missingTable}\` does not exist in this database.` +
        (detail ? ` ${detail}` : "")
    );
    this.name = "ReportSourceUnavailableError";
  }
}

// ---------------------------------------------------------------------------
// Scope helpers — shared by all executors
// ---------------------------------------------------------------------------

const NO_BRANCH_SCOPE_SENTINEL = "__NO_BRANCH_SCOPE__";

/**
 * Appends branch/process/dept/costCentre WHERE conditions from ExecScope.
 * Throws ReportScopeAccessDeniedError if any required dimension is "none".
 *
 * Callers must have already started with `WHERE company_id = ?` before calling
 * this function.
 */
export function appendScopeConditions(
  scope: ExecScope,
  clauses: string[],
  params: unknown[],
  alias = "e"
): void {
  // Branch scope
  if (scope.branchScope.mode === "none") {
    throw new ReportScopeAccessDeniedError("branchScope");
  }
  if (scope.branchScope.mode === "restricted") {
    const ids = scope.branchScope.ids.filter(id => id !== NO_BRANCH_SCOPE_SENTINEL);
    if (ids.length === 0) {
      // Sentinel only — no valid branch
      clauses.push("1 = 0");
    } else {
      clauses.push(`${alias}.branch_id IN (${ids.map(() => "?").join(",")})`);
      params.push(...ids);
    }
  }

  // Process scope
  if (scope.processScope.mode === "none") {
    throw new ReportScopeAccessDeniedError("processScope");
  }
  if (scope.processScope.mode === "restricted" && scope.processScope.ids.length > 0) {
    clauses.push(`${alias}.process_id IN (${scope.processScope.ids.map(() => "?").join(",")})`);
    params.push(...scope.processScope.ids);
  }

  // Department scope (optional — only restrict if explicitly assigned)
  if (scope.departmentScope.mode === "none") {
    throw new ReportScopeAccessDeniedError("departmentScope");
  }
  if (scope.departmentScope.mode === "restricted" && scope.departmentScope.ids.length > 0) {
    clauses.push(`${alias}.department_id IN (${scope.departmentScope.ids.map(() => "?").join(",")})`);
    params.push(...scope.departmentScope.ids);
  }

  // Cost centre scope (optional)
  if (scope.costCentreScope.mode === "none") {
    throw new ReportScopeAccessDeniedError("costCentreScope");
  }
  if (scope.costCentreScope.mode === "restricted" && scope.costCentreScope.ids.length > 0) {
    clauses.push(`${alias}.cost_centre_id IN (${scope.costCentreScope.ids.map(() => "?").join(",")})`);
    params.push(...scope.costCentreScope.ids);
  }
}

/**
 * Append filter params from ExecFilters to existing clauses/params arrays.
 * branchId/processId/departmentId/costCentreId in filters are user-selected
 * narrowing on top of the scope — they must be within scope, not bypassing it.
 */
export function appendFilterConditions(
  filters: ExecFilters,
  clauses: string[],
  params: unknown[],
  alias = "e"
): void {
  if (filters.branchId) {
    clauses.push(`${alias}.branch_id = ?`);
    params.push(String(filters.branchId));
  }
  if (filters.processId) {
    clauses.push(`${alias}.process_id = ?`);
    params.push(String(filters.processId));
  }
  if (filters.departmentId) {
    clauses.push(`${alias}.department_id = ?`);
    params.push(String(filters.departmentId));
  }
  if (filters.costCentreId) {
    clauses.push(`${alias}.cost_centre_id = ?`);
    params.push(String(filters.costCentreId));
  }
  if (filters.managerId) {
    clauses.push(`(${alias}.reporting_manager_id = ? OR ${alias}.manager_id = ?)`);
    params.push(String(filters.managerId), String(filters.managerId));
  }
  if (filters.employeeCode) {
    clauses.push(`${alias}.employee_code = ?`);
    params.push(String(filters.employeeCode));
  }
}

// ---------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------

export function dateParam(value: unknown, fallback: string): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return fallback;
}

export function monthParam(value: unknown): string {
  const today = new Date();
  const def = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  if (typeof value === "string" && /^\d{4}-\d{2}$/.test(value)) return value;
  return def;
}

export function yearParam(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 2000 && n < 2100 ? n : new Date().getFullYear();
}

/**
 * Appends LIMIT/OFFSET to a base SQL string.
 * In worker mode, uses cursor-based WHERE clause instead — callers handle that.
 */
export function applyPagination(sql: string, options: ExecOptions): string {
  if (options.mode === "worker") return sql; // worker applies cursor via WHERE
  return `${sql} LIMIT ${options.limit} OFFSET ${options.offset}`;
}
