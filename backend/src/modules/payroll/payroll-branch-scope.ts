/**
 * Branch-scoping helpers shared by the payroll-family modules (owner ruling 2026-10-01).
 *
 * Org-wide roles (ORG_WIDE_EXEMPT_ROLES) keep seeing everything; every other role is limited to
 * its own branch / assigned scope. A branch/process filter from the browser may only NARROW what
 * the server already allows. A user with no resolvable scope sees nothing (fail closed).
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import {
  buildEmployeeScopeCondition,
  canViewEmployee,
  resolveUserBusinessScope,
  type ScopeCondition,
} from "../../shared/enterpriseScope.js";
import { ORG_WIDE_EXEMPT_ROLES } from "../../shared/scopeAccess.js";

export const OUT_OF_SCOPE_MESSAGE = "Forbidden: this employee is outside your branch / assigned scope";
export const OUT_OF_SCOPE_BODY = { success: false, error: OUT_OF_SCOPE_MESSAGE, message: OUT_OF_SCOPE_MESSAGE };

type Req = { authUser?: { id: string; email?: string | null } | null | undefined } & Record<string, any>;

export interface EmployeeAliases {
  employeeId?: string;
  branchId?: string;
  processId?: string;
  lobId?: string;
  departmentId?: string;
  managerEmployeeId?: string;
}

/** `AND (<sql>)`-ready predicate for the caller over an employees-shaped alias (e.g. "e"). */
export async function employeeScopeFor(req: Req, alias = "e", extra: EmployeeAliases = {}): Promise<ScopeCondition> {
  const scope = await resolveUserBusinessScope(req.authUser as any);
  return buildEmployeeScopeCondition(scope, {
    employeeId: `${alias}.id`,
    branchId: `${alias}.branch_id`,
    processId: `${alias}.process_id`,
    lobId: `${alias}.lob_id`,
    departmentId: `${alias}.department_id`,
    managerEmployeeId: `${alias}.reporting_manager_id`,
    ...extra,
  });
}

/** Same, with explicit column expressions (for tables that carry branch_id directly). */
export async function scopeFor(req: Req, aliases: EmployeeAliases): Promise<ScopeCondition> {
  const scope = await resolveUserBusinessScope(req.authUser as any);
  return buildEmployeeScopeCondition(scope, aliases);
}

/** True when the caller holds an org-wide role. */
export async function isOrgWideCaller(req: Req): Promise<boolean> {
  const scope = await resolveUserBusinessScope(req.authUser as any);
  return scope.roles.some((r) => ORG_WIDE_EXEMPT_ROLES.includes(r));
}

/** May the caller see this employee (own branch / assigned scope / self)? Fails closed. */
export async function canSeeEmployee(req: Req, employeeId: string | null | undefined): Promise<boolean> {
  if (!employeeId || !req.authUser?.id) return false;
  return canViewEmployee(req.authUser as any, String(employeeId));
}

/** Sends 403 and returns false when the employee is outside the caller's scope. */
export async function guardEmployee(req: Req, res: any, employeeId: string | null | undefined): Promise<boolean> {
  if (await canSeeEmployee(req, employeeId)) return true;
  res.status(403).json(OUT_OF_SCOPE_BODY);
  return false;
}

/** Subset of `employeeIds` the caller may see (one query for non-org-wide callers). */
export async function filterVisibleEmployeeIds(req: Req, employeeIds: string[]): Promise<Set<string>> {
  const ids = Array.from(new Set(employeeIds.filter(Boolean).map(String)));
  if (ids.length === 0) return new Set();
  const cond = await employeeScopeFor(req, "e");
  if (cond.sql === "1=1") return new Set(ids);
  if (cond.sql === "1=0") return new Set();
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id FROM employees e WHERE e.id IN (${ids.map(() => "?").join(",")}) AND (${cond.sql})`,
    [...ids, ...cond.params],
  );
  return new Set((rows as RowDataPacket[]).map((r) => String(r.id)));
}

/** Branch ids a caller may see: null = org-wide; otherwise a (possibly empty) set. */
export async function visibleBranchIdsFor(req: Req): Promise<Set<string> | null> {
  return visibleBranchIdsForUser(req.authUser as any);
}

export async function visibleBranchIdsForUser(user: { id: string } | string): Promise<Set<string> | null> {
  const scope = await resolveUserBusinessScope(user as any);
  if (scope.roles.some((r) => ORG_WIDE_EXEMPT_ROLES.includes(r))) return null;
  const ids = new Set<string>();
  for (const a of scope.assignments) if (a.branchId) ids.add(a.branchId);
  if (scope.branchId && (ids.size === 0 || scope.assignments.some((a) => a.scopeType === "all"))) ids.add(scope.branchId);
  return ids;
}

/**
 * Intersect a browser-supplied branch id with what the caller may see.
 * Returns { ok:false } when the requested branch is outside scope (caller should 403/empty),
 * otherwise `branchIds` = null (org-wide, no filter), or the ids the query must be limited to.
 */
export async function narrowBranch(
  req: Req,
  requested: string | null | undefined,
): Promise<{ ok: boolean; branchIds: string[] | null }> {
  const visible = await visibleBranchIdsFor(req);
  const want = requested ? String(requested) : "";
  if (visible === null) return { ok: true, branchIds: want ? [want] : null };
  if (want) return visible.has(want) ? { ok: true, branchIds: [want] } : { ok: false, branchIds: [] };
  return { ok: visible.size > 0, branchIds: Array.from(visible) };
}

/** Does this run fall inside the caller's branch / process scope? Org-wide callers: always. */
export async function canSeeRun(req: Req, runId: string): Promise<boolean> {
  const cond = await scopeFor(req, { branchId: "spr.branch_id", processId: "spr.process_id" });
  if (cond.sql === "1=1") return true;
  if (cond.sql === "1=0") return false;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT spr.id FROM salary_prep_run spr WHERE spr.id = ? AND (${cond.sql}) LIMIT 1`,
    [runId, ...cond.params],
  );
  return (rows as unknown[]).length > 0;
}

