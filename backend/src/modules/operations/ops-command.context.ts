import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { LATEST_COMPLETE_ATTENDANCE_DATE_SQL } from "../../shared/attendanceStatus.js";
import { buildScopeWhere, buildScopeWhereEmployees, type DashboardScope } from "../../shared/dashboardScope.js";
import { getCurrentDateIST } from "../../shared/istDate.js";

export type OpsDimension = "all" | "branch" | "process" | "lob" | "manager" | "employee";
export const OPS_DIMENSIONS: OpsDimension[] = ["all", "branch", "process", "lob", "manager", "employee"];

/** Sentinel group id for rows with no branch / process / lob / manager. */
export const NONE_ID = "__none__";

export interface OpsFilters {
  from: string;
  to: string;
  branchId?: string;
  processId?: string;
  lobId?: string;
  managerId?: string;
}

export interface OpsCtx {
  scope: DashboardScope;
  f: OpsFilters;
  /** Latest date with a complete attendance load — attendance-derived metrics stop here. */
  attThrough: string;
  today: string;
}

export interface Sql {
  sql: string;
  params: unknown[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SPAN_DAYS = 366;

export function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && DATE_RE.test(v) && !Number.isNaN(Date.parse(v));
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

export async function latestCompleteAttendanceDate(): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(${LATEST_COMPLETE_ATTENDANCE_DATE_SQL}, '%Y-%m-%d') AS d`,
  );
  return (rows[0]?.d as string | null) ?? null;
}

export interface ResolvedPeriod {
  from: string;
  to: string;
  attThrough: string;
  today: string;
}

/** Validates the requested window; defaults to the 30 days ending at the latest complete attendance date. */
export async function resolvePeriod(rawFrom: unknown, rawTo: unknown): Promise<ResolvedPeriod> {
  const today = getCurrentDateIST();
  const attThrough = (await latestCompleteAttendanceDate()) ?? addDays(today, -1);
  let to = isIsoDate(rawTo) ? rawTo : attThrough;
  let from = isIsoDate(rawFrom) ? rawFrom : addDays(to, -29);
  if (from > to) [from, to] = [to, from];
  if (daysBetween(from, to) > MAX_SPAN_DAYS) from = addDays(to, -(MAX_SPAN_DAYS - 1));
  return { from, to, attThrough, today };
}

/** Same-length window immediately before the current one, for period-over-period deltas. */
export function previousPeriod(f: OpsFilters): { from: string; to: string } {
  const span = daysBetween(f.from, f.to);
  return { from: addDays(f.from, -span), to: addDays(f.from, -1) };
}

function eqOrNull(col: string, value: string | undefined): Sql | null {
  if (!value) return null;
  return value === NONE_ID ? { sql: `${col} IS NULL`, params: [] } : { sql: `${col} = ?`, params: [value] };
}

/** Row scope (security) + user filters (narrowing) for an `employees` alias. Never widens scope. */
export function empWhere(ctx: OpsCtx, alias = "e"): Sql {
  const scope = buildScopeWhereEmployees(ctx.scope, alias);
  const parts = [`(${scope.sql})`];
  const params: unknown[] = [...scope.params];
  for (const [col, val] of [
    [`${alias}.branch_id`, ctx.f.branchId],
    [`${alias}.process_id`, ctx.f.processId],
    [`${alias}.lob_id`, ctx.f.lobId],
    [`${alias}.reporting_manager_id`, ctx.f.managerId],
  ] as const) {
    const c = eqOrNull(col, val);
    if (c) {
      parts.push(c.sql);
      params.push(...c.params);
    }
  }
  return { sql: parts.join(" AND "), params };
}

/** Scope + branch/process filter for tables that carry their own branch_id / process_id (mandate, requisition…). */
export function factWhere(ctx: OpsCtx, branchCol: string, processCol: string): Sql {
  const scope = buildScopeWhere(ctx.scope, branchCol, processCol);
  const parts = [`(${scope.sql})`];
  const params: unknown[] = [...scope.params];
  for (const [col, val] of [
    [branchCol, ctx.f.branchId],
    [processCol, ctx.f.processId],
  ] as const) {
    const c = eqOrNull(col, val);
    if (c) {
      parts.push(c.sql);
      params.push(...c.params);
    }
  }
  return { sql: parts.join(" AND "), params };
}

/** True when a filter exists that org-grain tables (mandate, requisitions, cycles) cannot honour. */
export function hasPeopleOnlyFilter(ctx: OpsCtx): boolean {
  return !!(ctx.f.lobId || ctx.f.managerId);
}

/** Group expression over `employees e`. */
export function groupExpr(dim: OpsDimension, alias = "e"): string {
  switch (dim) {
    case "branch":
      return `COALESCE(${alias}.branch_id, '${NONE_ID}')`;
    case "process":
      return `COALESCE(${alias}.process_id, '${NONE_ID}')`;
    case "lob":
      return `COALESCE(${alias}.lob_id, '${NONE_ID}')`;
    case "manager":
      return `COALESCE(${alias}.reporting_manager_id, '${NONE_ID}')`;
    case "employee":
      return `${alias}.id`;
    default:
      return `'all'`;
  }
}

/** Group expression for a fact table that only carries branch / process ids; null = dimension not available. */
export function factGroupExpr(dim: OpsDimension, branchCol: string, processCol: string): string | null {
  if (dim === "all") return `'all'`;
  if (dim === "branch") return `COALESCE(${branchCol}, '${NONE_ID}')`;
  if (dim === "process") return `COALESCE(${processCol}, '${NONE_ID}')`;
  return null;
}

/** Employee was on the payroll on `date`. Legacy rows carry exit in date_of_exit OR date_of_leaving. */
export function activeAt(date: string, alias = "e"): Sql {
  return {
    sql:
      `(${alias}.date_of_joining <= ? AND COALESCE(${alias}.employment_status,'') <> 'not_joined' ` +
      `AND ((${alias}.active_status = 1 AND ${alias}.date_of_exit IS NULL AND ${alias}.date_of_leaving IS NULL) ` +
      `OR COALESCE(${alias}.date_of_exit, ${alias}.date_of_leaving) > ?))`,
    params: [date, date],
  };
}

/** Exit date inside [from, to] — written as two sargable ranges so the date_of_exit / date_of_leaving indexes apply. */
export function exitInRange(from: string, to: string, alias = "e"): Sql {
  return {
    sql:
      `((${alias}.date_of_exit BETWEEN ? AND ?) OR ` +
      `(${alias}.date_of_exit IS NULL AND ${alias}.date_of_leaving BETWEEN ? AND ?))`,
    params: [from, to, from, to],
  };
}

export const EXIT_DATE_SQL = (alias = "e") => `COALESCE(${alias}.date_of_exit, ${alias}.date_of_leaving)`;

/** Roster rows that are real (excludes the 412k-row synthetic cohort loaded 2026-06-11). */
export const realRoster = (alias: string) =>
  `NOT (${alias}.import_batch_id IS NULL AND ${alias}.cycle_id IS NULL ` +
  `AND ${alias}.assignment_type IS NULL AND ${alias}.shift_template_id IS NULL)`;

/** A roster row that is an actual working shift. */
export const rosterWorking = (alias: string) =>
  `(COALESCE(${alias}.is_week_off,0) = 0 AND COALESCE(${alias}.assignment_type,'') NOT IN ('WEEK_OFF','HOLIDAY','LEAVE'))`;

export function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function pct(part: number, whole: number, digits = 1): number | null {
  if (!whole) return null;
  const f = 10 ** digits;
  return Math.round((part / whole) * 100 * f) / f;
}

export function round(v: number | null, digits = 1): number | null {
  if (v === null) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
