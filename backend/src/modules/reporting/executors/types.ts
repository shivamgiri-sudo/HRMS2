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
import type { RowDataPacket } from "mysql2";

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
  /**
   * "active" | "inactive" | "all". Absent means BOTH populations — see
   * appendEmployeeStatusFilter. Distinct from `status`, which is an approval/workflow
   * state on the report's own subject and means nothing for employee population.
   */
  employeeStatus?: string;
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

/**
 * Turn a schema error into a report that says it is broken, instead of one that says zero.
 *
 * Several executors used to catch ER_NO_SUCH_TABLE / ER_BAD_FIELD_ERROR and return an empty
 * result set with rowCount 0. For a report that is indistinguishable from a true answer:
 * "no exits this month", "no fatal errors", "no quality audits" — and it is the more
 * reassuring of the two readings, so nobody investigates. A report that cannot run must say
 * so; the readiness audit states the rule as "never a confident 0".
 *
 * The two faults are reported differently on purpose. A missing TABLE is what
 * ReportSourceUnavailableError describes, so its message ("required table X does not exist")
 * is then true. A missing COLUMN means the table is present and the query asks it for
 * something it does not have — borrowing the table wording there would send whoever reads
 * the error looking for the wrong thing.
 */
export function rethrowReportSchemaError(reportCode: string, err: unknown, sql: string): never {
  const e = err as { code?: string; sqlMessage?: string };
  const code = String(e?.code ?? "");

  if (code === "ER_NO_SUCH_TABLE" || code === "ER_BAD_TABLE_ERROR") {
    const table = /\bFROM\s+`?([a-z_][a-z0-9_.]*)`?/i.exec(sql)?.[1] ?? "unknown";
    throw new ReportSourceUnavailableError(reportCode, table, e.sqlMessage ?? "");
  }

  if (code === "ER_BAD_FIELD_ERROR" || code === "ER_PARSE_ERROR") {
    throw new Error(
      `Report "${reportCode}" cannot run against this database's schema — ${code}: ` +
        `${e.sqlMessage ?? ""}. The table exists; the report asks for a column it does not ` +
        `have. This previously returned an empty result, which read as "no rows found".`
    );
  }

  throw err;
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

/**
 * Today's date in the business timezone (IST), as YYYY-MM-DD.
 *
 * Not `new Date().toISOString().slice(0, 10)`, which is a UTC substring. The MySQL pool runs
 * every session at +05:30 and the business day is IST, so on a UTC-hosted backend that
 * substring names the wrong day for the last 5.5 hours of every IST day — a report defaulting
 * to "today" then queries yesterday while the data it is compared against is stamped today.
 *
 * Pinned to Asia/Kolkata rather than the host's local time so the answer does not depend on
 * how the server happens to be configured.
 */
export function businessToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

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

/**
 * Half-open date range for a 'YYYY-MM' month: [first day, first day of next month).
 *
 * Exists to kill `LEFT(record_date, 7) = ?`, which was the filter on five reports. Wrapping
 * an indexed column in a function makes the predicate non-sargable, so MySQL cannot use any
 * of the eight indexes on attendance_daily_record.record_date and full-scans instead.
 * Measured on the live table: the LEFT() form takes 2072ms against 1227ms for the range, for
 * an identical 41,106 rows — and that is the cheap COUNT; inside overtime-summary's joins to
 * wfm_roster_assignment and wfm_shift_master it was the difference between a result and a
 * report that never came back at all (>180s).
 *
 * Half-open rather than BETWEEN so it stays correct if the column ever becomes a DATETIME:
 * `BETWEEN '2026-07-01' AND '2026-07-31'` silently drops everything after midnight on the
 * 31st.
 */
/**
 * The two-population rule: a report must show every employee who was in force during the
 * selected period, not only those active right now.
 *
 * `clauses.push("e.active_status = 1")` answers "who is active TODAY", which is the wrong
 * question for any report scoped to a period. Run the July register in September and every
 * employee who left in August vanishes from it — including from payroll, statutory and
 * attendance registers that are supposed to be a record of that month. The row is not wrong,
 * it is absent, so nothing on screen indicates anything is missing.
 *
 * Two ways to express "in force", because the data supports one and not the other:
 *
 *   byFact()  — active now, OR has a real row in the period's fact table. Preferred wherever
 *               a fact table exists. Independent of date_of_exit, which is NULL for roughly
 *               28,000 historical inactive employees in this database (exit dates were never
 *               backfilled), so any exit-date test silently treats those as never-departed.
 *
 *   byTenure()— joined on or before the period end, and either never exited or exited on or
 *               after the period start. For employee-grain reports with no fact table to
 *               anchor against. Inclusive by construction: the NULL date_of_exit population
 *               above stays visible rather than being dropped.
 *
 * Pair either with `employeeStatusExpression()` in the SELECT so a row's state is visible
 * rather than inferred, and add e.active_status to GROUP BY on aggregate reports.
 */
export const employeeInForce = {
  /**
   * @param factTable  table holding the period's rows (must have employee_id + a date column)
   * @param dateColumn the period column on that table
   * @param alias      employees alias in the outer query
   * @returns clause plus the two bind params it consumes, in order
   */
  byFact(
    factTable: string,
    dateColumn: string,
    from: string,
    to: string,
    alias = "e",
  ): { clause: string; params: unknown[] } {
    return {
      clause:
        `(${alias}.active_status = 1 OR EXISTS (` +
        `SELECT 1 FROM \`${factTable}\` _inforce ` +
        `WHERE _inforce.employee_id = ${alias}.id ` +
        `AND _inforce.\`${dateColumn}\` BETWEEN ? AND ?))`,
      params: [from, to],
    };
  },

  byTenure(from: string, to: string, alias = "e"): { clause: string; params: unknown[] } {
    return {
      clause:
        `(${alias}.date_of_joining IS NULL OR ${alias}.date_of_joining <= ?) ` +
        `AND (${alias}.date_of_exit IS NULL OR ${alias}.date_of_exit >= ?)`,
      params: [to, from],
    };
  },
};

/** Renders active_status as the label the catalogs declare for `employee_status`. */
export function employeeStatusExpression(alias = "e"): string {
  return `CASE WHEN ${alias}.active_status = 1 THEN 'Active' ELSE 'Inactive' END`;
}

/**
 * Narrow a two-population report to one population on request.
 *
 * Default is BOTH, which is the point of the two-population rule — a period report should
 * show everyone in force during that period. This exists so a user who wants only current
 * staff can still say so, without the executor silently deciding for them.
 *
 * `includeInactive` is honoured as a back-compatible alias: several executors already
 * branched on it before `employeeStatus` existed, and saved report requests carry it.
 */
export function appendEmployeeStatusFilter(
  filters: ExecFilters,
  clauses: string[],
  params: unknown[],
  alias = "e",
): void {
  const raw = String(filters.employeeStatus ?? "").trim().toLowerCase();

  if (raw === "active")   { clauses.push(`${alias}.active_status = 1`); return; }
  if (raw === "inactive") { clauses.push(`${alias}.active_status = 0`); return; }
  if (raw === "all" || raw === "both") return;

  // No explicit choice. `includeInactive: false` is the only remaining way to ask for
  // active-only, and it is what the pre-existing call sites meant.
  if (filters.includeInactive === false) clauses.push(`${alias}.active_status = 1`);
}

export function monthRange(month: string): { start: string; endExclusive: string } {
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return { start, endExclusive: `${ny}-${String(nm).padStart(2, "0")}-01` };
}

export function yearParam(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 2000 && n < 2100 ? n : new Date().getFullYear();
}

/**
 * Appends LIMIT/OFFSET to a base SQL string.
 * In worker mode, uses cursor-based WHERE clause instead — callers handle that.
 */
/**
 * How many rows to fetch when probing for the total in a single execution.
 *
 * The executors' usual shape runs the statement TWICE whenever a total is wanted: once wrapped
 * in COUNT(*), once for the page. For an aggregate report that is close to double the cost, and
 * the second execution buys a number the first could have produced for free.
 *
 * Measured on monthly-shrinkage-trend against live on 2026-08-09, which returns 430 rows:
 *
 *   LIMIT 100  (one page)        33.2s / 38.0s
 *   LIMIT 1000 (whole result)    36.1s / 34.1s
 *   the COUNT that LIMIT 100 forces          42.2s
 *
 * The LIMIT costs nothing, because the GROUP BY has already computed every row before the LIMIT
 * truncates the output. So asking for more rows than the page and counting what comes back is
 * strictly cheaper than asking for a page and then counting separately — as long as the result
 * fits inside the probe.
 *
 * 2,000 is chosen to cover the aggregate reports and the mid-sized registers (payroll-register
 * returns 1,464) while bounding what is transferred when it does not fit. A report larger than
 * the probe falls back to the COUNT, having transferred 2,000 rows instead of a page — a small
 * waste on a query that was already expensive, and only on reports big enough to be paged deeply
 * in the first place.
 */
const COUNT_FREE_PROBE = 2000;

/**
 * Fetch one page and its true total, taking a second execution only when unavoidable.
 *
 * Returns exactly the rows `applyPagination` would have returned; the probe is invisible to the
 * caller. Worker mode is passed through untouched, since it keysets rather than offsets.
 */
export async function fetchPageWithTotal(
  base: string,
  params: unknown[],
  options: ExecOptions,
  run: (sql: string, params: unknown[]) => Promise<RowDataPacket[]>,
  countRows: (sql: string, params: unknown[]) => Promise<number>
): Promise<{ rows: RowDataPacket[]; total: number }> {
  if (options.mode === "worker") {
    const rows = await run(`${base} LIMIT ${options.limit}`, params);
    return { rows, total: rows.length };
  }

  const probe = Math.max(options.limit, COUNT_FREE_PROBE);
  const probed = await run(`${base} LIMIT ${probe} OFFSET ${options.offset}`, params);
  const page = probed.slice(0, options.limit);

  // Short of the probe means this is the end of the result: the total is known exactly —
  // BUT only when this page actually reached rows. An offset past the end returns nothing, and
  // `offset + 0` would then report the offset itself as the total. Walking every page of
  // monthly-shrinkage-trend surfaced exactly that: 430 real rows, and a request at offset 500
  // answering totalCount 500.
  //
  // The empty-page case is rare — a client would have to page beyond a total it was already
  // told — so paying for the COUNT there costs nothing in practice and keeps the number honest.
  if (probed.length > 0 && probed.length < probe) {
    return { rows: page, total: options.offset + probed.length };
  }
  if (probed.length === 0) {
    return {
      rows: page,
      total: options.offset === 0 ? 0 : (options.includeTotal ? await countRows(base, params) : 0),
    };
  }

  // Genuinely more rows than the probe — only now is a second execution warranted.
  return { rows: page, total: options.includeTotal ? await countRows(base, params) : page.length };
}

export function applyPagination(sql: string, options: ExecOptions): string {
  if (options.mode === "worker") return sql; // worker applies cursor via WHERE
  return `${sql} LIMIT ${options.limit} OFFSET ${options.offset}`;
}