/**
 * Express middleware: 403 when :id (or the named param) is a run outside the caller's scope.
 * Role gates stay on the route; this only ADDS the branch check.
 */
export function requireRunInScope(param = "id") {
  return (req: any, res: any, next: any) => {
    const runId = req.params?.[param];
    if (!runId) return next();
    canSeeRun(req, String(runId)).then(
      (ok) => (ok ? next() : res.status(403).json({
        success: false,
        error: "Forbidden: this payroll run is outside your branch / assigned scope",
        message: "Forbidden: this payroll run is outside your branch / assigned scope",
      })),
      next,
    );
  };
}

/** 403s unless the employee owning `table.id` (via its employee_id column) is in the caller's scope. */
export async function guardOwnedRow(
  req: Req,
  res: any,
  table: "salary_prep_line" | "salary_advance_log",
  id: string,
): Promise<boolean> {
  const cond = await employeeScopeFor(req, "e");
  if (cond.sql === "1=1") return true;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT t.id FROM ${table} t JOIN employees e ON e.id = t.employee_id WHERE t.id = ? AND (${cond.sql}) LIMIT 1`,
    [id, ...cond.params],
  );
  if ((rows as unknown[]).length > 0) return true;
  // Missing row: let the handler produce its own 404 only for callers who are org-wide (handled above);
  // for scoped callers a missing or foreign row is indistinguishable.
  res.status(403).json(OUT_OF_SCOPE_BODY);
  return false;
}

/** Server-resolved scope params for the attendance control tower services (never from the browser). */
export async function controlTowerScope(req: Req): Promise<{ scopeSql: string; scopeParams: unknown[] }> {
  const c = await employeeScopeFor(req, "e");
  return { scopeSql: c.sql, scopeParams: c.params };
}

/**
 * Attendance-control gap keys embed the employee id (`apr:<emp>:<date>`, `conflict:<variant>:<emp>:<date>`,
 * `salary:<emp>:<month>`) or a regularization id. Resolve each to its employee; null = unresolvable.
 */
export async function employeeIdsForGapKeys(keys: string[]): Promise<Array<string | null>> {
  const regIds = keys.filter((k) => k.startsWith("regularization:")).map((k) => k.split(":")[1]).filter(Boolean);
  const regMap = new Map<string, string>();
  if (regIds.length) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, employee_id FROM attendance_regularization WHERE id IN (${regIds.map(() => "?").join(",")})`,
      regIds,
    );
    for (const r of rows as RowDataPacket[]) regMap.set(String(r.id), String(r.employee_id));
  }
  return keys.map((k) => {
    const parts = String(k).split(":");
    if (parts[0] === "regularization") return regMap.get(parts[1] ?? "") ?? null;
    if (parts[0] === "conflict") return parts[2] || null;
    return parts[1] || null;
  });
}

/** 403s (returns false) unless every gap key belongs to an employee inside the caller's scope. */
export async function guardGapKeys(req: Req, res: any, keys: string[]): Promise<boolean> {
  const cond = await employeeScopeFor(req, "e");
  if (cond.sql === "1=1") return true;
  const ids = await employeeIdsForGapKeys(keys.map(String));
  const visible = await filterVisibleEmployeeIds(req, ids.filter((x): x is string => !!x));
  if (ids.every((id) => id && visible.has(id))) return true;
  res.status(403).json(OUT_OF_SCOPE_BODY);
  return false;
}

/** `AND`-ready predicate restricting a branch column to the caller's visible branches ("1=1" for org-wide). */
export async function branchInScopeSql(req: Req, column: string): Promise<ScopeCondition> {
  const visible = await visibleBranchIdsFor(req);
  if (visible === null) return { sql: "1=1", params: [] };
  if (visible.size === 0) return { sql: "1=0", params: [] };
  const ids = Array.from(visible);
  return { sql: `${column} IN (${ids.map(() => "?").join(",")})`, params: ids };
}

/**
 * Scope predicate for tables keyed by employee_code (snapshot / upload tables with no employee_id):
 * `<col> IN (SELECT employee_code FROM employees WHERE <caller scope>)`; "1=1" for org-wide callers.
 */
export async function employeeCodeScopeSql(req: Req, column: string): Promise<ScopeCondition> {
  const c = await employeeScopeFor(req, "se");
  if (c.sql === "1=1") return { sql: "1=1", params: [] };
  if (c.sql === "1=0") return { sql: "1=0", params: [] };
  return { sql: `${column} IN (SELECT se.employee_code FROM employees se WHERE ${c.sql})`, params: c.params };
}
